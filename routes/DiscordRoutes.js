import { Router } from "express";
import DiscordDataService from "../services/DiscordDataService.js";
import { asyncHandler, parseIntParam, HealthTracker } from "../utilities.js";

const router = Router();

// ─── Health ─────────────────────────────────────────────────────

const health = new HealthTracker();

export function getDiscordHealth() {
  return health.getHealth();
}

const opts = { errorStatus: 500, health };

// ─── GET /messages/search ───────────────────────────────────────
// Search Discord messages with flexible filters.
// Query: ?guildId=...&channelId=...&userId=...&query=...&before=...&after=...&limit=50&mode=messages

router.get(
  "/messages/search",
  asyncHandler((req) => {
    return DiscordDataService.searchMessages({
      guildId: req.query.guildId,
      channelId: req.query.channelId,
      userId: req.query.userId,
      username: req.query.username,
      query: req.query.query,
      before: req.query.before,
      after: req.query.after,
      limit: parseIntParam(req.query.limit, 50),
      mode: req.query.mode || "messages",
    });
  }, "Message search", opts),
);

// ─── GET /messages/analytics ────────────────────────────────────
// Aggregate Discord messages with group-by queries.
// Query: ?guildId=...&groupBy=user&query=...&before=...&after=...&topN=25

router.get(
  "/messages/analytics",
  asyncHandler((req) => {
    return DiscordDataService.analyzeMessages({
      guildId: req.query.guildId,
      channelId: req.query.channelId,
      userId: req.query.userId,
      username: req.query.username,
      query: req.query.query,
      before: req.query.before,
      after: req.query.after,
      groupBy: req.query.groupBy || "user",
      topN: parseIntParam(req.query.topN, 25),
    });
  }, "Message analytics", opts),
);

// ─── GET /activity ──────────────────────────────────────────────
// Get server activity stats: top users, channel breakdown, hourly distribution.
// Query: ?guildId=...&channelId=...&days=7&topN=15

router.get(
  "/activity",
  asyncHandler((req) => {
    return DiscordDataService.getServerActivity({
      guildId: req.query.guildId,
      channelId: req.query.channelId,
      days: parseIntParam(req.query.days, 7),
      topN: parseIntParam(req.query.topN, 15),
    });
  }, "Server activity", opts),
);

export default router;
