import { MongoClient } from "mongodb";

// ═══════════════════════════════════════════════════════════════
//  Newgrounds — MongoDB Collections (separate database)
// ═══════════════════════════════════════════════════════════════
//  Database: newgrounds
//  Collections:
//    ng_profiles  — User profile data & stats
//    ng_fans      — Fan relationship snapshots
//    ng_news      — User news/blog posts
//    ng_movies    — User's submitted movies
//    ng_games     — User's submitted games
//    ng_audio     — User's submitted audio
//    ng_art       — User's submitted art
//    ng_faves     — User's favorited content
//    ng_reviews   — User's reviews
//    ng_posts     — User's forum posts
// ═══════════════════════════════════════════════════════════════

let client = null;
let ngDb = null;

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
 * Connect to the Newgrounds database.
 * Uses the same MongoDB host but targets the `newgrounds` database.
 *
 * @param {string} baseUri - MongoDB connection string (will switch to `newgrounds` db)
 */
export async function connectNewgroundsDB(baseUri) {
  if (ngDb) return ngDb;

  // Replace the database name in the URI
  const ngUri = baseUri.replace(
    /\/tools\b/,
    "/newgrounds",
  );

  client = new MongoClient(ngUri);
  await client.connect();
  ngDb = client.db("newgrounds");
  console.log(`🎮 Connected to Newgrounds DB: ${ngDb.databaseName}`);
  return ngDb;
}

/**
 * Get the Newgrounds database instance.
 */
export function getNewgroundsDB() {
  if (!ngDb) throw new Error("Newgrounds DB not connected — call connectNewgroundsDB() first");
  return ngDb;
}

/**
 * Initialize all Newgrounds collections with required indexes.
 */
export async function setupNewgroundsCollections() {
  const db = getNewgroundsDB();

  profilesCol = db.collection("ng_profiles");
  fansCol = db.collection("ng_fans");
  newsCol = db.collection("ng_news");
  moviesCol = db.collection("ng_movies");
  gamesCol = db.collection("ng_games");
  audioCol = db.collection("ng_audio");
  artCol = db.collection("ng_art");
  favesCol = db.collection("ng_faves");
  reviewsCol = db.collection("ng_reviews");
  postsCol = db.collection("ng_posts");

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
 * @param {string} collectionName - One of: ng_fans, ng_news, ng_movies, ng_games, ng_audio, ng_art, ng_faves, ng_reviews, ng_posts
 * @param {object[]} items - Array of documents to upsert
 * @param {string} dedupeField - Field to use for deduplication
 */
export async function upsertContentBatch(collectionName, items, dedupeField = "contentUrl") {
  const db = getNewgroundsDB();
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
  const db = getNewgroundsDB();
  const col = db.collection(collectionName);
  return col
    .find({ usernameLower })
    .sort({ publishedDate: -1, date: -1, _id: -1 })
    .limit(limit)
    .toArray();
}

// ─── Stats ──────────────────────────────────────────────────────

/**
 * Get scrape progress stats for the Newgrounds database.
 */
export async function getNewgroundsScrapeStats() {
  const db = getNewgroundsDB();

  const [profiles, fans, news, movies, games, audio, art, faves, reviews, posts] =
    await Promise.all([
      db.collection("ng_profiles").countDocuments(),
      db.collection("ng_fans").countDocuments(),
      db.collection("ng_news").countDocuments(),
      db.collection("ng_movies").countDocuments(),
      db.collection("ng_games").countDocuments(),
      db.collection("ng_audio").countDocuments(),
      db.collection("ng_art").countDocuments(),
      db.collection("ng_faves").countDocuments(),
      db.collection("ng_reviews").countDocuments(),
      db.collection("ng_posts").countDocuments(),
    ]);

  const latestProfile = await db
    .collection("ng_profiles")
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
