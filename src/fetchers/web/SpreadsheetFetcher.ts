// ─── Download and Extract Tabular Data from Spreadsheet URLs ────────────────

import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { errorMessage } from "../../utilities.ts";
import { fetchPublicOrOwnUrl } from "./SsrfGuard.ts";

const MAX_SPREADSHEET_BYTES = 10_485_760; // 10 MB
const MAX_TEXT_CHARACTERS = 100_000;
const MAX_ROWS_PER_SHEET = 1000;
const FETCH_TIMEOUT_MILLISECONDS = 30_000;

export interface SpreadsheetOptions {
  maxRows?: number | string;      // max rows per sheet (default: 1000)
  maxChars?: number | string;     // max total output chars (default: 100,000)
  sheet?: string | number;        // specific sheet name or 0-based index (default: all sheets)
  includeHeaders?: boolean;       // treat first row as headers (default: true)
  outputFormat?: "json" | "csv" | "markdown"; // how to format the data (default: "json")
}

interface ExtractedSheet {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  headers: string[] | null;
  rows: (Record<string, NormalizedCellValue> | NormalizedCellValue[])[];
  rawRows: NormalizedCellValue[][];
  truncated: boolean;
}

export interface SpreadsheetJsonSheet {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  headers: string[] | null;
  rows: (Record<string, NormalizedCellValue> | NormalizedCellValue[])[];
  truncated: boolean;
}

export interface SpreadsheetJsonResponse {
  url: string;
  format: string;
  sheetCount: number;
  sheets: SpreadsheetJsonSheet[];
  totalRowCount: number;
  charCount: number;
  truncated: boolean;
}

type NormalizedCellValue = string | number | boolean | null;

/**
 * Normalizes ExcelJS cell values to standard primitives.
 * Handles rich text, formulas, hyperlinks, dates, errors, and null values.
 * Accepts ExcelJS's CellValue union which includes complex object shapes.
 */
function normalizeCellValue(value: ExcelJS.CellValue): NormalizedCellValue {
  if (value === undefined || value === null) {
    return null;
  }

  // 1. Check if JavaScript Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // 2. Check if object (rich text, formulas, hyperlinks, errors)
  if (typeof value === "object") {
    // Hyperlink cell: { text: string, hyperlink: string }
    if ("hyperlink" in value && typeof (value as { hyperlink: unknown }).hyperlink === "string" && "text" in value) {
      return String((value as { text: unknown }).text ?? "");
    }

    // Formula cell: { formula: string, result: NormalizedCellValue, error?: unknown }
    if ("formula" in value || "result" in value) {
      const formulaCell = value as { formula?: string; result?: ExcelJS.CellValue; error?: unknown };
      if (formulaCell.error) {
        return "#ERROR";
      }
      if (formulaCell.result !== undefined && formulaCell.result !== null) {
        return normalizeCellValue(formulaCell.result);
      }
      if (typeof formulaCell.formula === "string") {
        return `=${formulaCell.formula}`;
      }
      return null;
    }

    // Rich text cell: { richText: Array<{ text: string }> }
    if ("richText" in value && Array.isArray((value as { richText: unknown }).richText)) {
      const richTextArray = (value as { richText: Array<{ text?: string }> }).richText;
      const textSegments = richTextArray.map((segment) => {
        if (segment && typeof segment.text === "string") {
          return segment.text;
        }
        return "";
      });
      return textSegments.join("");
    }

    // Error value: { error: string }
    if ("error" in value) {
      return "#ERROR";
    }

    return null;
  }

  // Primitives (string, number, boolean)
  return value;
}

/**
 * Formats data rows as a markdown table.
 */
function convertSheetToMarkdown(sheetName: string, headers: string[] | null, rows: NormalizedCellValue[][]): string {
  let markdown = `## Sheet: ${sheetName}\n\n`;
  if (headers && headers.length > 0) {
    markdown += `| ${headers.join(" | ")} |\n`;
    markdown += `| ${headers.map(() => "---").join(" | ")} |\n`;
  }

  for (const row of rows) {
    markdown += `| ${row.map((cell: NormalizedCellValue) => String(cell ?? "")).join(" | ")} |\n`;
  }

  return markdown;
}

/**
 * Formats data rows as standard CSV text.
 */
function convertSheetToCsv(rows: NormalizedCellValue[][]): string {
  return rows
    .map((row: NormalizedCellValue[]) =>
      row
        .map((cell: NormalizedCellValue) => {
          const stringified = String(cell ?? "");
          // Escape double quotes and wrap in quotes if cell contains commas, quotes, or newlines
          if (
            stringified.includes(",") ||
            stringified.includes('"') ||
            stringified.includes("\n") ||
            stringified.includes("\r")
          ) {
            return `"${stringified.replace(/"/g, '""')}"`;
          }
          return stringified;
        })
        .join(",")
    )
    .join("\n");
}

