import { asyncHandler, HealthTracker } from "@rodrigo-barraza/utilities/node";
import { parseIntParam } from "@rodrigo-barraza/utilities";
import { Router } from "express";
import {
  getScrapeStats,
  getPostsByThread,
  getPostsByAuthor,
  searchPosts,
  getAllBoards,
  getAllUsers,
  getUser,
  getUserByName,
  getClockCrewDB,
} from "../models/ClockCrewPost.js";
const router = Router();
// ─── Health ─────────────────────────────────────────────────────
const health = new HealthTracker();
export function getClockCrewHealth() {
  return health.getHealth();
}
const opts = { errorStatus: 500, health };
// ─── GET /stats ─────────────────────────────────────────────────
// Returns scrape progress stats.
router.get(
  "/stats",
  asyncHandler(() => getScrapeStats(), "Clock Crew stats", opts),
);
// ─── GET /threads ───────────────────────────────────────────────
// List threads with optional filters.
// Query: ?boardId=6&author=RobClock&limit=50&skip=0
router.get(
  "/threads",
  asyncHandler(async (req) => {
    const db = getClockCrewDB();
    const col = db.collection("ClockCrewNetThreads");
    const query = {};
    if (req.query.boardId) query.boardId = parseInt(req.query.boardId, 10);
    if (req.query.author) query.author = new RegExp(`^${req.query.author}$`, "i");
    const limit = parseIntParam(req.query.limit, 50, 500);
    const skip = parseIntParam(req.query.skip, 0);
    const [threads, count] = await Promise.all([
      col.find(query).sort({ date: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(query),
    ]);
    return { count, threads };
  }, "Thread listing", 500),
);
// ─── GET /threads/:topicId/posts ────────────────────────────────
// Get all posts in a specific thread.
router.get(
  "/threads/:topicId/posts",
  asyncHandler(async (req) => {
    const topicId = parseInt(req.params.topicId, 10);
    const limit = parseIntParam(req.query.limit, 500, 2000);
    const posts = await getPostsByThread(topicId, limit);
    return { count: posts.length, posts };
  }, "Thread posts", 500),
);
// ─── GET /posts/by-author/:author ───────────────────────────────
// Get all posts by a specific author.
router.get(
  "/posts/by-author/:author",
  asyncHandler(async (req) => {
    const limit = parseIntParam(req.query.limit, 200, 1000);
    const posts = await getPostsByAuthor(req.params.author, limit);
    return { count: posts.length, posts };
  }, "Author posts", 500),
);
// ─── GET /posts/search ──────────────────────────────────────────
// Full-text search across post bodies.
// Query: ?q=clockmas&author=VCRClock&boardId=6&limit=50
router.get(
  "/posts/search",
  asyncHandler(async (req) => {
    const posts = await searchPosts({
      q: req.query.q,
      author: req.query.author,
      boardId: req.query.boardId
        ? parseInt(req.query.boardId, 10)
        : undefined,
      limit: parseIntParam(req.query.limit, 100, 500),
    });
    return { count: posts.length, posts };
  }, "Post search", 500),
);
// ─── GET /boards ────────────────────────────────────────────────
// Returns all scraped boards from the ClockCrewNetBoards collection.
router.get(
  "/boards",
  asyncHandler(async () => {
    const boards = await getAllBoards();
    return { count: boards.length, boards };
  }, "Board listing", 500),
);
// ─── GET /authors ───────────────────────────────────────────────
// Top posters by post count.
router.get(
  "/authors",
  asyncHandler(async (req) => {
    const db = getClockCrewDB();
    const col = db.collection("ClockCrewNetPosts");
    const limit = parseIntParam(req.query.limit, 50, 500);
    const authors = await col
      .aggregate([
        { $match: { author: { $ne: "" } } },
        {
          $group: {
            _id: "$author",
            postCount: { $sum: 1 },
            firstPost: { $min: "$date" },
            lastPost: { $max: "$date" },
          },
        },
        { $sort: { postCount: -1 } },
        { $limit: limit },
      ])
      .toArray();
    return {
      count: authors.length,
      authors: authors.map((a) => ({
        author: a._id,
        postCount: a.postCount,
        firstPost: a.firstPost,
        lastPost: a.lastPost,
      })),
    };
  }, "Author listing", 500),
);
// ─── GET /users ─────────────────────────────────────────────────
// All scraped user profiles.
router.get(
  "/users",
  asyncHandler(async (req) => {
    const limit = parseIntParam(req.query.limit, 500, 2000);
    const users = await getAllUsers(limit);
    return { count: users.length, users };
  }, "User listing", 500),
);
// ─── GET /users/:userId ────────────────────────────────────────
// Get a specific user profile by SMF userId.
router.get("/users/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const user = await getUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});
// ─── GET /users/by-name/:username ─────────────────────────────
// Lookup a user by username (case-insensitive).
router.get("/users/by-name/:username", async (req, res) => {
  const user = await getUserByName(req.params.username);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});
export default router;
