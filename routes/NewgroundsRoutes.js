import { Router } from "express";
import {
  getNewgroundsScrapeStats,
  getProfile,
  getAllProfiles,
  searchProfiles,
  getContentByUser,
} from "../models/NewgroundsProfile.js";
import { getClockCrewDB } from "../models/ClockCrewPost.js";

const router = Router();

// ─── Health ─────────────────────────────────────────────────────

const state = { lastChecked: null, error: null };

export function getNewgroundsHealth() {
  return { lastChecked: state.lastChecked, error: state.error };
}

// ─── GET /stats ─────────────────────────────────────────────────
// Returns scrape progress stats.

router.get("/stats", async (_req, res) => {
  try {
    const stats = await getNewgroundsScrapeStats();
    state.lastChecked = new Date();
    res.json(stats);
  } catch (error) {
    state.error = error.message;
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /profiles ──────────────────────────────────────────────
// List all scraped profiles.
// Query: ?q=clock&limit=50

router.get("/profiles", async (req, res) => {
  try {
    const q = req.query.q;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);

    let profiles;
    if (q) {
      profiles = await searchProfiles({ q, limit });
    } else {
      profiles = await getAllProfiles(limit);
    }

    res.json({ count: profiles.length, profiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /profiles/:username ────────────────────────────────────
// Get a specific profile by username.

router.get("/profiles/:username", async (req, res) => {
  try {
    const profile = await getProfile(req.params.username);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Content Endpoints ──────────────────────────────────────────
// Each content type gets a by-user endpoint.

const CONTENT_COLLECTIONS = [
  { path: "fans", collection: "NewgroundsFans" },
  { path: "news", collection: "NewgroundsNews" },
  { path: "movies", collection: "NewgroundsMovies" },
  { path: "games", collection: "NewgroundsGames" },
  { path: "audio", collection: "NewgroundsAudio" },
  { path: "art", collection: "NewgroundsArt" },
  { path: "faves", collection: "NewgroundsFaves" },
  { path: "reviews", collection: "NewgroundsReviews" },
  { path: "posts", collection: "NewgroundsPosts" },
];

for (const { path, collection } of CONTENT_COLLECTIONS) {
  // GET /fans/:username, /news/:username, etc.
  router.get(`/${path}/:username`, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
      const items = await getContentByUser(
        collection,
        req.params.username.toLowerCase(),
        limit,
      );
      res.json({ count: items.length, [path]: items });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

// ─── GET /top ───────────────────────────────────────────────────
// Top users by a given metric.
// Query: ?sort=fans.count|movies.count|level&limit=50

router.get("/top", async (req, res) => {
  try {
    const sortField = req.query.sort || "fans.count";
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);

    const db = getClockCrewDB();
    const profiles = await db
      .collection("NewgroundsProfiles")
      .find({})
      .sort({ [sortField]: -1 })
      .limit(limit)
      .toArray();

    res.json({
      count: profiles.length,
      sortedBy: sortField,
      profiles,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
