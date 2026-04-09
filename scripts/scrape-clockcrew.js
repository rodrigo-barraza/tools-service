#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Clock Crew Forum Scraper — Standalone Runner
// ═══════════════════════════════════════════════════════════════
//  Usage:
//    node scripts/scrape-clockcrew.js                # scrape all boards
//    node scripts/scrape-clockcrew.js --board=6      # specific board only
//    node scripts/scrape-clockcrew.js --resume       # skip already-scraped threads
//    node scripts/scrape-clockcrew.js --board=6 --resume
// ═══════════════════════════════════════════════════════════════

import { connectDB } from "../db.js";
import CONFIG from "../config.js";
import {
  setupClockCrewCollections,
  upsertBoard,
  upsertThread,
  upsertPosts,
  getThreadMeta,
  getScrapeStats,
} from "../models/ClockCrewPost.js";
import {
  fetchBoardList,
  fetchAllThreadsForBoard,
  fetchAllPostsForTopic,
} from "../fetchers/clockcrew/ClockCrewFetcher.js";

// ─── Polite delay between topics ────────────────────────────────
const TOPIC_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Parse CLI Args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const boardArg = args.find((a) => a.startsWith("--board="));
const targetBoard = boardArg ? parseInt(boardArg.split("=")[1], 10) : null;
const resumeMode = args.includes("--resume");

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🕰️  Clock Crew Forum Scraper");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Mode: ${resumeMode ? "Resume (skip scraped)" : "Full scrape"}`);
  if (targetBoard) console.log(`  Target Board: ${targetBoard}`);
  console.log("");

  // Connect to MongoDB
  await connectDB(CONFIG.MONGODB_URI);
  await setupClockCrewCollections();

  // Show current stats
  const stats = await getScrapeStats();
  console.log(`  📊 Existing data: ${stats.boards} boards, ${stats.threads} threads, ${stats.posts} posts`);
  if (stats.lastScrapedAt) {
    console.log(`  ⏰ Last scraped: ${stats.lastScrapedAt.toISOString()}`);
  }
  console.log("");

  // Discover boards
  let boards;
  if (targetBoard) {
    boards = [{ boardId: targetBoard, name: `Board ${targetBoard}` }];
  } else {
    console.log("  📋 Discovering boards...");
    boards = await fetchBoardList();
    console.log(`  Found ${boards.length} boards\n`);
  }

  let totalThreadsScraped = 0;
  let totalPostsScraped = 0;
  let totalSkipped = 0;

  for (const board of boards) {
    console.log(`\n─── Board ${board.boardId}: ${board.name} ───────────────`);

    // Phase 1: Enumerate all topics in this board
    console.log("  Enumerating topics...");
    const { topics, boardName } = await fetchAllThreadsForBoard(board.boardId, (p) => {
      if (p.pageCount % 10 === 0) {
        process.stdout.write(
          `\r  Page ${p.pageCount} — ${p.topicsFound} topics found`,
        );
      }
    });
    console.log(`\r  ✅ ${topics.length} topics enumerated                `);

    // Upsert board metadata
    const resolvedName = boardName || board.name || `Board ${board.boardId}`;
    await upsertBoard({
      boardId: board.boardId,
      name: resolvedName,
      url: `https://clockcrew.net/talk/index.php?board=${board.boardId}.0`,
      threadCount: topics.length,
    });

    // Phase 2: Scrape each topic
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const progress = `[${i + 1}/${topics.length}]`;

      // Check if already scraped (resume mode)
      if (resumeMode) {
        const existing = await getThreadMeta(topic.topicId);
        if (existing) {
          totalSkipped++;
          continue;
        }
      }

      try {
        const { posts, thread } = await fetchAllPostsForTopic(topic.topicId);

        // Build thread document
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

        totalThreadsScraped++;
        totalPostsScraped += posts.length;

        console.log(
          `  ${progress} Topic ${topic.topicId}: "${(topic.title || "").substring(0, 40)}" — ${posts.length} posts (${postResult.upserted} new)`,
        );

        await sleep(TOPIC_DELAY_MS);
      } catch (error) {
        console.error(
          `  ${progress} ❌ Topic ${topic.topicId} failed: ${error.message}`,
        );
      }
    }
  }

  // Final stats
  const finalStats = await getScrapeStats();
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  🏁 Scrape Complete");
  console.log(`  Threads scraped: ${totalThreadsScraped}`);
  console.log(`  Posts scraped:   ${totalPostsScraped}`);
  console.log(`  Skipped:         ${totalSkipped}`);
  console.log(`  Total boards:    ${finalStats.boards}`);
  console.log(`  Total threads:   ${finalStats.threads}`);
  console.log(`  Total posts:     ${finalStats.posts}`);
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
