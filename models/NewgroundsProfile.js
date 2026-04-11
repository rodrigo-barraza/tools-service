import { getClockCrewDB } from "./ClockCrewPost.js";

// ═══════════════════════════════════════════════════════════════
//  Newgrounds — MongoDB Collections (in clockcrew database)
// ═══════════════════════════════════════════════════════════════
//  Database: clockcrew
//  Collections:
//    NewgroundsProfiles  — User profile data & stats
//    NewgroundsFans      — Fan relationship snapshots
//    NewgroundsNews      — User news/blog posts
//    NewgroundsMovies    — User's submitted movies
//    NewgroundsGames     — User's submitted games
//    NewgroundsAudio     — User's submitted audio
//    NewgroundsArt       — User's submitted art
//    NewgroundsFaves     — User's favorited content
//    NewgroundsReviews   — User's reviews
//    NewgroundsPosts     — User's forum posts
// ═══════════════════════════════════════════════════════════════

let profilesCol = null;
let fansCol = null;
let newsCol = null;
let moviesCol = null;
let gamesCol = null;
let audioCol = null;
let artCol = null;
let favesCol = null;
let reviewsCol = null;
let postsCol = null;

/**
 * Initialize all Newgrounds collections with required indexes.
 * Requires connectClockCrewDB() to have been called first.
 */
export async function setupNewgroundsCollections() {
  const db = getClockCrewDB();

  profilesCol = db.collection("NewgroundsProfiles");
  fansCol = db.collection("NewgroundsFans");
  newsCol = db.collection("NewgroundsNews");
  moviesCol = db.collection("NewgroundsMovies");
  gamesCol = db.collection("NewgroundsGames");
  audioCol = db.collection("NewgroundsAudio");
  artCol = db.collection("NewgroundsArt");
  favesCol = db.collection("NewgroundsFaves");
  reviewsCol = db.collection("NewgroundsReviews");
  postsCol = db.collection("NewgroundsPosts");

  // ─── Profile Indexes ──────────────────────────────────────────
  await profilesCol.createIndex({ usernameLower: 1 }, { unique: true });
  await profilesCol.createIndex({ username: 1 });
  await profilesCol.createIndex({ joinDate: -1 });
  await profilesCol.createIndex({ "fans.count": -1 });
  await profilesCol.createIndex(
    { description: "text", username: "text", job: "text", location: "text" },
    { name: "ng_profile_text_search" },
  );

  // ─── Fans Indexes ─────────────────────────────────────────────
  await fansCol.createIndex({ usernameLower: 1 });
  await fansCol.createIndex({ fanUsername: 1 });
  await fansCol.createIndex(
    { usernameLower: 1, fanUsername: 1 },
    { unique: true },
  );

  // ─── Content Collection Indexes (shared pattern) ──────────────
  for (const col of [newsCol, moviesCol, gamesCol, audioCol, artCol]) {
    await col.createIndex({ usernameLower: 1 });
    await col.createIndex({ contentId: 1 }, { unique: true, sparse: true });
    await col.createIndex({ publishedDate: -1 });
  }

  // ─── Faves Indexes ────────────────────────────────────────────
  await favesCol.createIndex({ usernameLower: 1 });
  await favesCol.createIndex({ contentUrl: 1 });
  await favesCol.createIndex(
    { usernameLower: 1, contentUrl: 1 },
    { unique: true },
  );

  // ─── Reviews Indexes ──────────────────────────────────────────
  await reviewsCol.createIndex({ usernameLower: 1 });
  await reviewsCol.createIndex({ reviewId: 1 }, { unique: true, sparse: true });
  await reviewsCol.createIndex({ score: -1 });

  // ─── Posts Indexes ────────────────────────────────────────────
  await postsCol.createIndex({ usernameLower: 1 });
  await postsCol.createIndex({ postId: 1 }, { unique: true, sparse: true });
  await postsCol.createIndex({ date: -1 });

  console.log("🎮 Newgrounds collections & indexes ready");
}

// ─── Profile Operations ─────────────────────────────────────────

/**
 * Upsert a user profile by usernameLower.
 */
