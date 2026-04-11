#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Clock Crew Forum Scraper — Standalone Runner
// ═══════════════════════════════════════════════════════════════
//  Usage:
//    node scripts/scrape-clockcrew.js                    # scrape all boards (sequential)
//    node scripts/scrape-clockcrew.js --board=6          # specific board only
//    node scripts/scrape-clockcrew.js --resume           # skip already-scraped threads
//    node scripts/scrape-clockcrew.js --parallel=4       # scrape 4 boards concurrently
//    node scripts/scrape-clockcrew.js --users            # also scrape user profiles
//    node scripts/scrape-clockcrew.js --users-only       # only scrape user profiles
//    node scripts/scrape-clockcrew.js --resume --parallel=4 --users
// ═══════════════════════════════════════════════════════════════

import { connectDB } from "../db.js";
import CONFIG from "../config.js";
import {
  connectClockCrewDB,
  setupClockCrewCollections,
  upsertBoard,
  upsertThread,
  upsertPosts,
  upsertUser,
  userExists,
  getThreadMeta,
  getScrapeStats,
} from "../models/ClockCrewPost.js";
import {
  fetchBoardList,
  fetchAllThreadsForBoard,
  fetchAllPostsForTopic,
  fetchUserProfile,
} from "../fetchers/clockcrew/ClockCrewFetcher.js";

// ─── Polite delay between topics ────────────────────────────────
const TOPIC_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Parse CLI Args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const boardArg = args.find((a) => a.startsWith("--board="));
const parallelArg = args.find((a) => a.startsWith("--parallel="));
const targetBoard = boardArg ? parseInt(boardArg.split("=")[1], 10) : null;
const concurrency = parallelArg ? parseInt(parallelArg.split("=")[1], 10) : 1;
const resumeMode = args.includes("--resume");
const scrapeUsers = args.includes("--users") || args.includes("--users-only");
const usersOnly = args.includes("--users-only");
const maxUserIdArg = args.find((a) => a.startsWith("--max-user-id="));
const minUserIdArg = args.find((a) => a.startsWith("--min-user-id="));
const maxUserId = maxUserIdArg ? parseInt(maxUserIdArg.split("=")[1], 10) : 15000;
const minUserId = minUserIdArg ? parseInt(minUserIdArg.split("=")[1], 10) : 1;

// ─── Shared Counters (atomic-safe for single-threaded Node) ─────
let totalThreadsScraped = 0;
let totalPostsScraped = 0;
let totalSkipped = 0;
let totalUsersScraped = 0;

// ─── Scrape a Single Board ──────────────────────────────────────

async function scrapeBoard(board) {
  const label = `[Board ${board.boardId}]`;

  // Phase 1: Enumerate all topics
  console.log(`${label} Enumerating topics...`);
  const { topics, boardName } = await fetchAllThreadsForBoard(
    board.boardId,
    (p) => {
      if (p.pageCount % 10 === 0) {
        console.log(
          `${label} Page ${p.pageCount} — ${p.topicsFound} topics found`,
        );
      }
    },
  );
  console.log(`${label} ✅ ${topics.length} topics enumerated`);

  // Upsert board metadata
  const resolvedName = boardName || board.name || `Board ${board.boardId}`;
  await upsertBoard({
    boardId: board.boardId,
    name: resolvedName,
    url: `https://clockcrew.net/talk/index.php?board=${board.boardId}.0`,
    threadCount: topics.length,
  });

  // Phase 2: Scrape each topic
  let boardThreads = 0;
  let boardPosts = 0;
  let boardSkipped = 0;

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const progress = `${label} [${i + 1}/${topics.length}]`;

    // Check if already scraped (resume mode)
    if (resumeMode) {
      const existing = await getThreadMeta(topic.topicId);
      if (existing) {
        boardSkipped++;
        totalSkipped++;
        continue;
      }
    }

    try {
      const { posts, thread } = await fetchAllPostsForTopic(topic.topicId);

      const threadDoc = {
        topicId: topic.topicId,
        boardId: board.boardId,
        boardName: resolvedName,
        title: thread.title || topic.title,
        author: thread.author || topic.author,
        date: thread.date,
        totalPosts: posts.length,
        url: `https://clockcrew.net/talk/index.php?topic=${topic.topicId}.0`,
      };

      await upsertThread(threadDoc);
      const postResult = await upsertPosts(posts);

      boardThreads++;
      boardPosts += posts.length;
      totalThreadsScraped++;
      totalPostsScraped += posts.length;

      console.log(
        `${progress} "${(topic.title || "").substring(0, 40)}" — ${posts.length} posts (${postResult.upserted} new)`,
      );

      await sleep(TOPIC_DELAY_MS);
    } catch (error) {
      console.error(`${progress} ❌ ${error.message}`);
    }
  }

  console.log(
    `${label} 🏁 Done — ${boardThreads} threads, ${boardPosts} posts, ${boardSkipped} skipped`,
  );
}

