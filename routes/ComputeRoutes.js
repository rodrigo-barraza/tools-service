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
import crypto from "node:crypto";
import {
  executeJavaScript,
  getJsInterpreterInfo,
} from "../services/JavaScriptInterpreterService.js";
import {
  executeShell,
  getAllowedBinaries,
} from "../services/ShellExecutorService.js";
import CONFIG from "../config.js";

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
  if (code.length > 100_000) {
    return res
      .status(400)
      .json({ error: "Code exceeds maximum length of 100,000 characters" });
  }
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
  if (command.length > 10_000) {
    return res
      .status(400)
      .json({ error: "Command exceeds maximum length of 10,000 characters" });
  }
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

const CSV_STORE = new Map();
const CSV_TTL_MS = 60 * 60 * 1000; // 1 hour

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

    const id = crypto.randomUUID().slice(0, 12);
    CSV_STORE.set(id, { csv, filename: filename || "export.csv", createdAt: Date.now() });

    // Lazy cleanup
    if (CSV_STORE.size > 200) {
      const now = Date.now();
      for (const [k, v] of CSV_STORE) {
        if (now - v.createdAt > CSV_TTL_MS) CSV_STORE.delete(k);
      }
    }

    const downloadUrl = `http://localhost:${CONFIG.TOOLS_PORT}/compute/csv/download?id=${id}`;
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

  const entry = CSV_STORE.get(id);
  if (!entry || Date.now() - entry.createdAt > CSV_TTL_MS) {
    CSV_STORE.delete(id);
    return res.status(404).send("CSV not found or expired");
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${entry.filename}"`);
  res.send(entry.csv);
});

// ═══════════════════════════════════════════════════════════════
// 7. QR Code Generation
// ═══════════════════════════════════════════════════════════════

const QR_STORE = new Map();
const QR_TTL_MS = 60 * 60 * 1000;

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

    const id = crypto.randomUUID().slice(0, 12);
    QR_STORE.set(id, { buffer: pngBuffer, createdAt: Date.now() });

    // Lazy cleanup
    if (QR_STORE.size > 200) {
      const now = Date.now();
      for (const [k, v] of QR_STORE) {
        if (now - v.createdAt > QR_TTL_MS) QR_STORE.delete(k);
      }
    }

    const qrImageUrl = `http://localhost:${CONFIG.TOOLS_PORT}/compute/qr/render?id=${id}`;
    res.json({ qrImageUrl, qrId: id, dataLength: data.length });
  } catch (err) {
    res.status(400).json({ error: `QR code generation failed: ${err.message}` });
  }
});

router.get("/qr/render", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = QR_STORE.get(id);
  if (!entry || Date.now() - entry.createdAt > QR_TTL_MS) {
    QR_STORE.delete(id);
    return res.status(404).send("QR code not found or expired");
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(entry.buffer);
});

// ═══════════════════════════════════════════════════════════════
// 8. LaTeX Rendering (KaTeX CDN embed)
// ═══════════════════════════════════════════════════════════════

const LATEX_STORE = new Map();
const LATEX_TTL_MS = 60 * 60 * 1000;

function buildLatexEmbedHtml(latex, displayMode = true) {
  const escaped = latex
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"><\/script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:#0f172a;
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
    padding:24px;
  }
  #math{
    color:#e2e8f0;
    font-size:1.4em;
    max-width:100%;
    overflow-x:auto;
  }
  .katex{font-size:1.4em}
  .katex .base{color:#e2e8f0}
</style>
</head><body>
<div id="math"></div>
<script>
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
<\/script>
</body></html>`;
}

router.post("/latex", (req, res) => {
  const { latex, displayMode } = req.body;
  if (!latex || typeof latex !== "string") {
    return res.status(400).json({ error: "'latex' (string) is required" });
  }
  if (latex.length > 10_000) {
    return res.status(400).json({ error: "LaTeX expression exceeds 10,000 characters" });
  }

  const id = crypto.randomUUID().slice(0, 12);
  LATEX_STORE.set(id, {
    latex,
    displayMode: displayMode !== false,
    createdAt: Date.now(),
  });

  // Lazy cleanup
  if (LATEX_STORE.size > 200) {
    const now = Date.now();
    for (const [k, v] of LATEX_STORE) {
      if (now - v.createdAt > LATEX_TTL_MS) LATEX_STORE.delete(k);
    }
  }

  const latexEmbedUrl = `http://localhost:${CONFIG.TOOLS_PORT}/compute/latex/embed?id=${id}`;
  res.json({ latexEmbedUrl, latexId: id });
});

router.get("/latex/embed", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = LATEX_STORE.get(id);
  if (!entry || Date.now() - entry.createdAt > LATEX_TTL_MS) {
    LATEX_STORE.delete(id);
    return res.status(404).send("LaTeX not found or expired");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildLatexEmbedHtml(entry.latex, entry.displayMode));
});

// ═══════════════════════════════════════════════════════════════
// 9. Mermaid Diagram Rendering (CDN embed)
// ═══════════════════════════════════════════════════════════════

const DIAGRAM_STORE = new Map();
const DIAGRAM_TTL_MS = 60 * 60 * 1000;

function buildMermaidEmbedHtml(definition, theme = "dark") {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:#0f172a;
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
    padding:24px;
  }
  #diagram{
    max-width:100%;
    overflow-x:auto;
  }
  #diagram svg{
    max-width:100%;
    height:auto;
  }
</style>
</head><body>
<div id="diagram"></div>
<script type="module">
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
<\/script>
</body></html>`;
}

router.post("/diagram", (req, res) => {
  const { definition, theme } = req.body;
  if (!definition || typeof definition !== "string") {
    return res.status(400).json({ error: "'definition' (Mermaid syntax string) is required" });
  }
  if (definition.length > 50_000) {
    return res.status(400).json({ error: "Diagram definition exceeds 50,000 characters" });
  }

  const id = crypto.randomUUID().slice(0, 12);
  DIAGRAM_STORE.set(id, {
    definition,
    theme: theme || "dark",
    createdAt: Date.now(),
  });

  // Lazy cleanup
  if (DIAGRAM_STORE.size > 200) {
    const now = Date.now();
    for (const [k, v] of DIAGRAM_STORE) {
      if (now - v.createdAt > DIAGRAM_TTL_MS) DIAGRAM_STORE.delete(k);
    }
  }

  const diagramEmbedUrl = `http://localhost:${CONFIG.TOOLS_PORT}/compute/diagram/embed?id=${id}`;
  res.json({ diagramEmbedUrl, diagramId: id });
});

router.get("/diagram/embed", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Missing 'id' parameter");

  const entry = DIAGRAM_STORE.get(id);
  if (!entry || Date.now() - entry.createdAt > DIAGRAM_TTL_MS) {
    DIAGRAM_STORE.delete(id);
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
  };
}

export default router;
