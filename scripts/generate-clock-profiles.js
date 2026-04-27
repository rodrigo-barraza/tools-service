// ═══════════════════════════════════════════════════════════════
// Clock Crew Comprehensive Profile Generator
// ═══════════════════════════════════════════════════════════════
// Generates extensive LLM-powered user profiles by aggregating
// ALL available data across ClockCrew.net forums AND Newgrounds.
//
// Data sources:
//   ClockCrewNetUsers, ClockCrewNetPosts, ClockCrewNetThreads,
//   UserProfileLink, NewgroundsProfiles, NewgroundsMovies,
//   NewgroundsGames, NewgroundsAudio, NewgroundsArt,
//   NewgroundsNews, NewgroundsFans, NewgroundsFaves,
//   NewgroundsReviews, NewgroundsPosts
//
// Uses Prism /chat?stream=false with lm-studio provider (Qwen3 32B)
// Saves results to ClockProfileSummaries collection in clockcrew DB
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── Load vault-service/.env before anything reads process.env ──────────
// NOTE: Must run BEFORE config.js/secrets.js are imported, because
// those modules read process.env at evaluation time. Static imports
// are hoisted above inline code, so we use dynamic import() below.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../vault-service/.env");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  console.log(`🔐 Loaded env from ${envPath}`);
} catch {
  console.warn(`⚠️  Could not load ${envPath} — relying on existing env vars`);
}

// Dynamic imports — must come AFTER env loading
const { MongoClient } = await import("mongodb");
const { default: CONFIG } = await import("../config.js");
const { toISODate } = await import("../utilities.js");

// ─── Configuration ──────────────────────────────────────────────
// Prism auto-distributes across LM Studio instances (least-busy)
const PROVIDER = "lm-studio";
const MODEL = "qwen3.6-35b-a3b";
const CONCURRENCY = 4;           // Parallel Prism calls (2 per instance × 2 instances)
const MAX_CC_POSTS = 500;        // ClockCrew forum posts sample
const MAX_NG_POSTS = 100;        // Newgrounds BBS posts sample
const MAX_REVIEWS = 50;          // NG reviews sample
const MAX_NEWS = 30;             // NG news/blog posts
const MAX_FAVES = 100;           // NG favorites
const MAX_BODY_LEN = 400;        // Trim individual post bodies
const MAX_DUMP_CHARS = 120_000;  // Hard cap ~30K tokens — fits in 60K context with room for output
const CONTEXT_LENGTH = 60_000;   // Request 60K context from LM Studio via Prism
const REQUEST_TIMEOUT_MS = 600_000; // 10 min for local model
const PRISM_SERVICE_URL = CONFIG.PRISM_SERVICE_URL || "http://localhost:7777";

// ─── System Prompt ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert biographer, archivist, and behavioral analyst specializing in internet culture and early 2000s Flash animation communities.

You are being given a comprehensive cross-platform data dump for a specific member of the "Clock Crew" — a legendary early internet Flash animation collective founded on Newgrounds.com around 2001-2002. The data spans years of activity across both the ClockCrew.net forums and Newgrounds.com. It may contain profile metadata, forum posts, threads they started, Flash movies they submitted, games they made, audio they published, art submissions, news/blog posts, fan relationships, favorited content, reviews they wrote, and Newgrounds BBS posts.

Synthesize all of this raw data into a comprehensive, engaging, and well-organized markdown profile suitable for a wiki-style user page.

## Output Structure
Use the following structure. If a section has no data, omit it entirely. Do NOT hallucinate or invent information. Use ONLY what the data provides:

# [Clock Name / Username]

> A one-paragraph executive summary: who they are, when they were active, what they're known for.

## Identity & Demographics
- Clock name, real name (if mentioned in posts), aliases, alt accounts
- Location, age/birth year (if mentioned), languages spoken
- Avatar description, custom forum titles, signature quotes
- Website URLs, contact info mentioned in profiles

## ClockCrew Forum Presence
- Registration date, post count, rank, custom title
- Posting style and frequency patterns
- Which boards they were most active on
- Notable threads they started — list the most interesting ones by name

## Newgrounds Profile
- Join date, experience points, level, blam/save stats
- Fan count, description/bio text
- Gender, job, school info from their profile
- Links and social media

## Creative Works
Break down by type with titles, scores, and dates:
### Flash Movies
### Games
### Audio
### Art
List each with title, score/rating, and date if available. Note any award-winners or particularly notable submissions.

## Writing & Reviews
- Reviews they wrote on other people's work (include the scores they gave and snippets)
- News/blog posts they published
- Notable Newgrounds BBS posts

