// ============================================================
// Compute Routes — Process-Based Tool Endpoints
// ============================================================
// All compute-type tools that run calculations, transformations,
// or rendering on-demand. No external API calls — pure local
// processing.
//
// Mounted at: /compute
// ============================================================

import { Router } from "express";
import {
  executeJavaScript,
  getJsInterpreterInfo,
} from "../services/JavaScriptInterpreterService.js";
import {
  executeShell,
  executeShellStreaming,
  getAllowedBinaries,
} from "../services/ShellExecutorService.js";
import { MAX_CODE_LENGTH, MAX_COMMAND_LENGTH } from "../constants.js";
import crypto from "node:crypto";
import { setupStreamingSSE, EphemeralStore, buildLocalUrl, validateMaxLength, buildEmbedHtml } from "../utilities.js";

// ─── Lazy-loaded dependencies ──────────────────────────────────────
// These are loaded on first use to avoid blocking startup.

let convertUnits;
let dateFns;
let dateFnsTz;
let JSONPath;
let QRCode;
let Diff;

async function getConvertUnits() {
  if (!convertUnits) convertUnits = (await import("convert-units")).default;
  return convertUnits;
}

async function getDateFns() {
  if (!dateFns) dateFns = await import("date-fns");
  return dateFns;
}

async function getDateFnsTz() {
  if (!dateFnsTz) dateFnsTz = await import("date-fns-tz");
  return dateFnsTz;
}

async function getJSONPath() {
  if (!JSONPath) JSONPath = (await import("jsonpath-plus")).JSONPath;
  return JSONPath;
}

async function getQRCode() {
  if (!QRCode) QRCode = (await import("qrcode")).default;
  return QRCode;
}

async function getDiff() {
  if (!Diff) Diff = await import("diff");
  return Diff;
}

const router = Router();

// ═══════════════════════════════════════════════════════════════
// 1. JavaScript Interpreter (vm sandbox)
// ═══════════════════════════════════════════════════════════════

router.post("/js/execute", (req, res) => {
  const { code, timeout } = req.body;
  if (!code || typeof code !== "string") {
    return res
      .status(400)
      .json({ error: "Request body must include 'code' (string)" });
  }
  const lengthErr = validateMaxLength(code, MAX_CODE_LENGTH, "Code");
  if (lengthErr) return res.status(400).json({ error: lengthErr });
  const result = executeJavaScript(code, {
    timeout: timeout
      ? Math.min(Math.max(parseInt(timeout), 100), 30_000)
      : undefined,
  });
  res.json(result);
});

router.get("/js/info", (_req, res) => {
  res.json(getJsInterpreterInfo());
});

// ── JS Streaming (SSE) — synchronous vm, but follows the same SSE pattern ──

router.post("/js/stream", (req, res) => {
  const { code, timeout } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Request body must include 'code' (string)" });
  }
  const lengthErr = validateMaxLength(code, MAX_CODE_LENGTH, "Code");
  if (lengthErr) return res.status(400).json({ error: lengthErr });

  const send = setupStreamingSSE(res);
  send({ event: "start", language: "javascript" });

  const result = executeJavaScript(code, {
    timeout: timeout ? Math.min(Math.max(parseInt(timeout), 100), 30_000) : undefined,
  });

  // Emit console output as stdout chunks
  if (result.output) {
    send({ event: "stdout", data: result.output + "\n" });
  }
  if (result.error) {
    send({ event: "stderr", data: result.error + "\n" });
  }

  send({ event: "exit", exitCode: result.error ? 1 : 0, executionTimeMs: result.executionTimeMs, success: result.success });
  res.end();
});

// ═══════════════════════════════════════════════════════════════
// 2. Shell Executor (allowlisted commands)
// ═══════════════════════════════════════════════════════════════

router.post("/shell/execute", async (req, res) => {
  const { command, stdin, timeout } = req.body;
  if (!command || typeof command !== "string") {
    return res
      .status(400)
      .json({ error: "Request body must include 'command' (string)" });
  }
  const lengthErr = validateMaxLength(command, MAX_COMMAND_LENGTH, "Command");
  if (lengthErr) return res.status(400).json({ error: lengthErr });
  const result = await executeShell(command, {
    stdin: stdin || "",
    timeout: timeout
      ? Math.min(Math.max(parseInt(timeout), 500), 30_000)
      : undefined,
  });
  res.json(result);
});

router.get("/shell/binaries", (_req, res) => {
  const binaries = getAllowedBinaries();
  res.json({ count: binaries.length, binaries });
});

// ── Shell Streaming (SSE) ─────────────────────────────────────

router.post("/shell/stream", async (req, res) => {
  const { command, stdin, timeout } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Request body must include 'command' (string)" });
  }
  const lengthErr = validateMaxLength(command, MAX_COMMAND_LENGTH, "Command");
  if (lengthErr) return res.status(400).json({ error: lengthErr });

  const send = setupStreamingSSE(res);
  send({ event: "start", command });

  const result = await executeShellStreaming(command, {
    stdin: stdin || "",
    timeout: timeout ? Math.min(Math.max(parseInt(timeout), 500), 30_000) : undefined,
    onChunk: (event, data) => send({ event, data }),
  });

  send({ event: "exit", exitCode: result.exitCode, executionTimeMs: result.executionTimeMs, success: result.success, timedOut: result.timedOut, error: result.error || undefined });
  res.end();
});

// ═══════════════════════════════════════════════════════════════
// 3. Unit Conversion
// ═══════════════════════════════════════════════════════════════

router.get("/units/convert", async (req, res) => {
  const { value, from, to } = req.query;
  if (!value || !from || !to) {
    return res
      .status(400)
      .json({ error: "Query parameters 'value', 'from', and 'to' are required" });
  }

  try {
    const convert = await getConvertUnits();
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return res.status(400).json({ error: "'value' must be a valid number" });
    }

    const result = convert(numValue).from(from).to(to);
    const fromUnit = convert().describe(from);
    const toUnit = convert().describe(to);

    res.json({
      value: numValue,
      from: { abbr: from, singular: fromUnit.singular, plural: fromUnit.plural },
      to: { abbr: to, singular: toUnit.singular, plural: toUnit.plural },
      result,
    });
  } catch (err) {
    res.status(400).json({ error: `Conversion failed: ${err.message}` });
  }
});