/**
 * Download a spreadsheet file from a URL and extract its tabular data.
 * Supports Excel (.xlsx, .xls) and CSV/TSV formats.
 */
export async function readSpreadsheetUrl(url: string, options: SpreadsheetOptions = {}) {
  if (!url || typeof url !== "string") {
    return { error: "URL is required" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MILLISECONDS);

    const response = await fetchPublicOrOwnUrl(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/tab-separated-values,*/*",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}`, url };
    }

    // Detect format based on content-type header and URL file extension
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const urlObject = new URL(url);
    const fileExtension = extname(urlObject.pathname).toLowerCase();

    let detectedFormat: "xlsx" | "xls" | "csv" | "tsv" | null = null;
    if (contentType.includes("spreadsheetml") || fileExtension === ".xlsx") {
      detectedFormat = "xlsx";
    } else if (contentType.includes("ms-excel") || fileExtension === ".xls") {
      detectedFormat = "xls";
    } else if (contentType.includes("csv") || fileExtension === ".csv") {
      detectedFormat = "csv";
    } else if (contentType.includes("tab-separated-values") || fileExtension === ".tsv") {
      detectedFormat = "tsv";
    } else if (contentType.includes("octet-stream") || contentType === "") {
      if (fileExtension === ".xlsx") detectedFormat = "xlsx";
      else if (fileExtension === ".xls") detectedFormat = "xls";
      else if (fileExtension === ".csv") detectedFormat = "csv";
      else if (fileExtension === ".tsv") detectedFormat = "tsv";
    }

    if (!detectedFormat) {
      return {
        error: `Unsupported or undetectable spreadsheet format (content-type: ${contentType}, extension: ${fileExtension})`,
        url,
      };
    }

    // Check content length
    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_SPREADSHEET_BYTES) {
      return {
        error: `Spreadsheet too large: ${(contentLength / 1_048_576).toFixed(1)} MB (max: 10 MB)`,
        url,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_SPREADSHEET_BYTES) {
      return {
        error: `Spreadsheet too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 10 MB)`,
        url,
      };
    }

    const workbook = new ExcelJS.Workbook();
    if (detectedFormat === "xlsx" || detectedFormat === "xls") {
      // ExcelJS does not natively support old binary .xls format, but we load it and catch potential zip parsing errors.
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } else {
      // CSV or TSV
      const csvOptions: Partial<ExcelJS.CsvReadOptions> = {};
      if (detectedFormat === "tsv") {
        csvOptions.parserOptions = {
          delimiter: "\t",
        };
      }
      const stream = Readable.from(buffer);
      await workbook.csv.read(stream, csvOptions);
    }

    let worksheets = workbook.worksheets;
    if (options.sheet !== undefined) {
      let targetSheet: ExcelJS.Worksheet | undefined;
      if (typeof options.sheet === "number") {
        targetSheet = worksheets[options.sheet];
      } else {
        const index = parseInt(options.sheet, 10);
        if (!isNaN(index)) {
          targetSheet = worksheets[index];
        } else {
          targetSheet = workbook.getWorksheet(options.sheet);
        }
      }

      if (!targetSheet) {
        return {
          error: `Sheet not found: ${options.sheet}`,
          url,
        };
      }
      worksheets = [targetSheet];
    }

    const maxRowsLimit = options.maxRows !== undefined
      ? parseInt(String(options.maxRows), 10)
      : MAX_ROWS_PER_SHEET;

    const includeHeaders = options.includeHeaders !== false;
    const outputFormat = options.outputFormat || "json";

    const extractedSheets: ExtractedSheet[] = [];
    let worksheetIndex = 0;

    for (const worksheet of worksheets) {
      let headers: string[] | null = null;
      let startingRowIndex = 1;

      if (includeHeaders && worksheet.rowCount > 0) {
        const firstRow = worksheet.getRow(1);
        headers = [];
        for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber++) {
          const rawValue = firstRow.getCell(columnNumber).value;
          const normalized = String(normalizeCellValue(rawValue) ?? "").trim();
          headers.push(normalized || `Column_${columnNumber}`);
        }
        startingRowIndex = 2;
      }

      const rows: (Record<string, NormalizedCellValue> | NormalizedCellValue[])[] = [];
      const rawRows: NormalizedCellValue[][] = [];
      let rowsExtracted = 0;
      let isSheetTruncated = false;

      for (let rowIndex = startingRowIndex; rowIndex <= worksheet.rowCount; rowIndex++) {
        if (rowsExtracted >= maxRowsLimit) {
          isSheetTruncated = true;
          break;
        }

        const row = worksheet.getRow(rowIndex);
        const rowValues: NormalizedCellValue[] = [];

        for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber++) {
          const cellValue = normalizeCellValue(row.getCell(columnNumber).value);
          rowValues.push(cellValue);
        }

        rawRows.push(rowValues);

        if (includeHeaders && headers) {
          const rowObject: Record<string, NormalizedCellValue> = {};
          for (let columnNumber = 0; columnNumber < headers.length; columnNumber++) {
            rowObject[headers[columnNumber]] = rowValues[columnNumber] ?? null;
          }
          rows.push(rowObject);
        } else {
          rows.push(rowValues);
        }

        rowsExtracted++;
      }

      extractedSheets.push({
        name: worksheet.name,
        index: worksheetIndex,
        rowCount: worksheet.rowCount,
        columnCount: worksheet.columnCount,
        headers,
        rows,
        rawRows,
        truncated: isSheetTruncated,
      });

      worksheetIndex++;
    }

    const maxCharactersLimit = options.maxChars
      ? parseInt(String(options.maxChars), 10)
      : MAX_TEXT_CHARACTERS;

    if (outputFormat === "markdown") {
      let markdownContent = extractedSheets
        .map((sheet: ExtractedSheet) => convertSheetToMarkdown(sheet.name, sheet.headers, sheet.rawRows))
        .join("\n\n");

      const isOutputTruncated = markdownContent.length > maxCharactersLimit;
      if (isOutputTruncated) {
        markdownContent = markdownContent.slice(0, maxCharactersLimit) + "\n\n... [truncated]";
      }

      return {
        url,
        format: detectedFormat,
        sheetCount: workbook.worksheets.length,
        content: markdownContent,
        charCount: markdownContent.length,
        truncated: isOutputTruncated,
      };
    }

    if (outputFormat === "csv") {
      let csvContent = extractedSheets
        .map((sheet: ExtractedSheet) => {
          const csvRows: NormalizedCellValue[][] = [];
          if (sheet.headers) {
            csvRows.push(sheet.headers);
          }
          csvRows.push(...sheet.rawRows);
          return convertSheetToCsv(csvRows);
        })
        .join("\n\n");

      const isOutputTruncated = csvContent.length > maxCharactersLimit;
      if (isOutputTruncated) {
        csvContent = csvContent.slice(0, maxCharactersLimit) + "\n\n... [truncated]";
      }

      return {
        url,
        format: detectedFormat,
        sheetCount: workbook.worksheets.length,
        content: csvContent,
        charCount: csvContent.length,
        truncated: isOutputTruncated,
      };
    }

    // Default: JSON output format
    const jsonResponse: SpreadsheetJsonResponse = {
      url,
      format: detectedFormat,
      sheetCount: workbook.worksheets.length,
      sheets: extractedSheets.map((sheet: ExtractedSheet) => ({
        name: sheet.name,
        index: sheet.index,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        headers: sheet.headers,
        rows: sheet.rows,
        truncated: sheet.truncated,
      })),
      totalRowCount: extractedSheets.reduce((sum: number, sheet: ExtractedSheet) => sum + sheet.rowCount, 0),
      charCount: 0,
      truncated: false,
    };

    let currentLength = JSON.stringify(jsonResponse).length;
    if (currentLength > maxCharactersLimit) {
      jsonResponse.truncated = true;

      // Programmatically drop rows from the end of sheets to fit the output limit
      while (currentLength > maxCharactersLimit) {
        let maxSheetIndex = -1;
        let maxRowsCount = 0;

        for (let sheetIndex = 0; sheetIndex < jsonResponse.sheets.length; sheetIndex++) {
          if (jsonResponse.sheets[sheetIndex].rows.length > maxRowsCount) {
            maxRowsCount = jsonResponse.sheets[sheetIndex].rows.length;
            maxSheetIndex = sheetIndex;
          }
        }

        if (maxSheetIndex === -1 || maxRowsCount === 0) {
          break;
        }

        jsonResponse.sheets[maxSheetIndex].rows.pop();
        jsonResponse.sheets[maxSheetIndex].truncated = true;

        currentLength = JSON.stringify(jsonResponse).length;
      }
    }

    jsonResponse.charCount = currentLength;
    return jsonResponse;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        error: `Spreadsheet download timed out after ${FETCH_TIMEOUT_MILLISECONDS / 1000}s`,
        url,
      };
    }
    return {
      error: `Spreadsheet extraction failed: ${errorMessage(error)}`,
      url,
    };
  }
}
