import { asyncHandler } from "@rodrigo-barraza/utilities-library/node";
import { Router } from "express";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  queryRequestLogs,
  getRequestStats,
} from "../middleware/RequestLoggerMiddleware.js";
import {
  queryToolCallLogs,
  getToolCallStats,
} from "../middleware/ToolCallLoggerMiddleware.js";
import {
  getToolSchemas,
  getToolSchemasForAI,
  getDisabledTools,
} from "../services/ToolSchemaService.js";
import {
  ALLOWED_ROOTS,
  getStaticRoots,
  refreshAllowedRoots,
} from "../services/AgenticFileService.js";
import { getDB } from "../db.js";
const router = Router();
// ─── Path Translation ─────────────────────────────────────────────
const WORKSPACE_COLLECTION = "workspace_config";
/**
 * Convert a Windows-style path to a WSL mount path.
 * e.g. C:\Users\foo\bar → /mnt/c/Users/foo/bar
 * Returns null if the path is not a Windows path.
 */
function windowsToWslPath(winPath) {
  const match = winPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (!match) return null;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}
/**
 * Detect whether a path is Windows-style.
 */
function isWindowsPath(path) {
  return /^[A-Za-z]:[/\\]/.test(path);
}
/**
 * Resolve a user-supplied path to a WSL-native absolute path.
 * Windows paths are translated, WSL paths are resolved as-is.
 */
function resolveWorkspacePath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (isWindowsPath(trimmed)) {
    return windowsToWslPath(trimmed);
  }
  return resolve(trimmed);
}
// ─── Tool Schema Endpoints ────────────────────────────────────────
/**
 * GET /admin/tool-schemas
 * Full tool schemas with endpoint metadata for dynamic clients.
 */
router.get("/tool-schemas", (_req, res) => {
  res.json(getToolSchemas());
});
/**
 * GET /admin/tool-schemas/ai
 * Clean schemas for LLM consumption (no endpoint metadata).
 */
router.get("/tool-schemas/ai", (_req, res) => {
  res.json(getToolSchemasForAI());
});
/**
 * GET /admin/tool-schemas/disabled
 * Tools hidden because their required API keys are not configured.
 */
router.get("/tool-schemas/disabled", (_req, res) => {
  res.json(getDisabledTools());
});
// ─── Request Log Endpoints ─────────────────────────────────────────
/**
 * GET /admin/requests
 * Query persisted request logs with optional filters.
 * Query params: method, path, status, minStatus, maxStatus,
 *               since, until, limit, skip
 */
router.get("/requests", asyncHandler(
  (req) => queryRequestLogs(req.query),
  "Request log query",
  500,
));
/**
 * GET /admin/requests/stats
 * Aggregated request statistics.
 * Query params: since (ISO date for time window)
 */
router.get("/requests/stats", asyncHandler(
  (req) => getRequestStats(req.query.since),
  "Request stats",
  500,
));
// ─── Tool Call Telemetry Endpoints ─────────────────────────────────
/**
 * GET /admin/tool-calls
 * Query tool-call-level telemetry logs with optional filters.
 * Query params: toolName, domain, success, callerAgent, callerProject,
 *               minMs, maxMs, since, until, limit, skip
 */
router.get("/tool-calls", asyncHandler(
  (req) => queryToolCallLogs(req.query),
  "Tool call log query",
  500,
));
/**
 * GET /admin/tool-calls/stats
 * Aggregated tool-call performance statistics.
 * Returns per-tool latency metrics, domain breakdowns, error rates,
 * and the top 10 slowest tool invocations.
 * Query params: since (ISO date for time window)
 */
router.get("/tool-calls/stats", asyncHandler(
  (req) => getToolCallStats(req.query.since),
  "Tool call stats",
  500,
));
// ─── Config Endpoint ──────────────────────────────────────────────
/**
 * GET /admin/config
 * Exposes workspace configuration so downstream services (Prism)
 * can fetch it at startup instead of duplicating in their secrets.
 * Includes both the full merged list and the immutable static roots.
 */
