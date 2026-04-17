import { Router } from "express";
import DiscordDataService from "../services/DiscordDataService.js";

const router = Router();

// ─── Health ─────────────────────────────────────────────────────

const state = { lastChecked: null, error: null };

export function getDiscordHealth() {
  return { lastChecked: state.lastChecked, error: state.error };
}

// ─── GET /messages/search ───────────────────────────────────────
// Search Discord messages with flexible filters.
// Query: ?guildId=...&channelId=...&userId=...&query=...&before=...&after=...&limit=50

router.get("/messages/search", async (req, res) => {
  try {
    const result = await DiscordDataService.searchMessages({
      guildId: req.query.guildId,
      channelId: req.query.channelId,
      userId: req.query.userId,
      query: req.query.query,
      before: req.query.before,
      after: req.query.after,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[DiscordRoutes] /messages/search error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /activity ──────────────────────────────────────────────
// Get server activity stats: top users, channel breakdown, hourly distribution.
// Query: ?guildId=...&channelId=...&days=7&topN=15

router.get("/activity", async (req, res) => {
  try {
    const result = await DiscordDataService.getServerActivity({
      guildId: req.query.guildId,
      channelId: req.query.channelId,
      days: req.query.days ? parseInt(req.query.days, 10) : 7,
      topN: req.query.topN ? parseInt(req.query.topN, 10) : 15,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[DiscordRoutes] /activity error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
