#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Newgrounds Profile Scraper — Standalone Runner
// ═══════════════════════════════════════════════════════════════
//  Usage:
//    node scripts/scrape-newgrounds.js --from-post              # scrape all users from olskoo's Clock Crew List
//    node scripts/scrape-newgrounds.js --username=StrawberryClock # specific user
//    node scripts/scrape-newgrounds.js --list=users.txt         # from a line-delimited file
//    node scripts/scrape-newgrounds.js --from-clockcrew         # discover from ClockCrewNetUsers.newgroundsUsername
//    node scripts/scrape-newgrounds.js --resume                 # skip already-scraped profiles
//    node scripts/scrape-newgrounds.js --parallel=4             # concurrent workers
//    node scripts/scrape-newgrounds.js --resume --from-post --parallel=2
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { connectDB } from "../db.js";
import CONFIG from "../config.js";
import { connectClockCrewDB, getClockCrewDB } from "../models/ClockCrewPost.js";
import {
  setupNewgroundsCollections,
  upsertProfile,
  upsertContentBatch,
  profileExists,
  getNewgroundsScrapeStats,
} from "../models/NewgroundsProfile.js";
import { fetchFullProfile } from "../fetchers/newgrounds/NewgroundsFetcher.js";

// ─── Polite delay between profiles ─────────────────────────────
const PROFILE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Parse CLI Args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const usernameArg = args.find((a) => a.startsWith("--username="));
const listArg = args.find((a) => a.startsWith("--list="));
const parallelArg = args.find((a) => a.startsWith("--parallel="));
const targetUsername = usernameArg ? usernameArg.split("=")[1] : null;
const listFile = listArg ? listArg.split("=")[1] : null;
const concurrency = parallelArg ? parseInt(parallelArg.split("=")[1], 10) : 1;
const resumeMode = args.includes("--resume");
const fromClockCrew = args.includes("--from-clockcrew");
const fromPost = args.includes("--from-post");

// Source post: olskoo's definitive Clock Crew List
const CLOCK_CREW_LIST_URL = "https://olskoo.newgrounds.com/news/post/1143641";

// ─── Shared Counters ────────────────────────────────────────────
let totalScraped = 0;
let totalSkipped = 0;
let totalErrors = 0;

// ─── Build Username Queue ───────────────────────────────────────

async function buildUsernameQueue() {
  const usernames = [];

  if (targetUsername) {
    usernames.push(targetUsername);
  } else if (fromPost) {
    // Scrape olskoo's Clock Crew List post for all @username links
    console.log(`  📋 Fetching Clock Crew List from ${CLOCK_CREW_LIST_URL}...`);
    const response = await fetch(CLOCK_CREW_LIST_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    const seen = new Set();
    // Links follow the pattern: href="https://username.newgrounds.com"
    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(/^https:\/\/([\w-]+)\.newgrounds\.com\/?$/);
      if (match) {
        const name = match[1].toLowerCase();
        // Skip site-level pages
        if (["www", "rss", "css", "js", "img", "cdnjs", "uimg"].includes(name)) return;
        if (!seen.has(name)) {
          seen.add(name);
          // Use the display text (the @Username) to preserve casing
          const linkText = $(el).text().trim().replace(/^@/, "");
          usernames.push(linkText || name);
        }
      }
    });

    console.log(`  📋 Found ${usernames.length} Newgrounds usernames from Clock Crew List post`);
  } else if (listFile) {
    const content = readFileSync(listFile, "utf-8");
    content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((u) => usernames.push(u));
  } else if (fromClockCrew) {
    // Discover from ClockCrewNetUsers collection
    const clockCrewDb = getClockCrewDB();
    const clockCrewUsers = await clockCrewDb
      .collection("ClockCrewNetUsers")
      .find(
        { newgroundsUsername: { $ne: "" } },
        { projection: { newgroundsUsername: 1 } },
      )
      .toArray();

    for (const u of clockCrewUsers) {
      if (u.newgroundsUsername && !usernames.includes(u.newgroundsUsername)) {
        usernames.push(u.newgroundsUsername);
      }
    }

    console.log(`  📋 Discovered ${usernames.length} Newgrounds usernames from Clock Crew users`);
  } else {
    console.error("  ❌ No input source specified. Use --username, --list, --from-post, or --from-clockcrew");
    process.exit(1);
  }

  return usernames;
}

// ─── Persist Content ────────────────────────────────────────────

