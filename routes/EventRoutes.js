import { parseIntParam } from "@rodrigo-barraza/utilities";
import { Router } from "express";
import CONFIG from "../config.js";
import {
  getEventsToday,
  getEventsUpcoming,
  getEventsPast,
  searchEvents,
  getEventBySourceId,
} from "../models/Event.js";
import {
  getLatestEvents,
  getEventSummary,
  getHealth,
} from "../caches/EventCache.js";
import {  } from "../utilities.js";
const router = Router();
// ─── Event Endpoints ───────────────────────────────────────────────
router.get("/today", async (_req, res) => {
  const events = await getEventsToday(CONFIG.TIMEZONE);
  res.json({ count: events.length, timezone: CONFIG.TIMEZONE, events });
});
router.get("/upcoming", async (req, res) => {
  const days = parseIntParam(req.query.days, 30);
  const limit = parseIntParam(req.query.limit, 200);
  const events = await getEventsUpcoming(days, limit);
  res.json({ count: events.length, days, events });
});
router.get("/past", async (req, res) => {
  const days = parseIntParam(req.query.days, 30);
  const limit = parseIntParam(req.query.limit, 200);
  const events = await getEventsPast(days, limit);
  res.json({ count: events.length, days, events });
});
router.get("/search", async (req, res) => {
  const { q, category, city, source } = req.query;
  const limit = parseIntParam(req.query.limit, 100);
  const events = await searchEvents({ q, category, city, source, limit });
  res.json({
    count: events.length,
    query: { q, category, city, source },
    events,
  });
});
router.get("/summary", (_req, res) => {
  res.json(getEventSummary());
});
router.get("/cached", (_req, res) => {
  const events = getLatestEvents();
  res.json({ count: events.length, events });
});
router.get("/:source/:id", async (req, res) => {
  const event = await getEventBySourceId(req.params.source, req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  res.json(event);
});
// ── Unified Events Dispatcher ──────────────────────────────────────
router.get("/events", async (req, res) => {
  const { action, q, source, category, days, limit: rawLimit } = req.query;
  if (!action) return res.status(400).json({ error: "'action' is required", actions: ["search", "upcoming", "today", "summary"] });
  const limit = parseIntParam(rawLimit, undefined);
  switch (action) {
    case "search": {
      const events = await searchEvents({ q, category, source, limit: limit || 100 });
      return res.json({ action, count: events.length, query: { q, category, source }, events });
    }
    case "upcoming": {
      const d = parseIntParam(days, 30);
      const events = await getEventsUpcoming(d, limit || 200);
      return res.json({ action, count: events.length, days: d, events });
    }
    case "today": {
      const events = await getEventsToday(CONFIG.TIMEZONE);
      return res.json({ action, count: events.length, timezone: CONFIG.TIMEZONE, events });
    }
    case "summary":
      return res.json({ action, ...getEventSummary() });
    default:
      return res.status(400).json({ error: `Unknown action: ${action}`, actions: ["search", "upcoming", "today", "summary"] });
  }
});
// ─── Domain Health ─────────────────────────────────────────────────
export function getEventHealth() {
  return getHealth();
}
export default router;
