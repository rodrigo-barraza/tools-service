import { MongoClient } from "mongodb";

// ═══════════════════════════════════════════════════════════════
//  Clock Crew Forum — MongoDB Collections (separate database)
// ═══════════════════════════════════════════════════════════════
//  Database: clockcrew
//  Collections:
//    ClockCrewNetBoards  — One doc per board (board metadata)
//    ClockCrewNetThreads — One doc per topic (thread metadata)
//    ClockCrewNetPosts   — One doc per message (post content)
//    ClockCrewNetUsers   — One doc per forum user (profile data)
// ═══════════════════════════════════════════════════════════════

let client = null;
let ccDb = null;

let boardsCol = null;
let threadsCol = null;
let postsCol = null;
let usersCol = null;

/**
 * Connect to the Clock Crew database.
 * Uses the same MongoDB host but targets the `clockcrew` database.
 *
 * @param {string} baseUri - MongoDB connection string (will switch to `clockcrew` db)
 */
export async function connectClockCrewDB(baseUri) {
  if (ccDb) return ccDb;

  // Replace the database name in the URI
  const ccUri = baseUri.replace(
    /\/tools\b/,
    "/clockcrew",
  );

  client = new MongoClient(ccUri);
  await client.connect();
  ccDb = client.db("clockcrew");
  console.log(`🕰️  Connected to Clock Crew DB: ${ccDb.databaseName}`);
  return ccDb;
}

/**
 * Get the Clock Crew database instance.
 */
export function getClockCrewDB() {
  if (!ccDb) throw new Error("Clock Crew DB not connected — call connectClockCrewDB() first");
  return ccDb;
}

/**
 * Initialize both collections with required indexes.
 */
export async function setupClockCrewCollections() {
  const db = getClockCrewDB();
  boardsCol = db.collection("ClockCrewNetBoards");
  threadsCol = db.collection("ClockCrewNetThreads");
  postsCol = db.collection("ClockCrewNetPosts");
  usersCol = db.collection("ClockCrewNetUsers");

  // ─── Board Indexes ─────────────────────────────────────────────
  await boardsCol.createIndex({ boardId: 1 }, { unique: true });

  // ─── Thread Indexes ────────────────────────────────────────────
  await threadsCol.createIndex({ topicId: 1 }, { unique: true });
  await threadsCol.createIndex({ boardId: 1 });
  await threadsCol.createIndex({ author: 1 });
  await threadsCol.createIndex({ date: -1 });

  // ─── Post Indexes ──────────────────────────────────────────────
  await postsCol.createIndex({ messageId: 1 }, { unique: true });
  await postsCol.createIndex({ topicId: 1 });
  await postsCol.createIndex({ boardId: 1 });
  await postsCol.createIndex({ author: 1 });
  await postsCol.createIndex({ date: -1 });
  await postsCol.createIndex(
    { body: "text", author: "text" },
    { name: "clockcrew_post_text_search" },
  );

  // ─── User Indexes ──────────────────────────────────────────────
  await usersCol.createIndex({ userId: 1 }, { unique: true });
  await usersCol.createIndex({ username: 1 });
  await usersCol.createIndex({ dateRegistered: -1 });

  // ─── UserProfileLink Indexes ───────────────────────────────────
  const linksCol = db.collection("UserProfileLink");
  await linksCol.createIndex(
    { ccUserId: 1, ngUsernameLower: 1 },
    { unique: true },
  );
  await linksCol.createIndex({ ccUserId: 1 });
  await linksCol.createIndex({ ngUsernameLower: 1 });
  await linksCol.createIndex({ matchTier: 1 });

  console.log("🕰️  Clock Crew collections & indexes ready");
}

// ─── UserProfileLink Operations ─────────────────────────────────

/**
 * Upsert a profile link between a ClockCrew user and a Newgrounds profile.
 */
