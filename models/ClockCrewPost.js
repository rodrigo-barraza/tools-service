import { getDB } from "../db.js";

let boardsCol = null;
let threadsCol = null;
let postsCol = null;
let usersCol = null;

// ═══════════════════════════════════════════════════════════════
//  Clock Crew Forum — MongoDB Collections
// ═══════════════════════════════════════════════════════════════
//  clockcrew_boards  — One doc per board (board metadata)
//  clockcrew_threads — One doc per topic (thread metadata)
//  clockcrew_posts   — One doc per message (post content)
//  clockcrew_users   — One doc per forum user (profile data)
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize both collections with required indexes.
 */
export async function setupClockCrewCollections() {
  const db = getDB();
  boardsCol = db.collection("clockcrew_boards");
  threadsCol = db.collection("clockcrew_threads");
  postsCol = db.collection("clockcrew_posts");
  usersCol = db.collection("clockcrew_users");

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

  console.log("🕰️  Clock Crew collections & indexes ready");
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
  const db = getDB();
  const postsColl = db.collection("clockcrew_posts");
  const usersColl = db.collection("clockcrew_users");

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
  const db = getDB();
  const [boardCount, threadCount, postCount, userCount] = await Promise.all([
    db.collection("clockcrew_boards").countDocuments(),
    db.collection("clockcrew_threads").countDocuments(),
    db.collection("clockcrew_posts").countDocuments(),
    db.collection("clockcrew_users").countDocuments(),
  ]);

  // Get the latest scrape timestamp
  const latestThread = await db
    .collection("clockcrew_threads")
    .findOne({}, { sort: { lastScrapedAt: -1 }, projection: { lastScrapedAt: 1 } });

  return {
    boards: boardCount,
    threads: threadCount,
    posts: postCount,
    users: userCount,
    lastScrapedAt: latestThread?.lastScrapedAt || null,
  };
}