## Personality & Communication Style
- Behavioral patterns observed from their posts (aggressive, witty, supportive, trollish, intellectual, etc.)
- Recurring topics, inside jokes, catchphrases
- How they interacted with others — conflicts, friendships, mentoring
- 2-3 direct quotes that best capture their personality (use exact quotes from the data with quotation marks)

## Community Role & Relationships
- Were they a moderator, admin, contest organizer, lurker, troll, respected elder, prolific creator?
- Key relationships: who they interacted with most, feuds, collaborations, fan connections
- Collab projects they participated in
- Their fans on Newgrounds (list notable ones)
- Content they favorited (reveals their tastes)

## Interests & Opinions
- Music, games, tech, food, politics, religion, or any strong opinions expressed
- Hobbies and skills outside of Flash animation
- Real-life career/school mentions

## Timeline & Activity Arc
Provide a chronological summary:
- When they joined, peak activity period, when they faded
- Key milestones (first movie, mod promotion, drama events, etc.)

## Legacy
- What they contributed to the Clock Crew and Newgrounds communities
- Any lasting impact, memes, or projects they left behind

CRITICAL RULES:
- Output ONLY the markdown. No preamble, no "Here is the profile..." wrapper.
- Do NOT include any thinking, reasoning steps, or analysis preamble. Start directly with the markdown heading.
- Be authentic to the era — this was an edgy early 2000s community. Do not censor profanity or edgy humor if it reflects the person's actual behavior.
- Use exact quotes from posts when possible to add authenticity and flavor.
- If a user has very little data (e.g., only a few posts, no NG profile), still create a concise profile with what's available.
- Distinguish between confirmed facts (from profile data) and inferred details (from post analysis).`;

// ─── MongoDB Connection ─────────────────────────────────────────
const client = new MongoClient(CONFIG.MONGODB_URI);

// ─── Data Gathering ─────────────────────────────────────────────

function trimBody(text, maxLen = MAX_BODY_LEN) {
  if (!text) return "";
  let body = text.replace(/\n+/g, " ").trim();
  if (body.length > maxLen) body = body.substring(0, maxLen) + "...";
  return body;
}

/**
 * Build the unified user list from both ClockCrewNetUsers and NewgroundsProfiles.
 * Deduplicates using UserProfileLink where possible.
 */
async function buildUserList(db) {
  const ccUsers = await db.collection("ClockCrewNetUsers")
    .find({})
    .sort({ postCount: -1 })
    .toArray();

  const ngProfiles = await db.collection("NewgroundsProfiles")
    .find({})
    .toArray();

  const links = await db.collection("UserProfileLink")
    .find({})
    .toArray();

  // Build lookup maps
  const linksByCcId = new Map();
  const linksByNgLower = new Map();
  for (const link of links) {
    if (!linksByCcId.has(link.ccUserId)) linksByCcId.set(link.ccUserId, []);
    linksByCcId.get(link.ccUserId).push(link);
    if (!linksByNgLower.has(link.ngUsernameLower)) linksByNgLower.set(link.ngUsernameLower, []);
    linksByNgLower.get(link.ngUsernameLower).push(link);
  }

  const ngByLower = new Map();
  for (const ng of ngProfiles) {
    ngByLower.set(ng.usernameLower, ng);
  }

  const ccById = new Map();
  for (const cc of ccUsers) {
    ccById.set(cc.userId, cc);
  }

  // Build unified list: each entry = { ccUser?, ngUsernameLowers[], primaryName }
  const processed = new Set(); // Track ngUsernameLower already covered
  const userList = [];

  // 1. Start with all CC users
  for (const cc of ccUsers) {
    const userLinks = linksByCcId.get(cc.userId) || [];
    const ngLowers = userLinks.map(l => l.ngUsernameLower);
    ngLowers.forEach(l => processed.add(l));

    userList.push({
      primaryName: cc.username,
      ccUser: cc,
      ngUsernameLowers: ngLowers,
    });
  }

  // 2. Add NG profiles not linked to any CC user
  for (const ng of ngProfiles) {
    if (processed.has(ng.usernameLower)) continue;
    const reverseLinks = linksByNgLower.get(ng.usernameLower) || [];
    // Check if any linked CC user already covered this
    const alreadyCovered = reverseLinks.some(l => ccById.has(l.ccUserId));
    if (alreadyCovered) continue;

    processed.add(ng.usernameLower);
    userList.push({
      primaryName: ng.username,
      ccUser: null,
      ngUsernameLowers: [ng.usernameLower],
    });
  }

  return userList;
}

/**
 * Generate a comprehensive data dump for one user across all collections.
 */
async function generateDataDump(db, userEntry) {
  const { primaryName: _primaryName, ccUser, ngUsernameLowers } = userEntry;
  let output = "";

  // ─── ClockCrew Forum Profile ──────────────────────────────────
  if (ccUser) {
    output += `═══ CLOCKCREW.NET FORUM PROFILE ═══\n`;
    // Only include relevant profile fields, skip scrape metadata
    const { _id: _cid, firstScrapedAt: _cfs, lastScrapedAt: _cls, ...ccClean } = ccUser;
    output += JSON.stringify(ccClean) + "\n\n";

    // CC Forum Posts
    const posts = await db.collection("ClockCrewNetPosts")
      .find({ author: new RegExp(`^${ccUser.username}$`, "i") })
      .sort({ date: 1 })
      .limit(MAX_CC_POSTS)
      .toArray();

    if (posts.length > 0) {
      output += `═══ CLOCKCREW FORUM POSTS (${posts.length}) ═══\n`;
      for (const p of posts) {
        const dateStr = p.date ? toISODate(new Date(p.date)) : "no-date";
        const thread = p.threadTitle || p.topicId || "";
        const board = p.boardName || p.boardId || "";
        const body = trimBody(p.body);
        if (body) {
          output += `[${dateStr} | Board: ${board} | Thread: ${thread}]\n${body}\n\n`;
        }
      }
    }

    // CC Threads Started
    const threads = await db.collection("ClockCrewNetThreads")
      .find({ author: new RegExp(`^${ccUser.username}$`, "i") })
      .sort({ date: 1 })
      .toArray();

    if (threads.length > 0) {
      output += `═══ CLOCKCREW THREADS STARTED (${threads.length}) ═══\n`;
      for (const t of threads) {
        const dateStr = t.date ? toISODate(new Date(t.date)) : "no-date";
        output += `${dateStr} | "${t.title}" (${t.totalPosts || 0} replies) [Board: ${t.boardName || t.boardId || ""}]\n`;
      }
      output += "\n";
    }
  }

  // ─── Newgrounds Data (for each linked profile) ────────────────
  for (const ngLower of ngUsernameLowers) {
    const ngProfile = await db.collection("NewgroundsProfiles").findOne({ usernameLower: ngLower });

    if (ngProfile) {
      output += `═══ NEWGROUNDS PROFILE: ${ngProfile.username} ═══\n`;
      const { _id: _nid, firstScrapedAt: _nfs, lastScrapedAt: _nls, ...ngClean } = ngProfile;
      output += JSON.stringify(ngClean) + "\n\n";
    }

    // Movies
    const movies = await db.collection("NewgroundsMovies").find({ usernameLower: ngLower }).sort({ publishedDate: -1 }).toArray();
    if (movies.length > 0) {
      output += `═══ NEWGROUNDS MOVIES (${movies.length}) ═══\n`;
      for (const m of movies) {
        output += `- "${m.title}" | Score: ${m.score ?? "N/A"} | Views: ${m.views ?? "?"} | Date: ${m.publishedDate || "?"}\n`;
        if (m.description) output += `  Description: ${trimBody(m.description, 200)}\n`;
      }
      output += "\n";
    }

    // Games
    const games = await db.collection("NewgroundsGames").find({ usernameLower: ngLower }).sort({ publishedDate: -1 }).toArray();
    if (games.length > 0) {
      output += `═══ NEWGROUNDS GAMES (${games.length}) ═══\n`;
      for (const g of games) {
        output += `- "${g.title}" | Score: ${g.score ?? "N/A"} | Views: ${g.views ?? "?"} | Date: ${g.publishedDate || "?"}\n`;
        if (g.description) output += `  Description: ${trimBody(g.description, 200)}\n`;
      }
      output += "\n";
    }

    // Audio
    const audio = await db.collection("NewgroundsAudio").find({ usernameLower: ngLower }).sort({ publishedDate: -1 }).toArray();
    if (audio.length > 0) {
      output += `═══ NEWGROUNDS AUDIO (${audio.length}) ═══\n`;
      for (const a of audio) {
        output += `- "${a.title}" | Score: ${a.score ?? "N/A"} | Date: ${a.publishedDate || "?"}\n`;
      }
      output += "\n";
    }

    // Art
    const art = await db.collection("NewgroundsArt").find({ usernameLower: ngLower }).sort({ publishedDate: -1 }).toArray();
    if (art.length > 0) {
      output += `═══ NEWGROUNDS ART (${art.length}) ═══\n`;
      for (const a of art) {
        output += `- "${a.title}" | Score: ${a.score ?? "N/A"} | Date: ${a.publishedDate || "?"}\n`;
      }
      output += "\n";
    }

    // News / Blog Posts
    const news = await db.collection("NewgroundsNews").find({ usernameLower: ngLower }).sort({ publishedDate: -1 }).limit(MAX_NEWS).toArray();
    if (news.length > 0) {
      output += `═══ NEWGROUNDS NEWS/BLOG POSTS (${news.length}) ═══\n`;
      for (const n of news) {
        output += `- "${n.title}" | Date: ${n.publishedDate || "?"}\n`;
        if (n.body || n.content) output += `  ${trimBody(n.body || n.content, 200)}\n`;
      }
      output += "\n";
    }

    // Fans
    const fans = await db.collection("NewgroundsFans").find({ usernameLower: ngLower }).toArray();
    if (fans.length > 0) {
      output += `═══ NEWGROUNDS FANS (${fans.length}) ═══\n`;
      output += fans.map(f => f.fanUsername).join(", ") + "\n\n";
    }

    // Favorites
    const faves = await db.collection("NewgroundsFaves").find({ usernameLower: ngLower }).limit(MAX_FAVES).toArray();
    if (faves.length > 0) {
      output += `═══ NEWGROUNDS FAVORITES (${faves.length}) ═══\n`;
      for (const f of faves) {
        output += `- "${f.title || f.contentUrl}" (${f.type || "unknown"})\n`;
      }
      output += "\n";
    }

    // Reviews
    const reviews = await db.collection("NewgroundsReviews").find({ usernameLower: ngLower }).limit(MAX_REVIEWS).toArray();
    if (reviews.length > 0) {
      output += `═══ NEWGROUNDS REVIEWS WRITTEN (${reviews.length}) ═══\n`;
      for (const r of reviews) {
        const body = trimBody(r.body || r.text, 150);
        output += `- Score: ${r.score ?? "?"}/10 | "${r.contentTitle || r.contentUrl || "?"}" | ${body}\n`;
      }
      output += "\n";
    }

    // NG BBS Posts
    const ngPosts = await db.collection("NewgroundsPosts").find({ usernameLower: ngLower }).sort({ date: -1 }).limit(MAX_NG_POSTS).toArray();
    if (ngPosts.length > 0) {
      output += `═══ NEWGROUNDS BBS POSTS (${ngPosts.length}) ═══\n`;
      for (const p of ngPosts) {
        const dateStr = p.date ? toISODate(new Date(p.date)) : "no-date";
        const body = trimBody(p.body || p.content, 250);
        if (body) {
          output += `[${dateStr}] ${body}\n\n`;
        }
      }
    }
  }

  // ─── Hard truncation to stay within context limits ────────────
  if (output.length > MAX_DUMP_CHARS) {
    output = output.substring(0, MAX_DUMP_CHARS) + "\n\n[... data truncated to fit context window ...]";
  }

  return output;
}

// ─── Prism API Call ─────────────────────────────────────────────

async function callPrism(dataDump, username, provider) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${PRISM_SERVICE_URL}/chat?stream=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Here is the complete data dump for the Clock Crew member "${username}". Analyze everything and create their comprehensive profile:\n\n${dataDump}` },
        ],
        temperature: 0.4,
        maxTokens: 16384,
        minContextLength: CONTEXT_LENGTH,
        thinkingEnabled: false,
        project: "tools-api",
        username: "system",
        skipConversation: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Prism returned ${res.status}: ${errText.slice(0, 300)}`);
    }

    const json = await res.json();

    // Debug: log response shape
    const keys = Object.keys(json);
    const textLen = json.text?.length || 0;
    const thinkLen = json.thinking?.length || 0;
    console.log(`       📡 Response keys: [${keys.join(", ")}] text=${textLen} thinking=${thinkLen}`);

    // Use text only — thinking content is chain-of-thought, not the profile
    let output = json.text || null;

    // Safety net: strip any residual <think> tags that leaked through
    if (output) {
      output = output.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    // If text was empty but thinking had content, the model failed to produce output
    if (!output && thinkLen > 0) {
      console.log(`       ⚠️  Model returned thinking (${thinkLen} chars) but no text — treating as failure`);
    }

    return output;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  await client.connect();
  const db = client.db("clockcrew");

  // Check what's already been generated
  const existing = await db.collection("ClockProfileSummaries")
    .find({}, { projection: { usernameLower: 1 } })
    .toArray();
  const existingSet = new Set(existing.map(e => e.usernameLower));

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  🕰️  Clock Crew Profile Generator`);
  console.log(`  Provider: ${PROVIDER} | Model: ${MODEL} | Concurrency: ${CONCURRENCY}`);
  console.log(`  Already generated: ${existingSet.size} profiles`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // Build unified user list
  console.log(`📋 Building unified user list from ClockCrewNetUsers + NewgroundsProfiles...`);
  const userList = await buildUserList(db);
  console.log(`   Found ${userList.length} unique users total\n`);

  // Filter out already-processed users
  const pending = userList.filter(u => !existingSet.has(u.primaryName.toLowerCase()));
  console.log(`   ${pending.length} users remaining to process\n`);

  if (pending.length === 0) {
    console.log(`🎉 All profiles already generated!`);
    await client.close();
    return;
  }

  const summariesCol = db.collection("ClockProfileSummaries");
  let completedCount = 0;
  let errorCount = 0;

  console.log(`🚀 Processing ${pending.length} users with ${CONCURRENCY} concurrent workers...\n`);

  // ─── Concurrent Worker Pool ─────────────────────────────────
  let currentIndex = 0;
  let activeWorkers = 0;

  await new Promise((resolve) => {
    function processNext() {
      if (currentIndex >= pending.length) {
        if (activeWorkers === 0) resolve();
        return;
      }

      const userEntry = pending[currentIndex++];
      const userNumber = currentIndex;
      activeWorkers++;

      (async () => {
        const label = `[${userNumber}/${pending.length}]`;
        console.log(`${label} ⏳ Gathering data for: ${userEntry.primaryName}...`);

        try {
          // 1. Gather all data
          const dataDump = await generateDataDump(db, userEntry);
          const dumpSizeKB = (Buffer.byteLength(dataDump, "utf-8") / 1024).toFixed(1);
          console.log(`${label}    📦 Data dump: ${dumpSizeKB} KB`);

          // Skip if almost no data
          if (dataDump.length < 100) {
            console.log(`${label}    ⚠️  Skipping — insufficient data`);
            await summariesCol.updateOne(
              { usernameLower: userEntry.primaryName.toLowerCase() },
              {
                $set: {
                  username: userEntry.primaryName,
                  usernameLower: userEntry.primaryName.toLowerCase(),
                  summaryMarkdown: `# ${userEntry.primaryName}\n\n> Insufficient data available to generate a profile.`,
                  generatedAt: new Date(),
                  model: MODEL,
                  provider: PROVIDER,
                  dataSizeBytes: Buffer.byteLength(dataDump, "utf-8"),
                  status: "insufficient_data",
                },
              },
              { upsert: true },
            );
            completedCount++;
          } else {
            // 2. Call Prism with local model
            console.log(`${label}    🤖 Sending to ${MODEL}...`);
            const startTime = Date.now();
            const profileMarkdown = await callPrism(dataDump, userEntry.primaryName, PROVIDER);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (!profileMarkdown || profileMarkdown.trim().length < 50) {
              throw new Error("Received empty or too-short response from model");
            }

            console.log(`${label}    ✅ Generated in ${elapsed}s (${(profileMarkdown.length / 1024).toFixed(1)} KB)`);

            // 3. Save to MongoDB
            await summariesCol.updateOne(
              { usernameLower: userEntry.primaryName.toLowerCase() },
              {
                $set: {
                  username: userEntry.primaryName,
                  usernameLower: userEntry.primaryName.toLowerCase(),
                  summaryMarkdown: profileMarkdown.trim(),
                  generatedAt: new Date(),
                  model: MODEL,
                  provider: PROVIDER,
                  dataSizeBytes: Buffer.byteLength(dataDump, "utf-8"),
                  hasClockCrewProfile: !!userEntry.ccUser,
                  ngProfileCount: userEntry.ngUsernameLowers.length,
                  linkedNgUsernames: userEntry.ngUsernameLowers,
                  status: "complete",
                },
              },
              { upsert: true },
            );

            completedCount++;
            console.log(`${label}    💾 Saved to ClockProfileSummaries`);
          }
        } catch (err) {
          errorCount++;
          console.error(`${label}    ❌ Error: ${err.message}`);
        }

        activeWorkers--;
        console.log(`     📊 Progress: ${completedCount + errorCount}/${pending.length} (${completedCount} ✅ ${errorCount} ❌) | ${activeWorkers} active workers\n`);
        processNext();
      })();
    }

    // Kick off initial workers
    for (let i = 0; i < CONCURRENCY; i++) {
      processNext();
    }
  });

  await client.close();
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  🎉 Generation complete!`);
  console.log(`  ✅ Succeeded: ${completedCount}`);
  console.log(`  ❌ Failed: ${errorCount}`);
  console.log(`  📊 Total in DB: ${existingSet.size + completedCount}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
