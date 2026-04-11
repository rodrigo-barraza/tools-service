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

const state = { lastChecked: null, error: null };

export function getClockCrewHealth() {
  return { lastChecked: state.lastChecked, error: state.error };
}

// ─── GET /stats ─────────────────────────────────────────────────
// Returns scrape progress stats.

router.get("/stats", async (_req, res) => {
  try {
    const stats = await getScrapeStats();
    state.lastChecked = new Date();
    res.json(stats);
  } catch (error) {
    state.error = error.message;
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /threads ───────────────────────────────────────────────
// List threads with optional filters.
// Query: ?boardId=6&author=RobClock&limit=50&skip=0

router.get("/threads", async (req, res) => {
  try {
    const db = getClockCrewDB();
    const col = db.collection("ClockCrewNetThreads");

    const query = {};
    if (req.query.boardId) query.boardId = parseInt(req.query.boardId, 10);
    if (req.query.author) query.author = new RegExp(`^${req.query.author}$`, "i");

    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const skip = parseInt(req.query.skip) || 0;

    const [threads, count] = await Promise.all([
      col.find(query).sort({ date: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(query),
    ]);

    res.json({ count, threads });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /threads/:topicId/posts ────────────────────────────────
// Get all posts in a specific thread.

router.get("/threads/:topicId/posts", async (req, res) => {
  try {
    const topicId = parseInt(req.params.topicId, 10);
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const posts = await getPostsByThread(topicId, limit);
    res.json({ count: posts.length, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /posts/by-author/:author ───────────────────────────────
// Get all posts by a specific author.

router.get("/posts/by-author/:author", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const posts = await getPostsByAuthor(req.params.author, limit);
    res.json({ count: posts.length, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /posts/search ──────────────────────────────────────────
// Full-text search across post bodies.
// Query: ?q=clockmas&author=VCRClock&boardId=6&limit=50

router.get("/posts/search", async (req, res) => {
  try {
    const posts = await searchPosts({
      q: req.query.q,
      author: req.query.author,
      boardId: req.query.boardId
        ? parseInt(req.query.boardId, 10)
        : undefined,
      limit: Math.min(parseInt(req.query.limit) || 100, 500),
    });
    res.json({ count: posts.length, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /boards ────────────────────────────────────────────────
// Returns all scraped boards from the ClockCrewNetBoards collection.

router.get("/boards", async (_req, res) => {
  try {
    const boards = await getAllBoards();
    res.json({ count: boards.length, boards });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /authors ───────────────────────────────────────────────
// Top posters by post count.

router.get("/authors", async (req, res) => {
  try {
    const db = getClockCrewDB();
    const col = db.collection("ClockCrewNetPosts");
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);

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

    res.json({
      count: authors.length,
      authors: authors.map((a) => ({
        author: a._id,
        postCount: a.postCount,
        firstPost: a.firstPost,
        lastPost: a.lastPost,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /users ─────────────────────────────────────────────────
// All scraped user profiles.

router.get("/users", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const users = await getAllUsers(limit);
    res.json({ count: users.length, users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /users/:userId ────────────────────────────────────────
// Get a specific user profile by SMF userId.

router.get("/users/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /users/by-name/:username ─────────────────────────────
// Lookup a user by username (case-insensitive).

router.get("/users/by-name/:username", async (req, res) => {
  try {
    const user = await getUserByName(req.params.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