router.get("/config", (_req, res) => {
  res.json({
    workspaceRoots: ALLOWED_ROOTS,
    staticRoots: getStaticRoots(),
  });
});
/**
 * PUT /admin/config/workspaces
 * Update user-configured workspace roots.
 * Validates each path (must be absolute, must exist on disk).
 * Static roots from config.js are always preserved.
 *
 * Body: { roots: string[] }
 */
router.put("/config/workspaces", async (req, res) => {
  const { roots } = req.body || {};
  if (!Array.isArray(roots)) {
    return res.status(400).json({ error: "'roots' must be an array of path strings" });
  }
  const staticRoots = getStaticRoots();
  const errors = [];
  const validRoots = [];
  for (const rawPath of roots) {
    const resolved = resolveWorkspacePath(rawPath);
    if (!resolved) {
      errors.push({ path: rawPath, error: "Invalid or empty path" });
      continue;
    }
    // Skip if this is already a static root
    if (staticRoots.includes(resolved)) continue;
    // Must be absolute
    if (!resolved.startsWith("/")) {
      errors.push({ path: rawPath, resolved, error: "Path must be absolute" });
      continue;
    }
    // Must exist on disk
    try {
      const st = await stat(resolved);
      if (!st.isDirectory()) {
        errors.push({ path: rawPath, resolved, error: "Path exists but is not a directory" });
        continue;
      }
    } catch {
      errors.push({ path: rawPath, resolved, error: "Directory does not exist" });
      continue;
    }
    if (!validRoots.includes(resolved)) {
      validRoots.push(resolved);
    }
  }
  // Persist to MongoDB
  const db = getDB();
  const collection = db.collection(WORKSPACE_COLLECTION);
  await collection.updateOne(
    { _key: "user_roots" },
    {
      $set: {
        roots: validRoots,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: {
        _key: "user_roots",
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  // Refresh in-memory ALLOWED_ROOTS
  refreshAllowedRoots(validRoots);
  res.json({
    workspaceRoots: ALLOWED_ROOTS,
    staticRoots: staticRoots,
    userRoots: validRoots,
    errors: errors.length > 0 ? errors : undefined,
  });
});
/**
 * POST /admin/config/workspaces/validate
 * Validate a single workspace path without persisting.
 * Useful for live input validation in the UI.
 *
 * Body: { path: string }
 */
router.post("/config/workspaces/validate", async (req, res) => {
  const { path: rawPath } = req.body || {};
  if (!rawPath || typeof rawPath !== "string") {
    return res.status(400).json({ error: "'path' is required (string)" });
  }
  const isWindows = isWindowsPath(rawPath.trim());
  const resolved = resolveWorkspacePath(rawPath);
  if (!resolved) {
    return res.json({ valid: false, error: "Could not resolve path", originalPath: rawPath });
  }
  if (!resolved.startsWith("/")) {
    return res.json({ valid: false, error: "Path must be absolute", resolvedPath: resolved, originalPath: rawPath, isWsl: isWindows });
  }
  // Check if already registered
  const alreadyRegistered = ALLOWED_ROOTS.includes(resolved);
  // Check disk existence
  let exists = false;
  let isDirectory = false;
  try {
    const st = await stat(resolved);
    exists = true;
    isDirectory = st.isDirectory();
  } catch {
    // does not exist
  }
  res.json({
    valid: exists && isDirectory && !alreadyRegistered,
    resolvedPath: resolved,
    originalPath: rawPath,
    isWsl: isWindows,
    exists,
    isDirectory,
    alreadyRegistered,
    error: !exists ? "Directory does not exist" : !isDirectory ? "Path is not a directory" : alreadyRegistered ? "Already registered as a workspace" : undefined,
  });
});
/**
 * Load user-configured workspace roots from MongoDB and merge into ALLOWED_ROOTS.
 * Called at boot time from server.js.
 */
export async function loadUserWorkspaceRoots() {
  try {
    const db = getDB();
    const collection = db.collection(WORKSPACE_COLLECTION);
    const doc = await collection.findOne({ _key: "user_roots" });
    if (doc?.roots?.length > 0) {
      refreshAllowedRoots(doc.roots);
      console.log(`   📂 User workspace roots: ${doc.roots.join(", ")}`);
    }
  } catch (err) {
    console.warn(`   ⚠️  Could not load user workspace roots: ${err.message}`);
  }
}
export default router;
