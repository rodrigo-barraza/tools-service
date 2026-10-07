// ─── Read and Profile CSV Text Sources ───────────────────────
// Counterpart to the generate_csv tool (POST /compute/csv): fetches a
// CSV/TSV/delimited text file from an http(s) URL or base64 data: URI,
// auto-detects the delimiter, infers per-column types, and returns
// headers + row counts + a bounded sample + cheap numeric stats instead
// of dumping the whole file into the model context.

import { errorMessage, randomUserAgent } from "../../utilities.ts";
import {
  isUnresolvedAttachedSentinel,
  buildAttachedSentinelError,
} from "../../services/AttachedMediaSentinel.ts";
import { fetchPublicOrOwnUrl } from "./SsrfGuard.ts";

const MAX_CSV_BYTES = 26_214_400; // 25 MB — aligned with the other media input caps
const MAX_CSV_CHARS = 4_000_000; // matches generate_csv's MAX_CSV_CHARS
const DEFAULT_SAMPLE_ROWS = 20;
const MAX_SAMPLE_ROWS = 100;
const FETCH_TIMEOUT_MS = 30_000;

const CANDIDATE_DELIMITERS: Record<string, string> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
  "|": "pipe",
};

export interface CsvReadOptions {
  /** Explicit delimiter — auto-detected (comma/semicolon/tab/pipe) when omitted. */
  delimiter?: string;
  /** Sample rows to return (default 20, max 100). */
  maxRows?: number | string;
  /** Restrict output (sample + stats) to these header names. */
  columns?: string[];
}

export type CsvColumnType = "number" | "string" | "date" | "boolean" | "empty";

export interface CsvColumnProfile {
  name: string;
  type: CsvColumnType;
  min?: number;
  max?: number;
  mean?: number;
}

/** Short echo label for a source — avoids returning megabytes of base64. */
function describeSource(source: string): string {
  return source.startsWith("data:")
    ? `data: URI (${source.length} chars)`
    : source;
}

// ─── Parsing ──────────────────────────────────────────────────

/**
 * RFC 4180-style CSV parse: quoted fields ("" escapes), any single-char
 * delimiter, \n / \r\n row terminators. Returns rows of raw string cells.
 */
export function parseCsvText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell === "") {
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      // Skip fully empty trailing/blank lines
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  return rows;
}

/**
 * Pick the delimiter whose per-line occurrence count (outside quotes) is
 * highest and most consistent across the first lines of the file.
 */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return ",";

  let bestDelimiter = ",";
  let bestScore = 0;

  for (const delimiter of Object.keys(CANDIDATE_DELIMITERS)) {
    const counts = lines.map((line) => {
      let count = 0;
      let inQuotes = false;
      for (const character of line) {
        if (character === '"') inQuotes = !inQuotes;
        else if (character === delimiter && !inQuotes) count++;
      }
      return count;
    });

    const firstLineCount = counts[0];
    if (firstLineCount === 0) continue;
    const consistentLines = counts.filter((count) => count === firstLineCount).length;
    // Weight consistency (same column count per line) above raw frequency
    const score = consistentLines * 1000 + firstLineCount;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

// ─── Type Inference ───────────────────────────────────────────

const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no"]);
const DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}([T ].*)?$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{4}\/\d{1,2}\/\d{1,2}$/;

function classifyValue(value: string): CsvColumnType {
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  if (BOOLEAN_VALUES.has(trimmed.toLowerCase())) return "boolean";
  if (DATE_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) {
    return "date";
  }
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return "number";
  return "string";
}

interface ColumnAccumulator {
  counts: Record<CsvColumnType, number>;
  sum: number;
  min: number;
  max: number;
  numericCount: number;
}

function inferColumnType(counts: Record<CsvColumnType, number>): CsvColumnType {
  const nonEmpty =
    counts.number + counts.string + counts.date + counts.boolean;
  if (nonEmpty === 0) return "empty";
  // A column is typed when ~all its non-empty values agree
  for (const candidate of ["number", "date", "boolean"] as const) {
    if (counts[candidate] / nonEmpty >= 0.9) return candidate;
  }
  return "string";
}

