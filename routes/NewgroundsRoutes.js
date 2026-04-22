import { Router } from "express";
import {
  getNewgroundsScrapeStats,
  getProfile,
  getAllProfiles,
  searchProfiles,
  getContentByUser,
} from "../models/NewgroundsProfile.js";
import { getClockCrewDB } from "../models/ClockCrewPost.js";
import { asyncHandler, parseIntParam, HealthTracker } from "../utilities.js";

const router = Router();

// ─── Health ─────────────────────────────────────────────────────

const health = new HealthTracker();

export function getNewgroundsHealth() {
  return health.getHealth();
}

const opts = { errorStatus: 500, health };

// ─── GET /stats ─────────────────────────────────────────────────
// Returns scrape progress stats.

router.get(
  "/stats",
  asyncHandler(() => getNewgroundsScrapeStats(), "Newgrounds stats", opts),
);

// ─── GET /profiles ──────────────────────────────────────────────
// List all scraped profiles.
// Query: ?q=clock&limit=50

router.get(
  "/profiles",
  asyncHandler(async (req) => {
    const q = req.query.q;
    const limit = parseIntParam(req.query.limit, 50, 500);

    const profiles = q
      ? await searchProfiles({ q, limit })
      : await getAllProfiles(limit);

    return { count: profiles.length, profiles };
  }, "Profile listing", 500),
);

// ─── GET /profiles/:username ────────────────────────────────────
// Get a specific profile by username.

router.get("/profiles/:username", async (req, res) => {
  const profile = await getProfile(req.params.username);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  res.json(profile);
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
  router.get(
    `/${path}/:username`,
    asyncHandler(async (req) => {
      const limit = parseIntParam(req.query.limit, 200, 2000);
      const items = await getContentByUser(
        collection,
        req.params.username.toLowerCase(),
        limit,
      );
      return { count: items.length, [path]: items };
    }, `Newgrounds ${path}`, 500),
  );
}

// ─── GET /top ───────────────────────────────────────────────────
// Top users by a given metric.
// Query: ?sort=fans.count|movies.count|level&limit=50

router.get(
  "/top",
  asyncHandler(async (req) => {
    const sortField = req.query.sort || "fans.count";
    const limit = parseIntParam(req.query.limit, 50, 500);

    const db = getClockCrewDB();
    const profiles = await db
      .collection("NewgroundsProfiles")
      .find({})
      .sort({ [sortField]: -1 })
      .limit(limit)
      .toArray();

    return {
      count: profiles.length,
      sortedBy: sortField,
      profiles,
    };
  }, "Top users", 500),
);

export default router;
