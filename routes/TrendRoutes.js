import { parseIntParam } from "@rodrigo-barraza/utilities";
import { Router } from "express";
import {
  getRecentTrends,
  searchTrendsDB,
  getTopTrends,
} from "../models/Trend.js";
import {
  getAll,
  getBySource,
  getByCategory,
  getCorrelatedTrends,
  searchTrends,
  getHealth,
} from "../caches/TrendCache.js";
import {  } from "../utilities.js";
const router = Router();
router.get("/trends", (_req, res) => {
  res.json(getAll());
});
router.get("/trends/hot", (_req, res) => {
  res.json(getCorrelatedTrends());
});
router.get("/trends/source/:source", (req, res) => {
  res.json(getBySource(req.params.source));
});
router.get("/trends/category/:category", (req, res) => {
  res.json(getByCategory(req.params.category));
});
router.get("/trends/search", (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchTrends(query));
});
router.get("/trends/recent", async (req, res) => {
  const hours = parseIntParam(req.query.hours, 24);
  const category = req.query.category || null;
  const source = req.query.source || null;
  const limit = parseIntParam(req.query.limit, 50);
  res.json(await getRecentTrends(hours, category, source, limit));
});
router.get("/trends/top", async (req, res) => {
  const hours = parseIntParam(req.query.hours, 24);
  const limit = parseIntParam(req.query.limit, 20);
  res.json(await getTopTrends(hours, limit));
});
router.get("/trends/db/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  const limit = parseIntParam(req.query.limit, 50);
  res.json(await searchTrendsDB(query, limit));
});
export function getTrendHealth() {
  return getHealth();
}
// ── Unified Trends Dispatcher ──────────────────────────────────────
router.get("/data", async (req, res) => {
  const { action, source, hours, limit: rawLimit } = req.query;
  if (!action) return res.status(400).json({ error: "'action' is required", actions: ["current", "hot", "top"] });
  const limit = parseIntParam(rawLimit, undefined);
  switch (action) {
    case "current": {
      const trends = source ? getBySource(source) : getAll();
      return res.json({ action, ...trends });
    }
    case "hot":
      return res.json({ action, ...getCorrelatedTrends() });
    case "top": {
      const h = parseIntParam(hours, 24);
      return res.json({ action, ...(await getTopTrends(h, limit || 20)) });
    }
    default:
      return res.status(400).json({ error: `Unknown action: ${action}`, actions: ["current", "hot", "top"] });
  }
});
export default router;
