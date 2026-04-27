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

// ─── GET /portal ────────────────────────────────────────────────
// Browse all movies + games with search, type filter, and sorting.
// Query: ?q=clock&type=movie|game|all&sort=score|title|newest&limit=50&skip=0&username=strawberry

router.get(
  "/portal",
  asyncHandler(async (req) => {
    const db = getClockCrewDB();
    const q = req.query.q?.trim();
    const username = req.query.username?.trim();
    const type = req.query.type || "all";
    const sort = req.query.sort || "score";
    const limit = parseIntParam(req.query.limit, 50, 200);
    const skip = parseIntParam(req.query.skip, 0);

    // Build filter
    const filter = {};
    if (q) {
      filter.title = { $regex: q, $options: "i" };
    }
    if (username) {
      filter.usernameLower = username.toLowerCase();
    }

    // Sort mapping
    const sortMap = {
      score: { score: -1 },
      title: { title: 1 },
      newest: { publishedDate: -1, firstScrapedAt: -1 },
    };
    const sortSpec = sortMap[sort] || sortMap.score;

    // Which collections to query
    const collections = [];
    if (type === "all" || type === "movie") collections.push("NewgroundsMovies");
    if (type === "all" || type === "game") collections.push("NewgroundsGames");

    // Query each collection and merge
    const results = await Promise.all(
      collections.map(async (colName) => {
        const col = db.collection(colName);
        const items = await col
          .find(filter)
          .sort(sortSpec)
          .skip(skip)
          .limit(limit)
          .toArray();
        return items;
      }),
    );

    // Merge and re-sort
    let items = results.flat();
    if (sort === "score") {
      items.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sort === "title") {
      items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else {
      items.sort((a, b) => {
        const da = b.publishedDate || b.firstScrapedAt || "";
        const db2 = a.publishedDate || a.firstScrapedAt || "";
        return new Date(da) - new Date(db2);
      });
    }

    // Trim to limit after merge
    items = items.slice(0, limit);

    // Get total counts for UI display
    const [movieCount, gameCount] = await Promise.all([
      db.collection("NewgroundsMovies").countDocuments(filter),
      db.collection("NewgroundsGames").countDocuments(filter),
    ]);

    return {
      count: items.length,
      totalMovies: movieCount,
      totalGames: gameCount,
      items,
    };
  }, "Portal browse", 500),
);

// ─── GET /portal/:username/card ─────────────────────────────────
// Enriched profile card: NG profile + CC forum user + content counts.

router.get(
  "/portal/:username/card",
  asyncHandler(async (req) => {
    const db = getClockCrewDB();
    const usernameLower = req.params.username.toLowerCase();

    // ── Fetch NG profile ────────────────────────────────────────
    const profile = await db
      .collection("NewgroundsProfiles")
      .findOne({ usernameLower });

    if (!profile) {
      return { error: "Profile not found", profile: null, ccUser: null };
    }

    // ── Fetch UserProfileLink → ClockCrewNetUser ────────────────
    let ccUser = null;
    const link = await db
      .collection("UserProfileLink")
      .findOne({ ngUsernameLower: usernameLower });

    if (link?.ccUserId) {
      ccUser = await db
        .collection("ClockCrewNetUsers")
        .findOne({ userId: link.ccUserId });
    }

    // ── Fetch content counts directly (more accurate than profile) ─
    const [movieCount, gameCount, audioCount] = await Promise.all([
      db.collection("NewgroundsMovies").countDocuments({ usernameLower }),
      db.collection("NewgroundsGames").countDocuments({ usernameLower }),
      db.collection("NewgroundsAudio").countDocuments({ usernameLower }),
    ]);

    // ── Fetch top-scored submissions ────────────────────────────
    const [topMovies, topGames] = await Promise.all([
      db.collection("NewgroundsMovies")
        .find({ usernameLower })
        .sort({ score: -1 })
        .limit(5)
        .toArray(),
      db.collection("NewgroundsGames")
        .find({ usernameLower })
        .sort({ score: -1 })
        .limit(5)
        .toArray(),
    ]);

    return {
      profile: {
        username: profile.username,
        usernameLower: profile.usernameLower,
        avatarUrl: profile.avatarUrl,
        bannerUrl: profile.bannerUrl,
        profileUrl: profile.profileUrl,
        description: profile.description,
        level: profile.level,
        rank: profile.rank,
        globalRank: profile.globalRank,
        expPoints: profile.expPoints,
        expRank: profile.expRank,
        blams: profile.blams,
        saves: profile.saves,
        votePower: profile.votePower,
        fans: profile.fans?.count ?? 0,
        medals: profile.medals,
        trophies: profile.trophies,
        sex: profile.sex,
        age: profile.age,
        location: profile.location,
        job: profile.job,
        joinDate: profile.joinDate,
        realName: profile.realName,
        school: profile.school,
        supporter: profile.supporter,
        links: profile.links,
        // Content counts from profile metadata
        movieCount: profile.movies?.count ?? movieCount,
        gameCount: profile.games?.count ?? gameCount,
        audioCount: profile.audio?.count ?? audioCount,
        reviewCount: profile.reviews?.count ?? 0,
        postCount: profile.posts?.count ?? 0,
        faveCount: profile.faves?.count ?? 0,
        newsCount: profile.news?.count ?? 0,
      },
      ccUser: ccUser
        ? {
            userId: ccUser.userId,
            username: ccUser.username,
            avatarUrl: ccUser.avatarUrl,
            customTitle: ccUser.customTitle,
            position: ccUser.position,
            postCount: ccUser.postCount,
            personalText: ccUser.personalText,
            dateRegistered: ccUser.dateRegistered,
            age: ccUser.age,
            gender: ccUser.gender,
            location: ccUser.location,
            onlineStatus: ccUser.onlineStatus,
            profileUrl: ccUser.profileUrl,
            signature: ccUser.signature,
          }
        : null,
      topMovies,
      topGames,
      scrapedMovies: movieCount,
      scrapedGames: gameCount,
      scrapedAudio: audioCount,
    };
  }, "Portal card", 500),
);

export default router;
