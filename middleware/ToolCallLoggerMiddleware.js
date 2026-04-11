// ============================================================
// Tool Call Logger Middleware
// ============================================================
// Tracks individual tool-call-level telemetry to the
// `tool_calls` collection in MongoDB. Similar pattern to
// Prism's RequestLogger but focused on tool execution
// performance, args, results, and caller context.
//
// This middleware intercepts JSON responses on routes that
// correspond to registered tool endpoints. It builds a
// reverse map from endpoint path → tool name using the
// ToolSchemaService definitions, so every tool invocation
// is automatically captured with zero per-route boilerplate.
// ============================================================

import { performance } from "node:perf_hooks";
import logger from "../logger.js";
import { getDB } from "../db.js";
import { getToolSchemas } from "../services/ToolSchemaService.js";

const COLLECTION = "tool_calls";

// ────────────────────────────────────────────────────────────
// Reverse Map: HTTP path -> { toolName, domain }
// ────────────────────────────────────────────────────────────
// Built lazily on first request and refreshed periodically
// in case tool definitions change at runtime.

// Map: path -> { toolName, domain, method }
let pathToToolMap = new Map();
let lastMapBuild = 0;
const MAP_REBUILD_INTERVAL_MS = 60_000; // Rebuild every 60s

/**
 * Normalize a path template to a regex-ish key for matching.
 * Strips :param segments to just a pattern prefix.
 * e.g. "/weather/live" stays "/weather/live"
 *      "/finance/stock/:symbol/quote" becomes "/finance/stock/STAR/quote"
 */
function normalizePathTemplate(pathTemplate) {
  return pathTemplate.replace(/:[^/]+/g, "*");
}

/**
 * Normalize an actual request path to match against templates.
 * Replaces path segments that look like dynamic values.
 */
function normalizeRequestPath(actualPath) {
  // Strip query string
  const clean = actualPath.split("?")[0];
  return clean;
}

/**
 * Build the reverse path → tool map from ToolSchemaService.
 */
function rebuildPathMap() {
  const schemas = getToolSchemas();
  const newMap = new Map();

  for (const schema of schemas) {
    if (!schema.endpoint?.path) continue;
    const key = normalizePathTemplate(schema.endpoint.path);
    newMap.set(key, {
      toolName: schema.name,
      domain: schema.domain || "Other",
      method: schema.endpoint.method || "GET",
    });
  }

  pathToToolMap = newMap;
  lastMapBuild = Date.now();
}

/**
 * Resolve a request to its tool metadata.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {{ toolName: string, domain: string } | null}
 */
