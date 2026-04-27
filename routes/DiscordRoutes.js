import { Router } from "express";
import DiscordDataService from "../services/DiscordDataService.js";
import { asyncHandler, parseIntParam, setupStreamingSSE, HealthTracker } from "../utilities.js";
import logger from "../logger.js";

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
      includeBots: req.query.includeBots === "true",
    });
  }, "Message search", opts),
);

// ─── GET /messages/stream ───────────────────────────────────────
// SSE endpoint — streams Discord messages in real-time.
// Sends an `init` event with the initial batch, then polls every
// second and pushes:
//   `new`       — messages that appeared since the last poll
//   `delete`    — IDs of messages removed since the last poll
//   `heartbeat` — keep-alive ping every 15s
// Query: ?guildId=...&channelId=...&limit=50

router.get("/messages/stream", (req, res) => {
  const guildId = req.query.guildId;
  const channelId = req.query.channelId;
  const limit = parseIntParam(req.query.limit, 50, 500);
  const includeBots = req.query.includeBots === "true";

  if (!guildId) {
    return res.status(400).json({ error: "guildId is required" });
  }

  // Set SSE headers (Content-Type: text/event-stream, etc.)
  setupStreamingSSE(res);
  let closed = false;

  // Track known message IDs so we can detect deletions
  let knownIds = new Set();

  // ── Initial load ──────────────────────────────────────────────
  async function init() {
    try {
      const data = await DiscordDataService.searchMessages({
        guildId, channelId, limit, includeBots,
      });
      if (closed) return;

      const messages = data.messages || [];
      knownIds = new Set(messages.map((m) => m.id));

      res.write(`event: init\ndata: ${JSON.stringify({ messages })}\n\n`);
      health.markSuccess();
    } catch (err) {
      logger.error("[discord/stream] Init error:", err.message);
      health.markError(err);
      if (!closed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    }
  }

  // ── Poll for changes (new messages + deletions) ──────────────
  async function poll() {
    if (closed) return;
    try {
      const data = await DiscordDataService.searchMessages({
        guildId, channelId, limit, includeBots,
      });

      const messages = data.messages || [];
      const currentIds = new Set(messages.map((m) => m.id));

      // ── Detect new messages ─────────────────────────────────
      const newMessages = messages.filter((m) => !knownIds.has(m.id));
      if (newMessages.length > 0) {
        // Send newest-first (same order as searchMessages returns)
        res.write(`event: new\ndata: ${JSON.stringify({ messages: newMessages })}\n\n`);
        health.markSuccess();
      }

      // ── Detect deleted messages ─────────────────────────────
      const deletedIds = [];
      for (const id of knownIds) {
        if (!currentIds.has(id)) {
          deletedIds.push(id);
        }
      }
      if (deletedIds.length > 0) {
        res.write(`event: delete\ndata: ${JSON.stringify({ ids: deletedIds })}\n\n`);
      }

      // Update tracked set
      knownIds = currentIds;
    } catch (err) {
      logger.error("[discord/stream] Poll error:", err.message);
      health.markError(err);
    }
  }

  // ── Heartbeat — keeps the connection alive through proxies ────
  const heartbeatInterval = setInterval(() => {
    if (closed) return;
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 15_000);

  // ── Start polling at 1s interval ──────────────────────────────
  init().then(() => {
    if (!closed) {
      pollInterval = setInterval(poll, 1_000);
    }
  });
  let pollInterval = null;

  // ── Cleanup on disconnect ─────────────────────────────────────
  req.on("close", () => {
    closed = true;
    if (pollInterval) clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
  });
});

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
      includeBots: req.query.includeBots === "true",
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