export async function upsertProfileLink(link) {
  const db = getClockCrewDB();
  const col = db.collection("UserProfileLink");
  const result = await col.updateOne(
    { ccUserId: link.ccUserId, ngUsernameLower: link.ngUsernameLower },
    {
      $set: { ...link, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/**
 * Bulk upsert profile links.
 * Returns { upserted, modified }.
 */
export async function upsertProfileLinks(links) {
  if (!links || links.length === 0) return { upserted: 0, modified: 0 };
  const db = getClockCrewDB();
  const col = db.collection("UserProfileLink");

  const operations = links.map((link) => ({
    updateOne: {
      filter: { ccUserId: link.ccUserId, ngUsernameLower: link.ngUsernameLower },
      update: {
        $set: { ...link, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      upsert: true,
    },
  }));

  try {
    const result = await col.bulkWrite(operations, { ordered: false });
    return { upserted: result.upsertedCount, modified: result.modifiedCount };
  } catch (error) {
    console.error("[ClockCrew] Failed to upsert profile links:", error.message);
    return { upserted: 0, modified: 0 };
  }
}

/**
 * Get all Newgrounds links for a ClockCrew user.
 */
export async function getLinksByClockCrewUser(ccUserId) {
  const db = getClockCrewDB();
  return db.collection("UserProfileLink").find({ ccUserId }).toArray();
}

/**
 * Get all ClockCrew links for a Newgrounds user.
 */
export async function getLinksByNewgroundsUser(ngUsernameLower) {
  const db = getClockCrewDB();
  return db.collection("UserProfileLink").find({ ngUsernameLower }).toArray();
}

/**
 * Get all profile links.
 */
export async function getAllProfileLinks() {
  const db = getClockCrewDB();
  return db.collection("UserProfileLink").find({}).sort({ ccUsername: 1 }).toArray();
}

// ─── Board Operations ───────────────────────────────────────────

/**
 * Upsert a board document by boardId.
 */
export async function upsertBoard(board) {
  if (!boardsCol) return false;
  const result = await boardsCol.updateOne(
    { boardId: board.boardId },
    {
      $set: { ...board, lastScrapedAt: new Date() },
      $setOnInsert: { firstScrapedAt: new Date() },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/**
 * Get all boards.
 */
export async function getAllBoards() {
  if (!boardsCol) return [];
  return boardsCol.find({}).sort({ boardId: 1 }).toArray();
}

// ─── User Operations ────────────────────────────────────────────

/**
 * Upsert a user profile by userId.
 */
export async function upsertUser(user) {
  if (!usersCol) return false;
  const result = await usersCol.updateOne(
    { userId: user.userId },
    {
      $set: { ...user, lastScrapedAt: new Date() },
      $setOnInsert: { firstScrapedAt: new Date() },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/**
 * Check if a user profile has been scraped.
 */
export async function userExists(userId) {
  if (!usersCol) return false;
  const doc = await usersCol.findOne(
    { userId },
    { projection: { _id: 1 } },
  );
  return !!doc;
}

/**
 * Get a user by userId.
 */
export async function getUser(userId) {
  if (!usersCol) return null;
  return usersCol.findOne({ userId });
}

/**
 * Get a user by username (case-insensitive).
 */
export async function getUserByName(username) {
  if (!usersCol) return null;
  return usersCol.findOne({ username: new RegExp(`^${username}$`, "i") });
}

/**
 * Get all scraped users sorted by post count descending.
 */
export async function getAllUsers(limit = 500) {
  if (!usersCol) return [];
  return usersCol.find({}).sort({ postCount: -1 }).limit(limit).toArray();
}

/**
 * Get all unique authorUserIds from posts that haven't been scraped yet.
 * Returns an array of { userId, username } objects.
 */
export async function getUnscrapedUserIds() {
  const db = getClockCrewDB();
  const postsColl = db.collection("ClockCrewNetPosts");
  const usersColl = db.collection("ClockCrewNetUsers");

  // Get all unique userIds from posts
  const postUserIds = await postsColl.distinct("authorUserId", {
    authorUserId: { $ne: null },
  });

  // Get already-scraped userIds
  const scrapedUserIds = await usersColl.distinct("userId");
  const scrapedSet = new Set(scrapedUserIds);

  // Return unscraped ones
  return postUserIds.filter((id) => !scrapedSet.has(id));
}

// ─── Thread Operations ──────────────────────────────────────────

/**
 * Upsert a single thread by topicId.
 * Returns true if the thread was newly inserted.
 */
export async function upsertThread(thread) {
  if (!threadsCol) return false;
  const result = await threadsCol.updateOne(
    { topicId: thread.topicId },
    {
      $set: { ...thread, lastScrapedAt: new Date() },
      $setOnInsert: { firstScrapedAt: new Date() },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/**
 * Check if a thread has already been scraped.
 */
export async function threadExists(topicId) {
  if (!threadsCol) return false;
  const doc = await threadsCol.findOne(
    { topicId },
    { projection: { _id: 1 } },
  );
  return !!doc;
}

/**
 * Get thread scrape metadata (lastScrapedAt, totalPosts).
 */
export async function getThreadMeta(topicId) {
  if (!threadsCol) return null;
  return threadsCol.findOne(
    { topicId },
    { projection: { lastScrapedAt: 1, totalPosts: 1, topicId: 1 } },
  );
}

// ─── Post Operations ────────────────────────────────────────────

/**
 * Bulk upsert posts by messageId.
 * Returns { upserted, modified }.
 */
export async function upsertPosts(posts) {
  if (!postsCol || posts.length === 0) return { upserted: 0, modified: 0 };

  const operations = posts.map((post) => ({
    updateOne: {
      filter: { messageId: post.messageId },
      update: {
        $set: { ...post, lastScrapedAt: new Date() },
        $setOnInsert: { firstScrapedAt: new Date() },
      },
      upsert: true,
    },
  }));

  try {
    const result = await postsCol.bulkWrite(operations, { ordered: false });
    return {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    };
  } catch (error) {
    console.error("[ClockCrew] Failed to upsert posts:", error.message);
    return { upserted: 0, modified: 0 };
  }
}

/**
 * Check if a post with this messageId already exists.
 */
export async function postExists(messageId) {
  if (!postsCol) return false;
  const doc = await postsCol.findOne(
    { messageId },
    { projection: { _id: 1 } },
  );
  return !!doc;
}

// ─── Query Operations ───────────────────────────────────────────

/**
 * Get all posts in a thread, sorted chronologically.
 */
export async function getPostsByThread(topicId, limit = 500) {
  if (!postsCol) return [];
  return postsCol
    .find({ topicId })
    .sort({ date: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Get all posts by author, sorted by newest first.
 */
export async function getPostsByAuthor(author, limit = 200) {
  if (!postsCol) return [];
  return postsCol
    .find({ author: new RegExp(`^${author}$`, "i") })
    .sort({ date: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Full-text search across post bodies.
 */
export async function searchPosts({ q, author, boardId, limit = 100 } = {}) {
  if (!postsCol) return [];

  const query = {};
  if (q) query.$text = { $search: q };
  if (author) query.author = new RegExp(`^${author}$`, "i");
  if (boardId) query.boardId = boardId;

  const cursor = q
    ? postsCol
        .find(query, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" } })
    : postsCol.find(query).sort({ date: -1 });

  return cursor.limit(limit).toArray();
}

/**
 * Get scrape progress stats.
 */
export async function getScrapeStats() {
  const db = getClockCrewDB();
  const [boardCount, threadCount, postCount, userCount] = await Promise.all([
    db.collection("ClockCrewNetBoards").countDocuments(),
    db.collection("ClockCrewNetThreads").countDocuments(),
    db.collection("ClockCrewNetPosts").countDocuments(),
    db.collection("ClockCrewNetUsers").countDocuments(),
  ]);

  // Get the latest scrape timestamp
  const latestThread = await db
    .collection("ClockCrewNetThreads")
    .findOne({}, { sort: { lastScrapedAt: -1 }, projection: { lastScrapedAt: 1 } });

  return {
    boards: boardCount,
    threads: threadCount,
    posts: postCount,
    users: userCount,
    lastScrapedAt: latestThread?.lastScrapedAt || null,
  };
}
