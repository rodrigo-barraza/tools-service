// ============================================================
// Gaming Routes — Video Game Data Endpoints
// ============================================================
// Currently: Dota 2 via OpenDota API (free, no key).
// Mounted at: /gaming
// ============================================================

import { Router } from "express";
import {
  getHeroes,
  getHero,
  getHeroMatchups,
  getPlayer,
  getPlayerRecentMatches,
  getMatch,
  getProMatches,
} from "../fetchers/gaming/DotaFetcher.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════
// 1. Dota 2 — Hero Data
// ═══════════════════════════════════════════════════════════════

router.get("/dota/heroes", async (req, res) => {
  try {
    const heroes = await getHeroes();
    const { role, attr, q } = req.query;

    let filtered = heroes;

    if (q) {
      const query = q.toLowerCase();
      filtered = filtered.filter((h) => h.name.toLowerCase().includes(query));
    }

    if (role) {
      const roleLower = role.toLowerCase();
      filtered = filtered.filter((h) =>
        h.roles.some((r) => r.toLowerCase() === roleLower),
      );
    }

    if (attr) {
      const attrMap = { str: "str", agi: "agi", int: "int", all: "all", universal: "all" };
      const attrKey = attrMap[attr.toLowerCase()] || attr.toLowerCase();
      filtered = filtered.filter((h) => h.primaryAttr === attrKey);
    }

    res.json({ count: filtered.length, heroes: filtered });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch heroes: ${err.message}` });
  }
});

router.get("/dota/heroes/:query", async (req, res) => {
  try {
    const result = await getHero(req.params.query);
    if (!result) {
      return res.status(404).json({ error: `Hero not found: ${req.params.query}` });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch hero: ${err.message}` });
  }
});

router.get("/dota/heroes/:heroId/matchups", async (req, res) => {
  try {
    const heroId = parseInt(req.params.heroId);
    if (isNaN(heroId)) {
      return res.status(400).json({ error: "heroId must be a number" });
    }

    // Enrich matchup hero IDs with names
    const [matchups, heroes] = await Promise.all([
      getHeroMatchups(heroId),
      getHeroes(),
    ]);

    const heroMap = new Map(heroes.map((h) => [h.id, h.name]));
    const enrichMatchup = (m) => ({ ...m, heroName: heroMap.get(m.heroId) || "Unknown" });

    res.json({
      ...matchups,
      bestAgainst: matchups.bestAgainst.map(enrichMatchup),
      worstAgainst: matchups.worstAgainst.map(enrichMatchup),
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch matchups: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. Dota 2 — Player Data
// ═══════════════════════════════════════════════════════════════

router.get("/dota/players/:accountId", async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId);
    if (isNaN(accountId)) {
      return res.status(400).json({ error: "accountId must be a number (Steam32 ID)" });
    }
    const player = await getPlayer(accountId);
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch player: ${err.message}` });
  }
});

router.get("/dota/players/:accountId/matches", async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    if (isNaN(accountId)) {
      return res.status(400).json({ error: "accountId must be a number (Steam32 ID)" });
    }

    const [matches, heroes] = await Promise.all([
      getPlayerRecentMatches(accountId, limit),
      getHeroes(),
    ]);

    const heroMap = new Map(heroes.map((h) => [h.id, h.name]));
    const enriched = matches.map((m) => ({
      ...m,
      heroName: heroMap.get(m.heroId) || "Unknown",
    }));

    res.json({ count: enriched.length, matches: enriched });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch matches: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 3. Dota 2 — Match Data
// ═══════════════════════════════════════════════════════════════

router.get("/dota/matches/:matchId", async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) {
      return res.status(400).json({ error: "matchId must be a number" });
    }

    const [match, heroes] = await Promise.all([
      getMatch(matchId),
      getHeroes(),
    ]);

    const heroMap = new Map(heroes.map((h) => [h.id, h.name]));
    match.players = match.players.map((p) => ({
      ...p,
      heroName: heroMap.get(p.heroId) || "Unknown",
    }));

    res.json(match);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch match: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. Dota 2 — Pro Scene
// ═══════════════════════════════════════════════════════════════

router.get("/dota/pro-matches", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const matches = await getProMatches(limit);
    res.json({ count: matches.length, matches });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch pro matches: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// Unified Dota Dispatcher (for AI tool schema)
// ═══════════════════════════════════════════════════════════════

router.get("/dota", async (req, res) => {
  const { action, query, heroId, accountId, matchId, limit, role, attr } = req.query;
  if (!action) {
    return res.status(400).json({
      error: "'action' is required",
      actions: ["heroes", "hero", "matchups", "player", "player_matches", "match", "pro_matches"],
    });
  }

  // Build query string for sub-routes
  const qs = (params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  switch (action) {
    case "heroes":
      req.url = `/dota/heroes${qs({ q: query, role, attr })}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "hero":
      if (!query) return res.status(400).json({ error: "'query' is required for action=hero (hero name or ID)" });
      req.url = `/dota/heroes/${encodeURIComponent(query)}`;
      req.params.query = query;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "matchups":
      if (!heroId) return res.status(400).json({ error: "'heroId' is required for action=matchups" });
      req.url = `/dota/heroes/${heroId}/matchups`;
      req.params.heroId = String(heroId);
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "player":
      if (!accountId) return res.status(400).json({ error: "'accountId' is required for action=player" });
      req.url = `/dota/players/${accountId}`;
      req.params.accountId = String(accountId);
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "player_matches":
      if (!accountId) return res.status(400).json({ error: "'accountId' is required for action=player_matches" });
      req.url = `/dota/players/${accountId}/matches${qs({ limit })}`;
      req.params.accountId = String(accountId);
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "match":
      if (!matchId) return res.status(400).json({ error: "'matchId' is required for action=match" });
      req.url = `/dota/matches/${matchId}`;
      req.params.matchId = String(matchId);
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "pro_matches":
      req.url = `/dota/pro-matches${qs({ limit })}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    default:
      return res.status(400).json({
        error: `Unknown action: ${action}`,
        actions: ["heroes", "hero", "matchups", "player", "player_matches", "match", "pro_matches"],
      });
  }
});

// ═══════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════

export function getGamingHealth() {
  return {
    dota: "on-demand (OpenDota API)",
  };
}

export default router;