// ─── Parallel Runner ────────────────────────────────────────────

async function runParallel(boards, maxConcurrency) {
  const queue = [...boards];
  const workers = [];

  for (let w = 0; w < maxConcurrency; w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const board = queue.shift();
          if (board) await scrapeBoard(board);
        }
      })(),
    );
  }

  await Promise.all(workers);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🕰️  Clock Crew Forum Scraper");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Mode: ${resumeMode ? "Resume (skip scraped)" : "Full scrape"}${usersOnly ? " (users only)" : ""}`);
  console.log(`  Concurrency: ${concurrency} board${concurrency > 1 ? "s" : ""} at a time`);
  if (scrapeUsers || usersOnly) console.log("  User Profiles: Enabled");
  if (targetBoard) console.log(`  Target Board: ${targetBoard}`);
  console.log("");

  // Connect to MongoDB
  await connectDB(CONFIG.MONGODB_URI);
  await connectClockCrewDB(CONFIG.MONGODB_URI);
  await setupClockCrewCollections();

  // Show current stats
  const stats = await getScrapeStats();
  console.log(`  📊 Existing: ${stats.boards} boards, ${stats.threads} threads, ${stats.posts} posts, ${stats.users} users`);
  if (stats.lastScrapedAt) {
    console.log(`  ⏰ Last scraped: ${stats.lastScrapedAt.toISOString()}`);
  }
  console.log("");

  // ─── Phase 1: Board + Post Scraping ─────────────────────────────
  if (!usersOnly) {
    // Discover boards
    let boards;
    if (targetBoard) {
      boards = [{ boardId: targetBoard, name: `Board ${targetBoard}` }];
    } else {
      console.log("  📋 Discovering boards...");
      boards = await fetchBoardList();
      console.log(`  Found ${boards.length} boards\n`);
    }

    // Run — parallel or sequential
    if (concurrency > 1) {
      await runParallel(boards, concurrency);
    } else {
      for (const board of boards) {
        console.log(`\n─── Board ${board.boardId}: ${board.name} ───────────────`);
        await scrapeBoard(board);
      }
    }
  }

  // ─── Phase 2: User Profile Scraping (Sequential IDs) ─────────
  if (scrapeUsers || usersOnly) {
    console.log("\n═══ User Profile Scraping ═════════════════════════════════════");
    console.log(`  Scanning user IDs ${minUserId} — ${maxUserId} (${concurrency} workers)\n`);

    // Build queue of IDs to check
    let nextId = minUserId;

    async function userWorker(workerId) {
      while (nextId <= maxUserId) {
        const uid = nextId++;

        // Skip if already scraped
        const exists = await userExists(uid);
        if (exists) {
          totalSkipped++;
          continue;
        }

        try {
          const profile = await fetchUserProfile(uid);
          if (profile) {
            await upsertUser(profile);
            totalUsersScraped++;
            console.log(
              `  [W${workerId}] [${uid}/${maxUserId}] ✅ ${profile.username} (${profile.position || "member"}) — ${profile.postCount} posts`,
            );
          }
          await sleep(500);
        } catch (error) {
          console.error(
            `  [W${workerId}] [${uid}/${maxUserId}] ❌ ${error.message}`,
          );
        }
      }
    }

    const workers = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(userWorker(w + 1));
    }
    await Promise.all(workers);
  }

  // Final stats
  const finalStats = await getScrapeStats();
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  🏁 Scrape Complete");
  console.log(`  Threads scraped: ${totalThreadsScraped}`);
  console.log(`  Posts scraped:   ${totalPostsScraped}`);
  console.log(`  Users scraped:   ${totalUsersScraped}`);
  console.log(`  Skipped:         ${totalSkipped}`);
  console.log(`  Total boards:    ${finalStats.boards}`);
  console.log(`  Total threads:   ${finalStats.threads}`);
  console.log(`  Total posts:     ${finalStats.posts}`);
  console.log(`  Total users:     ${finalStats.users}`);
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
