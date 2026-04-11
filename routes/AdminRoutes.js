import { Router } from "express";
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
import { ALLOWED_ROOTS } from "../services/AgenticFileService.js";
import { asyncHandler } from "../utilities.js";

const router = Router();

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
 */
router.get("/config", (_req, res) => {
  res.json({
    workspaceRoots: ALLOWED_ROOTS,
  });
});

export default router;