router.get("/units/list", async (req, res) => {
  const { measure } = req.query;
  try {
    const convert = await getConvertUnits();
    if (measure) {
      const units = convert().possibilities(measure);
      const described = units.map((u) => {
        const desc = convert().describe(u);
        return { abbr: u, singular: desc.singular, plural: desc.plural, measure: desc.measure };
      });
      return res.json({ measure, count: described.length, units: described });
    }
    const measures = convert().measures();
    const all = {};
    for (const m of measures) {
      const units = convert().possibilities(m);
      all[m] = units.map((u) => {
        const desc = convert().describe(u);
        return { abbr: u, singular: desc.singular };
      });
    }
    res.json({ measureCount: measures.length, measures: all });
  } catch (err) {
    res.status(400).json({ error: `Unit listing failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. DateTime Parsing & Arithmetic
// ═══════════════════════════════════════════════════════════════

router.post("/datetime/parse", async (req, res) => {
  const { operation, date, date2, amount, unit, format, timezone } = req.body;
  if (!operation) {
    return res.status(400).json({
      error: "Request body must include 'operation' (parse|format|diff|add|subtract|startOf|endOf|isValid|now)",
    });
  }

  try {
    const fns = await getDateFns();
    const tz = await getDateFnsTz();

    const parseDate = (d) => {
      if (!d) return new Date();
      if (d === "now") return new Date();
      const parsed = typeof d === "number" ? new Date(d) : fns.parseISO(d);
      if (isNaN(parsed.getTime())) throw new Error(`Invalid date: ${d}`);
      return parsed;
    };

    const formatDate = (d) => {
      if (timezone) {
        return tz.formatInTimeZone(d, timezone, format || "yyyy-MM-dd'T'HH:mm:ssXXX");
      }
      return format ? fns.format(d, format) : d.toISOString();
    };

    let result;

    switch (operation) {
      case "now": {
        const now = new Date();
        result = {
          iso: now.toISOString(),
          unix: now.getTime(),
          formatted: formatDate(now),
        };
        if (timezone) {
          result.inTimezone = tz.formatInTimeZone(now, timezone, "yyyy-MM-dd HH:mm:ss zzz");
        }
        break;
      }
      case "parse": {
        const d = parseDate(date);
        result = {
          iso: d.toISOString(),
          unix: d.getTime(),
          formatted: formatDate(d),
          dayOfWeek: fns.format(d, "EEEE"),
          dayOfYear: fns.getDayOfYear(d),
          weekNumber: fns.getISOWeek(d),
          isLeapYear: fns.isLeapYear(d),
          isWeekend: fns.isWeekend(d),
        };
        break;
      }
      case "format": {
        const d = parseDate(date);
        result = { formatted: formatDate(d) };
        break;
      }
      case "diff": {
        const d1 = parseDate(date);
        const d2 = parseDate(date2);
        result = {
          milliseconds: fns.differenceInMilliseconds(d2, d1),
          seconds: fns.differenceInSeconds(d2, d1),
          minutes: fns.differenceInMinutes(d2, d1),
          hours: fns.differenceInHours(d2, d1),
          days: fns.differenceInDays(d2, d1),
          weeks: fns.differenceInWeeks(d2, d1),
          months: fns.differenceInMonths(d2, d1),
          years: fns.differenceInYears(d2, d1),
          businessDays: fns.differenceInBusinessDays(d2, d1),
          humanReadable: fns.formatDistanceStrict(d1, d2),
        };
        break;
      }
      case "add": {
        const d = parseDate(date);
        if (!amount || !unit) throw new Error("'amount' and 'unit' are required for add");
        const ADDERS = {
          years: fns.addYears,
          months: fns.addMonths,
          weeks: fns.addWeeks,
          days: fns.addDays,
          hours: fns.addHours,
          minutes: fns.addMinutes,
          seconds: fns.addSeconds,
        };
        const adder = ADDERS[unit];
        if (!adder) throw new Error(`Invalid unit: ${unit}. Use: ${Object.keys(ADDERS).join(", ")}`);
        const added = adder(d, parseInt(amount));
        result = { original: formatDate(d), result: formatDate(added), iso: added.toISOString() };
        break;
      }
      case "subtract": {
        const d = parseDate(date);
        if (!amount || !unit) throw new Error("'amount' and 'unit' are required for subtract");
        const SUBBERS = {
          years: fns.subYears,
          months: fns.subMonths,
          weeks: fns.subWeeks,
          days: fns.subDays,
          hours: fns.subHours,
          minutes: fns.subMinutes,
          seconds: fns.subSeconds,
        };
        const subber = SUBBERS[unit];
        if (!subber) throw new Error(`Invalid unit: ${unit}. Use: ${Object.keys(SUBBERS).join(", ")}`);
        const subtracted = subber(d, parseInt(amount));
        result = { original: formatDate(d), result: formatDate(subtracted), iso: subtracted.toISOString() };
        break;
      }
      case "startOf": {
        const d = parseDate(date);
        if (!unit) throw new Error("'unit' is required for startOf");
        const STARTERS = {
          year: fns.startOfYear,
          month: fns.startOfMonth,
          week: fns.startOfWeek,
          day: fns.startOfDay,
          hour: fns.startOfHour,
          minute: fns.startOfMinute,
        };
        const fn = STARTERS[unit];
        if (!fn) throw new Error(`Invalid unit: ${unit}. Use: ${Object.keys(STARTERS).join(", ")}`);
        const started = fn(d);
        result = { original: formatDate(d), result: formatDate(started), iso: started.toISOString() };
        break;
      }
      case "endOf": {
        const d = parseDate(date);
        if (!unit) throw new Error("'unit' is required for endOf");
        const ENDERS = {
          year: fns.endOfYear,
          month: fns.endOfMonth,
          week: fns.endOfWeek,
          day: fns.endOfDay,
          hour: fns.endOfHour,
          minute: fns.endOfMinute,
        };
        const fn = ENDERS[unit];
        if (!fn) throw new Error(`Invalid unit: ${unit}. Use: ${Object.keys(ENDERS).join(", ")}`);
        const ended = fn(d);
        result = { original: formatDate(d), result: formatDate(ended), iso: ended.toISOString() };
        break;
      }
      case "isValid": {
        try {
          const d = parseDate(date);
          result = { valid: !isNaN(d.getTime()), parsed: d.toISOString() };
        } catch {
          result = { valid: false, parsed: null };
        }
        break;
      }
      default:
        return res.status(400).json({
          error: `Unknown operation: ${operation}. Use: now, parse, format, diff, add, subtract, startOf, endOf, isValid`,
        });
    }

    res.json({ operation, ...result });
  } catch (err) {
    res.status(400).json({ error: `DateTime operation failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 5. JSON Transform (JSONPath)
// ═══════════════════════════════════════════════════════════════

router.post("/json/transform", async (req, res) => {
  const { data, expression, operations } = req.body;
  if (!data) {
    return res.status(400).json({ error: "Request body must include 'data' (object or array)" });
  }

  try {
    let result = data;

    // JSONPath expression
    if (expression) {
      const jp = await getJSONPath();
      result = jp({ path: expression, json: data, wrap: true });
    }

    // Chained operations
    if (operations && Array.isArray(operations)) {
      for (const op of operations) {
        switch (op.type) {
          case "flatten":
            result = Array.isArray(result) ? result.flat(op.depth ?? Infinity) : result;
            break;
          case "unique":
            result = Array.isArray(result) ? [...new Set(result.map((x) => (typeof x === "object" ? JSON.stringify(x) : x)))].map((x) => { try { return JSON.parse(x); } catch { return x; } }) : result;
            break;
          case "sort":
            if (Array.isArray(result)) {
              const key = op.key;
              const order = op.order === "desc" ? -1 : 1;
              result = [...result].sort((a, b) => {
                const va = key ? a?.[key] : a;
                const vb = key ? b?.[key] : b;
                if (typeof va === "number" && typeof vb === "number") return (va - vb) * order;
                return String(va).localeCompare(String(vb)) * order;
              });
            }
            break;
          case "filter":
            if (Array.isArray(result) && op.key && op.value !== undefined) {
              const opType = op.operator || "eq";
              result = result.filter((item) => {
                const val = item?.[op.key];
                switch (opType) {
                  case "eq": return val === op.value;
                  case "neq": return val !== op.value;
                  case "gt": return val > op.value;
                  case "gte": return val >= op.value;
                  case "lt": return val < op.value;
                  case "lte": return val <= op.value;
                  case "contains": return String(val).includes(String(op.value));
                  case "startsWith": return String(val).startsWith(String(op.value));
                  default: return true;
                }
              });
            }
            break;
          case "pick":
            if (Array.isArray(result) && Array.isArray(op.keys)) {
              result = result.map((item) => {
                const picked = {};
                for (const k of op.keys) {
                  if (k in item) picked[k] = item[k];
                }
                return picked;
              });
            } else if (typeof result === "object" && Array.isArray(op.keys)) {
              const picked = {};
              for (const k of op.keys) {
                if (k in result) picked[k] = result[k];
              }
              result = picked;
            }
            break;
          case "omit":
            if (Array.isArray(result) && Array.isArray(op.keys)) {
              result = result.map((item) => {
                const omitted = { ...item };
                for (const k of op.keys) delete omitted[k];
                return omitted;
              });
            } else if (typeof result === "object" && Array.isArray(op.keys)) {
              result = { ...result };
              for (const k of op.keys) delete result[k];
            }
            break;
          case "groupBy":
            if (Array.isArray(result) && op.key) {
              const groups = {};
              for (const item of result) {
                const k = String(item?.[op.key] ?? "undefined");
                if (!groups[k]) groups[k] = [];
                groups[k].push(item);
              }
              result = groups;
            }
            break;
          case "count":
            result = Array.isArray(result) ? result.length : typeof result === "object" ? Object.keys(result).length : 1;
            break;
          case "sum":
            if (Array.isArray(result)) {
              result = result.reduce((acc, item) => {
                const val = op.key ? item?.[op.key] : item;
                return acc + (typeof val === "number" ? val : 0);
              }, 0);
            }
            break;
          case "limit":
            if (Array.isArray(result) && op.count) {
              result = result.slice(0, op.count);
            }
            break;
          case "reverse":
            if (Array.isArray(result)) {
              result = [...result].reverse();
            }
            break;
          default:
            // Skip unknown operations
            break;
        }
      }
    }

    const count = Array.isArray(result) ? result.length : typeof result === "object" ? Object.keys(result).length : 1;
    res.json({ count, result });
  } catch (err) {
    res.status(400).json({ error: `JSON transform failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 6. CSV Generation
// ═══════════════════════════════════════════════════════════════

const csvStore = new EphemeralStore();

router.post("/csv", (req, res) => {
  const { data, columns, filename, delimiter } = req.body;
  if (!data || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: "'data' must be a non-empty array of objects" });
  }

  try {
    const delim = delimiter || ",";
    // Determine columns from explicit list or first object keys
    const cols = columns || Object.keys(data[0]);

    // Escape CSV values
    const escape = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(delim) || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [cols.map(escape).join(delim)];
    for (const row of data) {
      lines.push(cols.map((c) => escape(row[c])).join(delim));
    }
    const csv = lines.join("\n");

    const id = csvStore.set({ csv, filename: filename || "export.csv" });

    const downloadUrl = buildLocalUrl("compute/csv/download", { id });
    res.json({
      downloadUrl,
      csvId: id,
      rows: data.length,
      columns: cols.length,
    });
  } catch (err) {
    res.status(400).json({ error: `CSV generation failed: ${err.message}` });
  }
});

router.get("/csv/download", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = csvStore.get(id);
  if (!entry) {
    return res.status(404).send("CSV not found or expired");
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${entry.filename}"`);
  res.send(entry.csv);
});

// ═══════════════════════════════════════════════════════════════
// 7. QR Code Generation
// ═══════════════════════════════════════════════════════════════

const qrStore = new EphemeralStore();

router.post("/qr", async (req, res) => {
  const { data, size, errorCorrection, darkColor, lightColor } = req.body;
  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "'data' (string) is required — URL, text, WiFi config, etc." });
  }
  if (data.length > 4296) {
    return res.status(400).json({ error: "Data exceeds QR code capacity (max ~4296 chars)" });
  }

  try {
    const qrcode = await getQRCode();
    const pngBuffer = await qrcode.toBuffer(data, {
      width: Math.min(size || 400, 1024),
      errorCorrectionLevel: errorCorrection || "M",
      color: {
        dark: darkColor || "#000000",
        light: lightColor || "#ffffff",
      },
      margin: 2,
    });

    const id = qrStore.set({ buffer: pngBuffer });

    const qrImageUrl = buildLocalUrl("compute/qr/render", { id });
    res.json({ qrImageUrl, qrId: id, dataLength: data.length });
  } catch (err) {
    res.status(400).json({ error: `QR code generation failed: ${err.message}` });
  }
});

router.get("/qr/render", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = qrStore.get(id);
  if (!entry) {
    return res.status(404).send("QR code not found or expired");
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(entry.buffer);
});

// ═══════════════════════════════════════════════════════════════
// 8. LaTeX Rendering (KaTeX CDN embed)
// ═══════════════════════════════════════════════════════════════

const latexStore = new EphemeralStore();

function buildLatexEmbedHtml(latex, displayMode = true) {
  return buildEmbedHtml({
    headExtra: `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></${"script"}>
`,
    styles: `  #math{
    color:#e2e8f0;
    font-size:1.4em;
    max-width:100%;
    overflow-x:auto;
  }
  .katex{font-size:1.4em}
  .katex .base{color:#e2e8f0}`,
    bodyContent: `<div id="math"></div>`,
    scripts: `<script>
  try {
    katex.render(${JSON.stringify(latex)}, document.getElementById("math"), {
      displayMode: ${displayMode},
      throwOnError: false,
      output: "html",
      strict: false,
      trust: true,
    });
  } catch(e) {
    document.getElementById("math").textContent = "LaTeX error: " + e.message;
  }
</${"script"}>`,
  });
}


router.post("/latex", (req, res) => {
  const { latex, displayMode } = req.body;
  if (!latex || typeof latex !== "string") {
    return res.status(400).json({ error: "'latex' (string) is required" });
  }
  if (latex.length > 10_000) {
    return res.status(400).json({ error: "LaTeX expression exceeds 10,000 characters" });
  }

  const id = latexStore.set({
    latex,
    displayMode: displayMode !== false,
  });

  const latexEmbedUrl = buildLocalUrl("compute/latex/embed", { id });
  res.json({ latexEmbedUrl, latexId: id });
});

router.get("/latex/embed", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = latexStore.get(id);
  if (!entry) {
    return res.status(404).send("LaTeX not found or expired");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildLatexEmbedHtml(entry.latex, entry.displayMode));
});

// ═══════════════════════════════════════════════════════════════
// 9. Mermaid Diagram Rendering (CDN embed)
// ═══════════════════════════════════════════════════════════════

const diagramStore = new EphemeralStore();

function buildMermaidEmbedHtml(definition, theme = "dark") {
  return buildEmbedHtml({
    styles: `  #diagram{
    max-width:100%;
    overflow-x:auto;
  }
  #diagram svg{
    max-width:100%;
    height:auto;
  }`,
    bodyContent: `<div id="diagram"></div>`,
    scripts: `<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: false,
    theme: '${theme}',
    securityLevel: 'strict',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });
  try {
    const { svg } = await mermaid.render('mermaid-svg', ${JSON.stringify(definition)});
    document.getElementById('diagram').innerHTML = svg;
  } catch(e) {
    document.getElementById('diagram').textContent = 'Diagram error: ' + e.message;
  }
</${"script"}>`,
  });
}

router.post("/diagram", (req, res) => {
  const { definition, theme } = req.body;
  if (!definition || typeof definition !== "string") {
    return res.status(400).json({ error: "'definition' (Mermaid syntax string) is required" });
  }
  if (definition.length > 50_000) {
    return res.status(400).json({ error: "Diagram definition exceeds 50,000 characters" });
  }

  const id = diagramStore.set({
    definition,
    theme: theme || "dark",
  });

  const diagramEmbedUrl = buildLocalUrl("compute/diagram/embed", { id });
  res.json({ diagramEmbedUrl, diagramId: id });
});

router.get("/diagram/embed", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = diagramStore.get(id);
  if (!entry) {
    return res.status(404).send("Diagram not found or expired");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildMermaidEmbedHtml(entry.definition, entry.theme));
});

// ═══════════════════════════════════════════════════════════════
// 10. Text Diff
// ═══════════════════════════════════════════════════════════════

router.post("/diff", async (req, res) => {
  const { textA, textB, mode } = req.body;
  if (textA === undefined || textB === undefined) {
    return res.status(400).json({ error: "'textA' and 'textB' are required" });
  }

  try {
    const diff = await getDiff();
    const diffMode = mode || "lines";

    let changes;
    switch (diffMode) {
      case "chars":
        changes = diff.diffChars(textA, textB);
        break;
      case "words":
        changes = diff.diffWords(textA, textB);
        break;
      case "sentences":
        changes = diff.diffSentences(textA, textB);
        break;
      case "json":
        try {
          const objA = typeof textA === "string" ? JSON.parse(textA) : textA;
          const objB = typeof textB === "string" ? JSON.parse(textB) : textB;
          changes = diff.diffJson(objA, objB);
        } catch {
          return res.status(400).json({ error: "For json mode, both inputs must be valid JSON" });
        }
        break;
      case "lines":
      default:
        changes = diff.diffLines(textA, textB);
        break;
    }

    // Also generate unified patch
    const patch = diff.createPatch("diff", textA, textB, "original", "modified");

    // Compute stats
    let additions = 0;
    let deletions = 0;
    let unchanged = 0;
    for (const change of changes) {
      if (change.added) additions += change.count || 1;
      else if (change.removed) deletions += change.count || 1;
      else unchanged += change.count || 1;
    }

    res.json({
      mode: diffMode,
      identical: additions === 0 && deletions === 0,
      stats: { additions, deletions, unchanged },
      changes: changes.map((c) => ({
        value: c.value,
        added: c.added || false,
        removed: c.removed || false,
        count: c.count,
      })),
      patch,
    });
  } catch (err) {
    res.status(400).json({ error: `Diff failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 11. Cryptographic Hashing
// ═══════════════════════════════════════════════════════════════

router.get("/hash", (req, res) => {
  const { data, algorithm, encoding, key } = req.query;
  if (!data) {
    return res.status(400).json({ error: "Query parameter 'data' is required" });
  }

  const algo = (algorithm || "sha256").toLowerCase();
  const enc = encoding || "hex";

  try {
    let hash;
    if (key) {
      // HMAC
      hash = crypto
        .createHmac(algo, key)
        .update(data)
        .digest(enc);
    } else {
      hash = crypto
        .createHash(algo)
        .update(data)
        .digest(enc);
    }

    res.json({
      algorithm: key ? `hmac-${algo}` : algo,
      encoding: enc,
      hash,
      dataLength: data.length,
    });
  } catch (err) {
    const algos = crypto.getHashes().filter((h) => !h.includes("RSA"));
    res.status(400).json({
      error: `Hashing failed: ${err.message}`,
      supportedAlgorithms: algos.slice(0, 20),
    });
  }
});

// UUID generation
router.get("/uuid", (_req, res) => {
  res.json({
    uuid: crypto.randomUUID(),
    v4: crypto.randomUUID(),
    hex: crypto.randomBytes(16).toString("hex"),
    base64: crypto.randomBytes(16).toString("base64"),
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. Regex Tester
// ═══════════════════════════════════════════════════════════════

router.post("/regex", (req, res) => {
  const { pattern, flags, text } = req.body;
  if (!pattern || text === undefined) {
    return res.status(400).json({ error: "'pattern' and 'text' are required" });
  }

  try {
    const regex = new RegExp(pattern, flags || "g");
    const matches = [];
    let match;
    let iterations = 0;
    const MAX_MATCHES = 1000;

    if (regex.global || regex.sticky) {
      while ((match = regex.exec(text)) !== null && iterations < MAX_MATCHES) {
        matches.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1).length > 0 ? match.slice(1) : undefined,
          namedGroups: match.groups || undefined,
        });
        iterations++;
        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
      }
    } else {
      match = regex.exec(text);
      if (match) {
        matches.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1).length > 0 ? match.slice(1) : undefined,
          namedGroups: match.groups || undefined,
        });
      }
    }

    res.json({
      pattern,
      flags: flags || "g",
      matchCount: matches.length,
      matches,
      valid: true,
    });
  } catch (err) {
    res.json({
      pattern,
      flags: flags || "g",
      matchCount: 0,
      matches: [],
      valid: false,
      error: err.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 13. Encode / Decode
// ═══════════════════════════════════════════════════════════════

router.get("/encode", (req, res) => {
  const { data, format, direction } = req.query;
  if (!data || !format) {
    return res.status(400).json({ error: "Query parameters 'data' and 'format' are required" });
  }

  const dir = direction || "encode";

  try {
    let result;

    switch (format.toLowerCase()) {
      case "base64":
        result = dir === "decode"
          ? Buffer.from(data, "base64").toString("utf-8")
          : Buffer.from(data).toString("base64");
        break;
      case "base64url":
        result = dir === "decode"
          ? Buffer.from(data, "base64url").toString("utf-8")
          : Buffer.from(data).toString("base64url");
        break;
      case "hex":
        result = dir === "decode"
          ? Buffer.from(data, "hex").toString("utf-8")
          : Buffer.from(data).toString("hex");
        break;
      case "url":
        result = dir === "decode"
          ? decodeURIComponent(data)
          : encodeURIComponent(data);
        break;
      case "html":
        if (dir === "decode") {
          result = data
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)));
        } else {
          result = data
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }
        break;
      case "rot13":
        result = data.replace(/[a-zA-Z]/g, (c) => {
          const base = c <= "Z" ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
        break;
      case "binary":
        if (dir === "decode") {
          result = data
            .split(" ")
            .map((b) => String.fromCharCode(parseInt(b, 2)))
            .join("");
        } else {
          result = [...data]
            .map((c) => c.charCodeAt(0).toString(2).padStart(8, "0"))
            .join(" ");
        }
        break;
      case "jwt": {
        // Decode only — no verify (we don't have the secret)
        if (dir !== "decode") {
          return res.status(400).json({ error: "JWT format only supports 'decode' direction" });
        }
        const parts = data.split(".");
        if (parts.length < 2) {
          return res.status(400).json({ error: "Invalid JWT format" });
        }
        const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        result = { header, payload, signaturePresent: parts.length === 3 };
        return res.json({ format: "jwt", direction: dir, result });
      }
      default:
        return res.status(400).json({
          error: `Unknown format: ${format}. Supported: base64, base64url, hex, url, html, rot13, binary, jwt`,
        });
    }

    res.json({
      format: format.toLowerCase(),
      direction: dir,
      result,
      inputLength: data.length,
      outputLength: typeof result === "string" ? result.length : undefined,
    });
  } catch (err) {
    res.status(400).json({ error: `Encoding failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 14. Color Converter
// ═══════════════════════════════════════════════════════════════

// ─── Color Math ────────────────────────────────────────────────

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToRgb({ h, s, l }) {
  const hn = h / 360;
  const sn = s / 100;
  const ln = l / 100;

  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p, q, t) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;

  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

function rgbToHsv({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  };
}

function rgbToCmyk({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

/**
 * Parse any common color format into RGB.
 */
function parseColorToRgb(color) {
  const c = color.trim();

  // HEX
  if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
    return hexToRgb(c);
  }

  // rgb(r, g, b)
  const rgbMatch = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
  }

  // hsl(h, s%, l%)
  const hslMatch = c.match(/^hsla?\((\d+),\s*(\d+)%?,\s*(\d+)%?/);
  if (hslMatch) {
    return hslToRgb({
      h: parseInt(hslMatch[1]),
      s: parseInt(hslMatch[2]),
      l: parseInt(hslMatch[3]),
    });
  }

  // CSS named colors (top 30)
  const NAMED = {
    black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
    blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff",
    orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", brown: "#a52a2a",
    gray: "#808080", grey: "#808080", lime: "#00ff00", navy: "#000080",
    teal: "#008080", maroon: "#800000", olive: "#808000", aqua: "#00ffff",
    silver: "#c0c0c0", gold: "#ffd700", indigo: "#4b0082", violet: "#ee82ee",
    coral: "#ff7f50", salmon: "#fa8072", khaki: "#f0e68c", tomato: "#ff6347",
    turquoise: "#40e0d0", plum: "#dda0dd",
  };
  const named = NAMED[c.toLowerCase()];
  if (named) return hexToRgb(named);

  throw new Error(`Cannot parse color: ${color}. Use HEX (#ff0000), rgb(255,0,0), hsl(0,100%,50%), or CSS named colors.`);
}

/**
 * Generate color harmonies from a base hue.
 */
function generatePalette(hsl, type) {
  const palettes = {
    complementary: [{ ...hsl }, { ...hsl, h: (hsl.h + 180) % 360 }],
    analogous: [
      { ...hsl, h: (hsl.h - 30 + 360) % 360 },
      { ...hsl },
      { ...hsl, h: (hsl.h + 30) % 360 },
    ],
    triadic: [
      { ...hsl },
      { ...hsl, h: (hsl.h + 120) % 360 },
      { ...hsl, h: (hsl.h + 240) % 360 },
    ],
    splitComplementary: [
      { ...hsl },
      { ...hsl, h: (hsl.h + 150) % 360 },
      { ...hsl, h: (hsl.h + 210) % 360 },
    ],
    tetradic: [
      { ...hsl },
      { ...hsl, h: (hsl.h + 90) % 360 },
      { ...hsl, h: (hsl.h + 180) % 360 },
      { ...hsl, h: (hsl.h + 270) % 360 },
    ],
    monochromatic: [
      { ...hsl, l: Math.max(hsl.l - 30, 10) },
      { ...hsl, l: Math.max(hsl.l - 15, 10) },
      { ...hsl },
      { ...hsl, l: Math.min(hsl.l + 15, 90) },
      { ...hsl, l: Math.min(hsl.l + 30, 90) },
    ],
  };

  const colors = palettes[type];
  if (!colors) throw new Error(`Unknown palette type: ${type}. Use: ${Object.keys(palettes).join(", ")}`);

  return colors.map((h) => {
    const rgb = hslToRgb(h);
    return {
      hex: rgbToHex(rgb),
      rgb,
      hsl: h,
    };
  });
}

router.get("/color/convert", (req, res) => {
  const { color, palette } = req.query;
  if (!color) {
    return res.status(400).json({ error: "Query parameter 'color' is required" });
  }

  try {
    const rgb = parseColorToRgb(color);
    const hex = rgbToHex(rgb);
    const hsl = rgbToHsl(rgb);
    const hsv = rgbToHsv(rgb);
    const cmyk = rgbToCmyk(rgb);

    const result = {
      input: color,
      hex,
      rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      rgbValues: rgb,
      hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      hslValues: hsl,
      hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      hsvValues: hsv,
      cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      cmykValues: cmyk,
    };

    // Generate palette if requested
    if (palette) {
      result.palette = {
        type: palette,
        colors: generatePalette(hsl, palette),
      };
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// 15. LOGO Turtle Graphics
// ═══════════════════════════════════════════════════════════════

const turtleStore = new EphemeralStore();

const VALID_TURTLE_COMMANDS = new Set([
  "forward", "fd", "backward", "bk", "back",
  "right", "rt", "left", "lt",
  "penup", "pu", "pendown", "pd",
  "color", "pencolor",
  "width", "pensize",
  "goto", "setposition", "setpos",
  "setheading", "seth",
  "circle", "arc",
  "dot", "stamp",
  "label", "write",
  "begin_fill", "end_fill", "fillcolor",
  "reset", "clear",
  "speed",
  "hideturtle", "ht", "showturtle", "st",
  "home",
]);

function buildTurtleEmbedHtml(commands, options = {}) {
  const {
    canvasWidth = 800,
    canvasHeight = 600,
    background = "#0f172a",
    animated = true,
    stepDelay = 40,
    title = "",
  } = options;

  const commandsJson = JSON.stringify(commands);

  return buildEmbedHtml({
    styles: `
  canvas {
    border-radius: 12px;
    box-shadow: 0 0 40px rgba(56, 189, 248, 0.08);
  }
  #container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 100%;
  }
  #title {
    color: #94a3b8;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  #status {
    color: #64748b;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    height: 16px;
    transition: color 0.3s;
  }
  #status.active { color: #38bdf8; }
  #status.done { color: #4ade80; }`,
    bodyContent: `<div id="container">
  ${title ? `<div id="title">${title}</div>` : ""}
  <canvas id="turtle" width="${canvasWidth}" height="${canvasHeight}"></canvas>
  <div id="status">initializing…</div>
</div>`,
    scripts: `<script>
(function() {
  const canvas = document.getElementById("turtle");
  const ctx = canvas.getContext("2d");
  const status = document.getElementById("status");
  const COMMANDS = ${commandsJson};
  const ANIMATED = ${animated};
  const STEP_DELAY = ${stepDelay};
  const BG = "${background}";

  // ── Turtle State ──
  let x = canvas.width / 2;
  let y = canvas.height / 2;
  let angle = -90; // 0 = east, -90 = north (LOGO default: heading north)
  let penDown = true;
  let penColor = "#38bdf8";
  let penWidth = 2;
  let fillColor = "#38bdf8";
  let filling = false;
  let fillPath = [];
  let turtleSpeed = 5;
  let showTurtle = true;

  // ── Drawing Layer (persistent) ──
  const drawCanvas = document.createElement("canvas");
  drawCanvas.width = canvas.width;
  drawCanvas.height = canvas.height;
  const drawCtx = drawCanvas.getContext("2d");
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";

  function clearCanvas() {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }

  function deg2rad(d) { return d * Math.PI / 180; }

  function drawTurtle() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the persistent drawing layer
    ctx.drawImage(drawCanvas, 0, 0);

    if (!showTurtle) return;

    // Turtle cursor — a triangle pointing in the heading direction
    const size = 12;
    const rad = deg2rad(angle);
    const tipX = x + Math.cos(rad) * size * 1.5;
    const tipY = y + Math.sin(rad) * size * 1.5;
    const leftX = x + Math.cos(rad + 2.4) * size;
    const leftY = y + Math.sin(rad + 2.4) * size;
    const rightX = x + Math.cos(rad - 2.4) * size;
    const rightY = y + Math.sin(rad - 2.4) * size;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = penColor;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Execute a single command ──
  function executeCommand(cmd) {
    const action = cmd.action || cmd.command || cmd.cmd;
    const val = cmd.value !== undefined ? cmd.value : cmd.distance || cmd.angle || cmd.amount || 0;
    const val2 = cmd.value2 !== undefined ? cmd.value2 : cmd.extent || 0;

    switch (action) {
      case "forward": case "fd": {
        const d = Number(val);
        const rad = deg2rad(angle);
        const nx = x + Math.cos(rad) * d;
        const ny = y + Math.sin(rad) * d;
        if (penDown) {
          drawCtx.beginPath();
          drawCtx.moveTo(x, y);
          drawCtx.lineTo(nx, ny);
          drawCtx.strokeStyle = penColor;
          drawCtx.lineWidth = penWidth;
          drawCtx.stroke();
        }
        if (filling) fillPath.push({ x: nx, y: ny });
        x = nx; y = ny;
        break;
      }
      case "backward": case "bk": case "back": {
        const d = -Number(val);
        const rad = deg2rad(angle);
        const nx = x + Math.cos(rad) * d;
        const ny = y + Math.sin(rad) * d;
        if (penDown) {
          drawCtx.beginPath();
          drawCtx.moveTo(x, y);
          drawCtx.lineTo(nx, ny);
          drawCtx.strokeStyle = penColor;
          drawCtx.lineWidth = penWidth;
          drawCtx.stroke();
        }
        if (filling) fillPath.push({ x: nx, y: ny });
        x = nx; y = ny;
        break;
      }
      case "right": case "rt":
        angle += Number(val);
        break;
      case "left": case "lt":
        angle -= Number(val);
        break;
      case "penup": case "pu":
        penDown = false;
        break;
      case "pendown": case "pd":
        penDown = true;
        break;
      case "color": case "pencolor":
        penColor = cmd.color || cmd.value || "#38bdf8";
        break;
      case "width": case "pensize":
        penWidth = Number(val) || 2;
        break;
      case "goto": case "setposition": case "setpos": {
        const gx = canvas.width / 2 + Number(cmd.x !== undefined ? cmd.x : val);
        const gy = canvas.height / 2 - Number(cmd.y !== undefined ? cmd.y : val2);
        if (penDown) {
          drawCtx.beginPath();
          drawCtx.moveTo(x, y);
          drawCtx.lineTo(gx, gy);
          drawCtx.strokeStyle = penColor;
          drawCtx.lineWidth = penWidth;
          drawCtx.stroke();
        }
        if (filling) fillPath.push({ x: gx, y: gy });
        x = gx; y = gy;
        break;
      }
      case "setheading": case "seth":
        angle = Number(val) - 90;
        break;
      case "home":
        x = canvas.width / 2;
        y = canvas.height / 2;
        angle = -90;
        break;
      case "circle": {
        const r = Number(val);
        if (penDown) {
          drawCtx.beginPath();
          drawCtx.arc(x, y - r, Math.abs(r), 0, Math.PI * 2);
          drawCtx.strokeStyle = penColor;
          drawCtx.lineWidth = penWidth;
          drawCtx.stroke();
        }
        break;
      }
      case "arc": {
        const arcR = Number(val);
        const extent = Number(val2) || 360;
        if (penDown) {
          const startRad = deg2rad(angle - 90);
          const endRad = startRad + deg2rad(extent);
          const cx = x - Math.sin(deg2rad(angle)) * arcR;
          const cy = y + Math.cos(deg2rad(angle)) * arcR;
          drawCtx.beginPath();
          drawCtx.arc(cx, cy, Math.abs(arcR), startRad, endRad, arcR < 0);
          drawCtx.strokeStyle = penColor;
          drawCtx.lineWidth = penWidth;
          drawCtx.stroke();
        }
        break;
      }
      case "dot": case "stamp": {
        const dotSize = Number(val) || 5;
        drawCtx.beginPath();
        drawCtx.arc(x, y, dotSize, 0, Math.PI * 2);
        drawCtx.fillStyle = penColor;
        drawCtx.fill();
        break;
      }
      case "label": case "write": {
        const text = cmd.text || cmd.value || "";
        drawCtx.font = (cmd.fontSize || 14) + "px system-ui, sans-serif";
        drawCtx.fillStyle = penColor;
        drawCtx.fillText(text, x + 4, y - 4);
        break;
      }
      case "fillcolor":
        fillColor = cmd.color || cmd.value || fillColor;
        break;
      case "begin_fill":
        filling = true;
        fillPath = [{ x, y }];
        break;
      case "end_fill":
        if (filling && fillPath.length > 2) {
          drawCtx.beginPath();
          drawCtx.moveTo(fillPath[0].x, fillPath[0].y);
          for (let i = 1; i < fillPath.length; i++) {
            drawCtx.lineTo(fillPath[i].x, fillPath[i].y);
          }
          drawCtx.closePath();
          drawCtx.fillStyle = fillColor;
          drawCtx.globalAlpha = 0.35;
          drawCtx.fill();
          drawCtx.globalAlpha = 1;
        }
        filling = false;
        fillPath = [];
        break;
      case "speed":
        turtleSpeed = Math.max(1, Math.min(10, Number(val) || 5));
        break;
      case "hideturtle": case "ht":
        showTurtle = false;
        break;
      case "showturtle": case "st":
        showTurtle = true;
        break;
      case "reset":
        x = canvas.width / 2;
        y = canvas.height / 2;
        angle = -90;
        penDown = true;
        penColor = "#38bdf8";
        penWidth = 2;
        showTurtle = true;
        filling = false;
        fillPath = [];
        clearCanvas();
        break;
      case "clear":
        clearCanvas();
        break;
    }
  }

  // ── Animate or instant draw ──
  function run() {
    drawTurtle();

    if (!ANIMATED || COMMANDS.length === 0) {
      for (const cmd of COMMANDS) executeCommand(cmd);
      drawTurtle();
      status.textContent = COMMANDS.length + " commands · done";
      status.className = "done";
      reportSize();
      return;
    }

    let idx = 0;
    status.className = "active";

    function step() {
      if (idx >= COMMANDS.length) {
        drawTurtle();
        status.textContent = COMMANDS.length + " commands · done";
        status.className = "done";
        reportSize();
        return;
      }
      const cmd = COMMANDS[idx];
      executeCommand(cmd);
      drawTurtle();
      status.textContent = (idx + 1) + "/" + COMMANDS.length + " · " + (cmd.action || cmd.command || "?");
      idx++;
      setTimeout(step, STEP_DELAY);
    }
    step();
  }

  function reportSize() {
    var el = document.body;
    window.parent.postMessage({ type: "embed-resize", width: el.scrollWidth, height: el.scrollHeight }, "*");
  }

  run();
})();
</${"script"}>`,
  });
}

/**
 * Session-based turtle state — allows the agent to build drawings
 * incrementally across multiple tool calls. Keyed by sessionId.
 * Falls back to single-shot mode when no sessionId is provided.
 */
const turtleSessions = new Map();
const TURTLE_SESSION_TTL_MS = 30 * 60_000; // 30 min

function cleanupTurtleSessions() {
  const now = Date.now();
  for (const [id, session] of turtleSessions) {
    if (now - session.updatedAt > TURTLE_SESSION_TTL_MS) turtleSessions.delete(id);
  }
}

router.post("/turtle", (req, res) => {
  const { commands, options, sessionId } = req.body;

  if (!commands || !Array.isArray(commands) || commands.length === 0) {
    return res.status(400).json({
      error: "'commands' is required (non-empty array of turtle command objects)",
    });
  }

  // Validate commands
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const action = cmd.action || cmd.command || cmd.cmd;
    if (!action) {
      return res.status(400).json({
        error: `Command at index ${i} missing 'action' field`,
      });
    }
    if (!VALID_TURTLE_COMMANDS.has(action)) {
      return res.status(400).json({
        error: `Unknown turtle command: '${action}'. Valid: ${[...VALID_TURTLE_COMMANDS].join(", ")}`,
      });
    }
  }

  // ── Session mode: append to existing drawing ──
  if (sessionId && turtleSessions.has(sessionId)) {
    const session = turtleSessions.get(sessionId);
    const totalCommands = session.commands.length + commands.length;

    if (totalCommands > 5000) {
      return res.status(400).json({
        error: `Maximum 5,000 total commands per session (current: ${session.commands.length}, adding: ${commands.length})`,
      });
    }

    // Merge options (new options override existing)
    if (options) {
      if (options.canvasWidth) session.options.canvasWidth = Math.min(options.canvasWidth, 1920);
      if (options.canvasHeight) session.options.canvasHeight = Math.min(options.canvasHeight, 1080);
      if (options.background) session.options.background = options.background;
      if (options.animated !== undefined) session.options.animated = options.animated;
      if (options.stepDelay) session.options.stepDelay = Math.max(5, Math.min(500, options.stepDelay));
      if (options.title) session.options.title = options.title;
    }

    session.commands.push(...commands);
    session.updatedAt = Date.now();

    // Store full accumulated drawing for the embed
    const embedId = turtleStore.set({ commands: session.commands, options: session.options });
    const turtleEmbedUrl = buildLocalUrl("compute/turtle/embed", { id: embedId });

    return res.json({
      turtleEmbedUrl,
      sessionId,
      commandCount: commands.length,
      totalCommands: session.commands.length,
      canvasSize: `${session.options.canvasWidth}x${session.options.canvasHeight}`,
      isAppend: true,
    });
  }

  // ── New session ──
  if (commands.length > 5000) {
    return res.status(400).json({
      error: "Maximum 5,000 commands per drawing",
    });
  }

  const opts = {
    canvasWidth: Math.min(options?.canvasWidth || 800, 1920),
    canvasHeight: Math.min(options?.canvasHeight || 600, 1080),
    background: options?.background || "#0f172a",
    animated: options?.animated !== false,
    stepDelay: Math.max(5, Math.min(500, options?.stepDelay || 40)),
    title: options?.title || "",
  };

  // Create new session
  const newSessionId = sessionId || crypto.randomUUID().slice(0, 12);
  turtleSessions.set(newSessionId, {
    commands: [...commands],
    options: { ...opts },
    updatedAt: Date.now(),
  });
  cleanupTurtleSessions();

  const embedId = turtleStore.set({ commands, options: opts });
  const turtleEmbedUrl = buildLocalUrl("compute/turtle/embed", { id: embedId });

  res.json({
    turtleEmbedUrl,
    sessionId: newSessionId,
    turtleId: embedId,
    commandCount: commands.length,
    totalCommands: commands.length,
    canvasSize: `${opts.canvasWidth}x${opts.canvasHeight}`,
  });
});

router.get("/turtle/embed", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = turtleStore.get(id);
  if (!entry) {
    return res.status(404).send("Turtle drawing not found or expired");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildTurtleEmbedHtml(entry.commands, entry.options));
});

// ═══════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════

export function getComputeHealth() {
  return {
    jsInterpreter: "on-demand (Node.js vm)",
    shellExecutor: "on-demand (allowlisted subprocess)",
    unitConverter: "on-demand (convert-units)",
    dateTime: "on-demand (date-fns)",
    jsonTransform: "on-demand (jsonpath-plus)",
    csvGenerator: "on-demand (internal)",
    qrCode: "on-demand (qrcode)",
    latex: "on-demand (KaTeX CDN embed)",
    diagram: "on-demand (Mermaid CDN embed)",
    textDiff: "on-demand (diff)",
    hash: "on-demand (node:crypto)",
    regexTester: "on-demand (native RegExp)",
    encodeDecode: "on-demand (internal)",
    colorConverter: "on-demand (internal)",
    turtleGraphics: "on-demand (LOGO canvas embed)",
  };
}

export default router;