function resolveToolFromRequest(method, path) {
  // Rebuild map periodically
  if (Date.now() - lastMapBuild > MAP_REBUILD_INTERVAL_MS) {
    rebuildPathMap();
  }

  const cleanPath = normalizeRequestPath(path);

  // Direct match first (most common — non-parameterized routes)
  if (pathToToolMap.has(cleanPath)) {
    const entry = pathToToolMap.get(cleanPath);
    if (!entry.method || entry.method === method) {
      return entry;
    }
  }

  // Parameterized match — replace path segments with * and try
  for (const [pattern, entry] of pathToToolMap) {
    if (!pattern.includes("*")) continue;
    if (entry.method && entry.method !== method) continue;

    // Build regex from pattern
    const regexStr =
      "^" +
      pattern
        .replace(/\*/g, "[^/]+")
        .replace(/\//g, "\\/") +
      "$";

    if (new RegExp(regexStr).test(cleanPath)) {
      return entry;
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────

/**
 * Express middleware that logs tool-call-level telemetry.
 * Intercepts responses, identifies which tool was called,
 * and persists structured telemetry to MongoDB.
 */
export function toolCallLoggerMiddleware(req, res, next) {
  const start = performance.now();

  // Capture the response body by monkey-patching res.json
  const originalJson = res.json.bind(res);
  let responseBody = null;

  res.json = (data) => {
    responseBody = data;
    return originalJson(data);
  };

  res.on("finish", () => {
    const elapsed = performance.now() - start;
    const method = req.method;
    const path = req.originalUrl;
    const status = res.statusCode;

    // Skip non-tool routes (admin, health checks, etc.)
    // Only GET and POST are tool invocation methods
    if (method !== "GET" && method !== "POST") return;

    // Skip admin and internal endpoints
    if (path.startsWith("/admin")) return;
    if (path === "/health") return;

    const tool = resolveToolFromRequest(method, path);
    if (!tool) return;

    // Extract caller context from headers (sent by Prism/Retina)
    const callerProject = req.headers["x-project"] || null;
    const callerUsername = req.headers["x-username"] || null;
    const callerAgent = req.headers["x-agent"] || null;
    const callerRequestId = req.headers["x-request-id"] || null;
    const callerConversationId = req.headers["x-conversation-id"] || null;
    const callerIteration = req.headers["x-iteration"]
      ? parseInt(req.headers["x-iteration"], 10)
      : null;
    const clientIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;

    // Request / response sizes
    const inBytes = parseInt(req.headers["content-length"] || "0", 10);
    const outBytes = parseInt(res.getHeader("content-length") || "0", 10);

    // Determine success from status code AND response body
    const success = status >= 200 && status < 400 && !responseBody?.error;
    const errorMessage = responseBody?.error || null;

    // Sanitize args — strip large payloads to keep docs lean
    const args = sanitizeArgs(method === "POST" ? req.body : req.query);

    // Sanitize result — keep shape info but cap size
    const result = sanitizeResult(responseBody);

    // Persist (fire-and-forget)
    persistToolCall({
      toolName: tool.toolName,
      domain: tool.domain,
      method,
      path: path.split("?")[0],
      status,
      success,
      errorMessage,

      // Performance
      elapsedMs: Math.round(elapsed * 100) / 100,
      inBytes,
      outBytes,

      // Args & Result
      args,
      result,

      // Caller context
      callerProject,
      callerUsername,
      callerAgent,
      callerRequestId,
      callerConversationId,
      callerIteration,
      clientIp,

      timestamp: new Date(),
    }).catch(() => {});
  });

  next();
}

// ────────────────────────────────────────────────────────────
// Sanitization — keep docs lean
// ────────────────────────────────────────────────────────────

const MAX_ARG_LENGTH = 500;
const MAX_RESULT_ITEMS = 3;

/**
 * Sanitize tool arguments for storage. Caps long strings,
 * strips base64 data, keeps structure readable.
 */
function sanitizeArgs(args) {
  if (!args || typeof args !== "object") return args;

  const sanitized = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > MAX_ARG_LENGTH) {
      sanitized[key] = value.slice(0, MAX_ARG_LENGTH) + `… [${value.length} chars]`;
    } else if (typeof value === "string" && value.startsWith("data:")) {
      sanitized[key] = "[base64 data]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Sanitize the response body for storage. Keeps metadata
 * (count, total, etc.) but truncates large arrays/objects.
 */
function sanitizeResult(body) {
  if (!body || typeof body !== "object") return body;

  const result = {};

  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      result[key] = {
        _type: "array",
        _count: value.length,
        _sample: value.slice(0, MAX_RESULT_ITEMS),
      };
    } else if (key === "error") {
      result[key] = value;
    } else if (typeof value === "object" && value !== null) {
      // Keep shallow objects, but cap nested arrays
      const nested = {};
      for (const [nk, nv] of Object.entries(value)) {
        if (Array.isArray(nv)) {
          nested[nk] = { _type: "array", _count: nv.length };
        } else {
          nested[nk] = nv;
        }
      }
      result[key] = nested;
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────

/**
 * Persist a tool-call log entry to MongoDB.
 */
async function persistToolCall(entry) {
  try {
    const db = getDB();
    await db.collection(COLLECTION).insertOne(entry);
  } catch {
    // Silently fail — logging should never break the app
  }
}

// ────────────────────────────────────────────────────────────
// Query API — consumed by AdminRoutes
// ────────────────────────────────────────────────────────────

/**
 * Query tool-call logs with optional filters.
 * @param {object} [filters]
 * @param {string} [filters.toolName] - Exact tool name
 * @param {string} [filters.domain] - Domain filter
 * @param {boolean} [filters.success] - Success/failure filter
 * @param {string} [filters.callerAgent] - Agent name filter
 * @param {string} [filters.callerProject] - Project name filter
 * @param {number} [filters.minMs] - Minimum elapsed ms
 * @param {number} [filters.maxMs] - Maximum elapsed ms
 * @param {string} [filters.since] - ISO date lower bound
 * @param {string} [filters.until] - ISO date upper bound
 * @param {number} [filters.limit] - Max results (default 100)
 * @param {number} [filters.skip] - Offset for pagination
 * @returns {Promise<{ total: number, count: number, toolCalls: object[] }>}
 */
export async function queryToolCallLogs(filters = {}) {
  const db = getDB();
  const query = {};

  if (filters.toolName) query.toolName = filters.toolName;
  if (filters.domain) query.domain = filters.domain;
  if (filters.success !== undefined) query.success = filters.success === "true" || filters.success === true;
  if (filters.callerAgent) query.callerAgent = filters.callerAgent;
  if (filters.callerProject) query.callerProject = filters.callerProject;

  if (filters.minMs || filters.maxMs) {
    query.elapsedMs = {};
    if (filters.minMs) query.elapsedMs.$gte = parseFloat(filters.minMs);
    if (filters.maxMs) query.elapsedMs.$lte = parseFloat(filters.maxMs);
  }

  if (filters.since || filters.until) {
    query.timestamp = {};
    if (filters.since) query.timestamp.$gte = new Date(filters.since);
    if (filters.until) query.timestamp.$lte = new Date(filters.until);
  }

  const limit = parseInt(filters.limit || "100", 10);
  const skip = parseInt(filters.skip || "0", 10);

  const [toolCalls, total] = await Promise.all([
    db
      .collection(COLLECTION)
      .find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(COLLECTION).countDocuments(query),
  ]);

  return { total, count: toolCalls.length, toolCalls };
}

/**
 * Get aggregated tool-call statistics.
 * @param {string} [since] - ISO date string for time window
 * @returns {Promise<object>}
 */
export async function getToolCallStats(since) {
  const db = getDB();
  const match = since ? { timestamp: { $gte: new Date(since) } } : {};

  const [
    totalCalls,
    byTool,
    byDomain,
    bySuccess,
    slowest,
    errorRate,
  ] = await Promise.all([
    // Total count
    db.collection(COLLECTION).countDocuments(match),

    // By tool name — count + avg/p95/max latency
    db
      .collection(COLLECTION)
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: "$toolName",
            count: { $sum: 1 },
            avgMs: { $avg: "$elapsedMs" },
            maxMs: { $max: "$elapsedMs" },
            minMs: { $min: "$elapsedMs" },
            errors: {
              $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] },
            },
            totalBytes: { $sum: { $add: ["$inBytes", "$outBytes"] } },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray(),

    // By domain
    db
      .collection(COLLECTION)
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: "$domain",
            count: { $sum: 1 },
            avgMs: { $avg: "$elapsedMs" },
            errors: {
              $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] },
            },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray(),

    // Success vs failure breakdown
    db
      .collection(COLLECTION)
      .aggregate([
        { $match: match },
        { $group: { _id: "$success", count: { $sum: 1 } } },
      ])
      .toArray(),

    // Top 10 slowest calls
    db
      .collection(COLLECTION)
      .find(match)
      .sort({ elapsedMs: -1 })
      .limit(10)
      .project({
        toolName: 1,
        domain: 1,
        elapsedMs: 1,
        success: 1,
        errorMessage: 1,
        callerAgent: 1,
        timestamp: 1,
      })
      .toArray(),

    // Error rate per tool (only tools with errors)
    db
      .collection(COLLECTION)
      .aggregate([
        { $match: { ...match, success: false } },
        {
          $group: {
            _id: "$toolName",
            errorCount: { $sum: 1 },
            lastError: { $last: "$errorMessage" },
            lastErrorAt: { $max: "$timestamp" },
          },
        },
        { $sort: { errorCount: -1 } },
      ])
      .toArray(),
  ]);

  const successMap = Object.fromEntries(
    bySuccess.map((s) => [s._id ? "success" : "failure", s.count]),
  );

  return {
    totalCalls,
    successRate: totalCalls > 0
      ? Math.round(((successMap.success || 0) / totalCalls) * 10000) / 100
      : 0,
    byTool: byTool.map((t) => ({
      toolName: t._id,
      count: t.count,
      avgMs: Math.round(t.avgMs * 100) / 100,
      maxMs: Math.round(t.maxMs * 100) / 100,
      minMs: Math.round(t.minMs * 100) / 100,
      errors: t.errors,
      errorRate: t.count > 0
        ? Math.round((t.errors / t.count) * 10000) / 100
        : 0,
      totalTransferBytes: t.totalBytes,
    })),
    byDomain: byDomain.map((d) => ({
      domain: d._id,
      count: d.count,
      avgMs: Math.round(d.avgMs * 100) / 100,
      errors: d.errors,
    })),
    breakdown: successMap,
    slowest,
    errorsByTool: errorRate,
  };
}

// ────────────────────────────────────────────────────────────
// Collection Setup — indexes for efficient querying
// ────────────────────────────────────────────────────────────

/**
 * Create indexes on the tool_calls collection.
 * Called during server startup alongside other model setups.
 */
export async function setupToolCallsCollection() {
  try {
    const db = getDB();
    const col = db.collection(COLLECTION);

    await Promise.all([
      col.createIndex({ timestamp: -1 }),
      col.createIndex({ toolName: 1, timestamp: -1 }),
      col.createIndex({ domain: 1, timestamp: -1 }),
      col.createIndex({ success: 1, timestamp: -1 }),
      col.createIndex({ callerAgent: 1, timestamp: -1 }),
      col.createIndex({ elapsedMs: -1 }),
    ]);

    logger.info(`📊 tool_calls collection indexes ensured`);
  } catch (err) {
    logger.error(`Failed to setup tool_calls indexes: ${err.message}`);
  }
}
