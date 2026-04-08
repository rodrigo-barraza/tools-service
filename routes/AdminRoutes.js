import { Router } from "express";
import {
  queryRequestLogs,
  getRequestStats,
} from "../middleware/RequestLoggerMiddleware.js";
import {
  getToolSchemas,
  getToolSchemasForAI,
  getDisabledTools,
} from "../services/ToolSchemaService.js";
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

export default router;