// ─── Source Resolution ────────────────────────────────────────

async function resolveCsvText(
  source: string,
): Promise<{ text: string } | { error: string; source: string }> {
  if (source.startsWith("data:")) {
    const commaIndex = source.indexOf(",");
    if (commaIndex === -1) {
      return {
        error: "Invalid data URI: missing comma separator",
        source: describeSource(source),
      };
    }
    const header = source.slice(0, commaIndex);
    const payload = source.slice(commaIndex + 1);
    const buffer = header.includes(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    if (buffer.length > MAX_CSV_BYTES) {
      return {
        error: `CSV too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 25 MB)`,
        source: describeSource(source),
      };
    }
    return { text: buffer.toString("utf-8") };
  }

  if (!source.startsWith("http://") && !source.startsWith("https://")) {
    return {
      error:
        "Invalid source: must be an http(s) URL or a base64 data: URI (data:text/csv;base64,...)",
      source: describeSource(source),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetchPublicOrOwnUrl(source, {
    signal: controller.signal,
    headers: {
      "User-Agent": randomUserAgent(),
      Accept: "text/csv,text/tab-separated-values,text/plain,*/*",
    },
  });
  clearTimeout(timeout);

  if (!response.ok) {
    return {
      error: `HTTP ${response.status}: ${response.statusText}`,
      source,
    };
  }

  const contentLength = parseInt(
    response.headers.get("content-length") || "0",
    10,
  );
  if (contentLength > MAX_CSV_BYTES) {
    return {
      error: `CSV too large: ${(contentLength / 1_048_576).toFixed(1)} MB (max: 25 MB)`,
      source,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_CSV_BYTES) {
    return {
      error: `CSV too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 25 MB)`,
      source,
    };
  }

  return { text: buffer.toString("utf-8") };
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Read a CSV from an http(s) URL or a base64 data: URI and return a
 * structured profile: headers, total row count, inferred column types,
 * a bounded sample of rows, and min/max/mean for numeric columns.
 */
export async function readCsvSource(
  source: string,
  options: CsvReadOptions = {},
) {
  if (!source || typeof source !== "string") {
    return { error: "'source' is required (http(s) URL or data: URI)" };
  }

  // Unresolved harness sentinel — no attached document existed to substitute.
  if (isUnresolvedAttachedSentinel(source)) {
    return {
      error: buildAttachedSentinelError(
        "document",
        "an explicit URL or data: URI",
      ),
    };
  }

  try {
    const resolved = await resolveCsvText(source);
    if ("error" in resolved) {
      return resolved;
    }
    let { text } = resolved;

    // Char cap mirrors generate_csv: keep whole lines, flag the cut
    let inputTruncated = false;
    if (text.length > MAX_CSV_CHARS) {
      const lastNewline = text.lastIndexOf("\n", MAX_CSV_CHARS);
      text = text.slice(0, lastNewline > 0 ? lastNewline : MAX_CSV_CHARS);
      inputTruncated = true;
    }

    if (text.trim() === "") {
      return { error: "CSV source is empty", source: describeSource(source) };
    }

    let delimiter = options.delimiter;
    if (delimiter !== undefined && delimiter !== null) {
      if (typeof delimiter !== "string" || delimiter.length !== 1) {
        return {
          error: `Invalid delimiter ${JSON.stringify(delimiter)}. Pass a single character (e.g. ",", ";", "|", "\\t") or omit it for auto-detection.`,
          source: describeSource(source),
        };
      }
    } else {
      delimiter = detectDelimiter(text);
    }

    const rows = parseCsvText(text, delimiter);
    if (rows.length === 0) {
      return { error: "CSV source contains no rows", source: describeSource(source) };
    }

    // First row is treated as headers (matching generate_csv output)
    const headers = rows[0].map(
      (header, index) => header.trim() || `Column_${index + 1}`,
    );
    const dataRows = rows.slice(1);

    // Optional column selection
    let selectedIndexes = headers.map((_, index) => index);
    if (options.columns !== undefined && options.columns !== null) {
      if (
        !Array.isArray(options.columns) ||
        options.columns.some((column) => typeof column !== "string")
      ) {
        return {
          error: "'columns' must be an array of header names",
          source: describeSource(source),
        };
      }
      const lookup = new Map(
        headers.map((header, index) => [header.toLowerCase(), index]),
      );
      const missing: string[] = [];
      selectedIndexes = [];
      for (const column of options.columns) {
        const index = lookup.get(column.trim().toLowerCase());
        if (index === undefined) missing.push(column);
        else selectedIndexes.push(index);
      }
      if (missing.length > 0) {
        return {
          error: `Column(s) not found: ${missing.join(", ")}. Available: ${headers.join(", ")}`,
          source: describeSource(source),
        };
      }
    }

    // Per-column profiling in a single pass
    const accumulators: ColumnAccumulator[] = selectedIndexes.map(() => ({
      counts: { number: 0, string: 0, date: 0, boolean: 0, empty: 0 },
      sum: 0,
      min: Infinity,
      max: -Infinity,
      numericCount: 0,
    }));

    for (const row of dataRows) {
      for (let position = 0; position < selectedIndexes.length; position++) {
        const value = row[selectedIndexes[position]] ?? "";
        const type = classifyValue(value);
        const accumulator = accumulators[position];
        accumulator.counts[type]++;
        if (type === "number") {
          const numeric = Number(value.trim());
          accumulator.sum += numeric;
          if (numeric < accumulator.min) accumulator.min = numeric;
          if (numeric > accumulator.max) accumulator.max = numeric;
          accumulator.numericCount++;
        }
      }
    }

    const columns: CsvColumnProfile[] = selectedIndexes.map(
      (headerIndex, position) => {
        const accumulator = accumulators[position];
        const type = inferColumnType(accumulator.counts);
        const profile: CsvColumnProfile = {
          name: headers[headerIndex],
          type,
        };
        if (type === "number" && accumulator.numericCount > 0) {
          profile.min = accumulator.min;
          profile.max = accumulator.max;
          profile.mean =
            Math.round((accumulator.sum / accumulator.numericCount) * 10_000) /
            10_000;
        }
        return profile;
      },
    );

    // Bounded sample as header-keyed objects
    const requestedSample = options.maxRows
      ? parseInt(String(options.maxRows), 10)
      : DEFAULT_SAMPLE_ROWS;
    const sampleSize = Math.min(
      Math.max(Number.isNaN(requestedSample) ? DEFAULT_SAMPLE_ROWS : requestedSample, 1),
      MAX_SAMPLE_ROWS,
    );
    const sampleRows = dataRows.slice(0, sampleSize).map((row) => {
      const record: Record<string, string> = {};
      for (const headerIndex of selectedIndexes) {
        record[headers[headerIndex]] = row[headerIndex] ?? "";
      }
      return record;
    });

    return {
      source: describeSource(source),
      delimiter,
      delimiterName: CANDIDATE_DELIMITERS[delimiter] ?? "custom",
      headers: selectedIndexes.map((index) => headers[index]),
      columnCount: selectedIndexes.length,
      totalRows: dataRows.length,
      columns,
      sampleRows,
      sampleRowCount: sampleRows.length,
      sampleTruncated: dataRows.length > sampleRows.length,
      ...(inputTruncated && {
        inputTruncated: true,
        note: `Input exceeded ${MAX_CSV_CHARS.toLocaleString()} characters — trailing rows were ignored.`,
      }),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        error: `CSV download timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
        source: describeSource(source),
      };
    }
    return {
      error: `CSV read failed: ${errorMessage(error)}`,
      source: describeSource(source),
    };
  }
}