async function persistFullProfile(data) {
  const { profile, fans, news, movies, games, audio, art, faves, reviews, posts } = data;

  // Upsert the profile itself
  await upsertProfile(profile);

  // Upsert each content type into its respective collection
  const results = {};

  if (fans.length > 0) {
    results.fans = await upsertContentBatch("NewgroundsFans", fans, "fanUsername");
  }
  if (news.length > 0) {
    results.news = await upsertContentBatch("NewgroundsNews", news, "contentId");
  }
  if (movies.length > 0) {
    results.movies = await upsertContentBatch("NewgroundsMovies", movies, "contentId");
  }
  if (games.length > 0) {
    results.games = await upsertContentBatch("NewgroundsGames", games, "contentId");
  }
  if (audio.length > 0) {
    results.audio = await upsertContentBatch("NewgroundsAudio", audio, "contentId");
  }
  if (art.length > 0) {
    results.art = await upsertContentBatch("NewgroundsArt", art, "contentId");
  }
  if (faves.length > 0) {
    results.faves = await upsertContentBatch("NewgroundsFaves", faves, "contentUrl");
  }
  if (reviews.length > 0) {
    results.reviews = await upsertContentBatch("NewgroundsReviews", reviews, "reviewId");
  }
  if (posts.length > 0) {
    results.posts = await upsertContentBatch("NewgroundsPosts", posts, "postId");
  }

  return results;
}

// ─── Scrape Worker ──────────────────────────────────────────────

async function scrapeWorker(workerId, queue) {
  while (queue.length > 0) {
    const username = queue.shift();
    if (!username) continue;

    const label = `[W${workerId}] [${totalScraped + totalSkipped + totalErrors + 1}]`;

    // Resume mode — skip if already scraped
    if (resumeMode) {
      const exists = await profileExists(username.toLowerCase());
      if (exists) {
        totalSkipped++;
        continue;
      }
    }

    try {
      const data = await fetchFullProfile(username);

      if (data) {
        await persistFullProfile(data);
        totalScraped++;

        // Build content summary
        const counts = [
          data.fans.length > 0 ? `fans:${data.fans.length}` : null,
          data.news.length > 0 ? `news:${data.news.length}` : null,
          data.movies.length > 0 ? `movies:${data.movies.length}` : null,
          data.games.length > 0 ? `games:${data.games.length}` : null,
          data.audio.length > 0 ? `audio:${data.audio.length}` : null,
          data.art.length > 0 ? `art:${data.art.length}` : null,
          data.faves.length > 0 ? `faves:${data.faves.length}` : null,
          data.reviews.length > 0 ? `reviews:${data.reviews.length}` : null,
          data.posts.length > 0 ? `posts:${data.posts.length}` : null,
        ].filter(Boolean);

        console.log(
          `${label} ✅ ${data.profile.username} — joined:${data.profile.joinDate || "?"} ${counts.join(" ") || "(no content)"}`,
        );
      } else {
        totalErrors++;
        console.log(`${label} ⚠️  ${username} — profile not found`);
      }

      await sleep(PROFILE_DELAY_MS);
    } catch (error) {
      totalErrors++;
      console.error(`${label} ❌ ${username} — ${error.message}`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🎮 Newgrounds Profile Scraper");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Mode: ${resumeMode ? "Resume (skip scraped)" : "Full scrape"}`);
  console.log(`  Concurrency: ${concurrency} worker${concurrency > 1 ? "s" : ""}`);
  if (targetUsername) console.log(`  Target: ${targetUsername}`);
  if (listFile) console.log(`  List: ${listFile}`);
  if (fromPost) console.log(`  Source: olskoo's Clock Crew List post`);
  if (fromClockCrew) console.log(`  Source: Clock Crew users`);
  console.log("");

  // Connect to databases
  await connectDB(CONFIG.MONGODB_URI);
  await connectClockCrewDB(CONFIG.MONGODB_URI);
  await setupNewgroundsCollections();

  // Show current stats
  const stats = await getNewgroundsScrapeStats();
  console.log(
    `  📊 Existing: ${stats.profiles} profiles, ${stats.fans} fans, ${stats.movies} movies, ${stats.games} games`,
  );
  if (stats.lastScrapedAt) {
    console.log(`  ⏰ Last scraped: ${stats.lastScrapedAt.toISOString()}`);
  }
  console.log("");

  // Build queue
  const queue = await buildUsernameQueue();
  console.log(`  📋 ${queue.length} users to process\n`);

  if (queue.length === 0) {
    console.log("  Nothing to scrape.");
    process.exit(0);
  }

  // Run workers
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(scrapeWorker(w + 1, queue));
  }
  await Promise.all(workers);

  // Final stats
  const finalStats = await getNewgroundsScrapeStats();
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  🏁 Scrape Complete");
  console.log(`  Profiles scraped: ${totalScraped}`);
  console.log(`  Skipped:          ${totalSkipped}`);
  console.log(`  Errors:           ${totalErrors}`);
  console.log(`  Total profiles:   ${finalStats.profiles}`);
  console.log(`  Total fans:       ${finalStats.fans}`);
  console.log(`  Total movies:     ${finalStats.movies}`);
  console.log(`  Total games:      ${finalStats.games}`);
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