export async function upsertProfile(profile) {
  if (!profilesCol) return false;
  const result = await profilesCol.updateOne(
    { usernameLower: profile.usernameLower },
    {
      $set: { ...profile, lastScrapedAt: new Date() },
      $setOnInsert: { firstScrapedAt: new Date() },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/**
 * Check if a profile has been scraped.
 */
export async function profileExists(usernameLower) {
  if (!profilesCol) return false;
  const doc = await profilesCol.findOne(
    { usernameLower },
    { projection: { _id: 1 } },
  );
  return !!doc;
}

/**
 * Get a profile by username (case-insensitive).
 */
export async function getProfile(username) {
  if (!profilesCol) return null;
  return profilesCol.findOne({
    usernameLower: username.toLowerCase(),
  });
}

/**
 * Get all profiles, sorted by fan count descending.
 */
export async function getAllProfiles(limit = 500) {
  if (!profilesCol) return [];
  return profilesCol
    .find({})
    .sort({ "fans.count": -1 })
    .limit(limit)
    .toArray();
}

/**
 * Search profiles by text query.
 */
export async function searchProfiles({ q, limit = 100 } = {}) {
  if (!profilesCol) return [];

  if (q) {
    return profilesCol
      .find(
        { $text: { $search: q } },
        { score: { $meta: "textScore" } },
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .toArray();
  }

  return profilesCol
    .find({})
    .sort({ "fans.count": -1 })
    .limit(limit)
    .toArray();
}

// ─── Generic Content Operations ─────────────────────────────────

/**
 * Bulk upsert items into a content collection.
 * Each item must have a `contentId` or `contentUrl` for dedup.
 *
 * @param {string} collectionName - One of: NewgroundsFans, NewgroundsNews, NewgroundsMovies, NewgroundsGames, NewgroundsAudio, NewgroundsArt, NewgroundsFaves, NewgroundsReviews, NewgroundsPosts
 * @param {object[]} items - Array of documents to upsert
 * @param {string} dedupeField - Field to use for deduplication
 */
export async function upsertContentBatch(collectionName, items, dedupeField = "contentUrl") {
  const db = getClockCrewDB();
  const col = db.collection(collectionName);

  if (!items || items.length === 0) return { upserted: 0, modified: 0 };

  const operations = items.map((item) => ({
    updateOne: {
      filter: { [dedupeField]: item[dedupeField] },
      update: {
        $set: { ...item, lastScrapedAt: new Date() },
        $setOnInsert: { firstScrapedAt: new Date() },
      },
      upsert: true,
    },
  }));

  try {
    const result = await col.bulkWrite(operations, { ordered: false });
    return {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    };
  } catch (error) {
    console.error(`[Newgrounds] Failed to upsert ${collectionName}:`, error.message);
    return { upserted: 0, modified: 0 };
  }
}

/**
 * Get all items from a content collection for a given user.
 */
export async function getContentByUser(collectionName, usernameLower, limit = 500) {
  const db = getClockCrewDB();
  const col = db.collection(collectionName);
  return col
    .find({ usernameLower })
    .sort({ publishedDate: -1, date: -1, _id: -1 })
    .limit(limit)
    .toArray();
}

// ─── Stats ──────────────────────────────────────────────────────

/**
 * Get scrape progress stats for the Newgrounds collections.
 */
export async function getNewgroundsScrapeStats() {
  const db = getClockCrewDB();

  const [profiles, fans, news, movies, games, audio, art, faves, reviews, posts] =
    await Promise.all([
      db.collection("NewgroundsProfiles").countDocuments(),
      db.collection("NewgroundsFans").countDocuments(),
      db.collection("NewgroundsNews").countDocuments(),
      db.collection("NewgroundsMovies").countDocuments(),
      db.collection("NewgroundsGames").countDocuments(),
      db.collection("NewgroundsAudio").countDocuments(),
      db.collection("NewgroundsArt").countDocuments(),
      db.collection("NewgroundsFaves").countDocuments(),
      db.collection("NewgroundsReviews").countDocuments(),
      db.collection("NewgroundsPosts").countDocuments(),
    ]);

  const latestProfile = await db
    .collection("NewgroundsProfiles")
    .findOne({}, { sort: { lastScrapedAt: -1 }, projection: { lastScrapedAt: 1 } });

  return {
    profiles,
    fans,
    news,
    movies,
    games,
    audio,
    art,
    faves,
    reviews,
    posts,
    lastScrapedAt: latestProfile?.lastScrapedAt || null,
  };
}
