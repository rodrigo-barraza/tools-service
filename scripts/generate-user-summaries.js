// ═══════════════════════════════════════════════════════════════
// ClockCrew + Newgrounds User Profile Summarizer
// ═══════════════════════════════════════════════════════════════
// Generates deep LLM personality profiles for every user by
// aggregating their forum posts, threads, and linked NG media.
// ═══════════════════════════════════════════════════════════════

import { MongoClient } from "mongodb";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import CONFIG from "../config.js";
import PrismService from "../services/PrismService.js";

const OUTPUT_DIR = path.join(process.cwd(), "user_summaries");
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Removed health check since Prism's /health may not exist


const client = new MongoClient(CONFIG.MONGODB_URI);

async function generateDataDump(db, ccUser) {
  let output = `=== CLOCKCREW PROFILE: ${ccUser.username} ===\n`;
  output += JSON.stringify(ccUser, null, 2) + "\n\n";

  // 1. ClockCrew Posts (Limit to 1500 to save tokens, chronological)
  const posts = await db.collection("ClockCrewNetPosts")
    .find({ author: new RegExp(`^${ccUser.username}$`, "i") })
    .sort({ date: 1 })
    .limit(1500)
    .toArray();
  
  output += `=== FORUM POSTS (${posts.length} scraped) ===\n`;
  for (const p of posts) {
    const dateStr = p.date ? new Date(p.date).toISOString().slice(0, 10) : "no-date";
    const thread = p.threadTitle || p.topicId || "";
    let body = (p.body || "").replace(/\n+/g, " ").trim();
    if (body.length > 500) body = body.substring(0, 500) + "..."; // Trim very long posts
    output += `[${dateStr} | Thread: ${thread}]\n${body}\n\n`;
  }

  // 2. ClockCrew Threads
  const threads = await db.collection("ClockCrewNetThreads")
    .find({ author: new RegExp(`^${ccUser.username}$`, "i") })
    .sort({ date: 1 })
    .toArray();
  
  output += `=== THREADS STARTED (${threads.length}) ===\n`;
  for (const t of threads) {
    const dateStr = t.date ? new Date(t.date).toISOString().slice(0, 10) : "no-date";
    output += `${dateStr} | ${t.title} (${t.totalPosts || 0} replies)\n`;
  }

  // 3. Newgrounds Linked Data
  const links = await db.collection("UserProfileLink")
    .find({ ccUserId: ccUser.userId })
    .toArray();

  if (links.length > 0) {
    output += `\n=== LINKED NEWGROUNDS PROFILES (${links.length}) ===\n`;
    output += JSON.stringify(links, null, 2) + "\n\n";

    for (const link of links) {
      const ngUserLower = link.ngUsernameLower;
      
      const ngProfile = await db.collection("NewgroundsProfiles").findOne({ usernameLower: ngUserLower });
      if (ngProfile) {
        output += `\n--- NG PROFILE: ${ngProfile.username} ---\n`;
        output += JSON.stringify(ngProfile, null, 2) + "\n";

        const movies = await db.collection("NewgroundsMovies").find({ usernameLower: ngUserLower }).toArray();
        if (movies.length > 0) {
          output += `--- NG MOVIES ---\n` + JSON.stringify(movies, null, 2) + "\n";
        }

        const fans = await db.collection("NewgroundsFans").find({ usernameLower: ngUserLower }).toArray();
        if (fans.length > 0) {
          output += `--- NG FANS ---\n` + JSON.stringify(fans.map(f => f.fanUsername)) + "\n";
        }

        const faves = await db.collection("NewgroundsFaves").find({ usernameLower: ngUserLower }).toArray();
        if (faves.length > 0) {
          output += `--- NG FAVORITES ---\n` + JSON.stringify(faves.map(f => f.title)) + "\n";
        }

        const reviews = await db.collection("NewgroundsReviews").find({ usernameLower: ngUserLower }).toArray();
        if (reviews.length > 0) {
          output += `--- NG REVIEWS ---\n`;
          for (const r of reviews) {
            output += `Score: ${r.score || '?'} | ${(r.body || r.text || "").substring(0, 200)}\n`;
          }
        }
      }
    }
  }

  return output;
}

const SYSTEM_PROMPT = `You are an expert biographer, archivist, and behavioral analyst specializing in internet culture and early 2000s forum communities.

I am providing you with a complete cross-platform data dump for a specific member of the "Clock Crew" (a pivotal early internet Flash animation community). This data spans up to a decade of activity across both the ClockCrew.net forums and Newgrounds.com. It contains profile metadata, their forum posts, threads started, their animated movies submitted, fans, and reviews.

Your task is to synthesize this raw chaotic dump into a beautiful, comprehensive, and engaging markdown profile.

## Requirements
Use the following structure exactly (if a user lacks data for a section, omit the section or state it briefly, but do not hallucinate):

# [Username] — Profile Summary
> Based on [X] forum posts, [Y] threads, and [Z] Newgrounds pieces of content.
(Brief 1-paragraph summary)

## Identity
Extract their real name, location, age, custom titles, languages spoken, other handles, websites, and general demographics from their casual posts and profile fields.

## Career & Real Life
Extract whatever details they dropped about their jobs, school, college majors, relationships, and life timeline outside the forum.

## Skills & Artistic Talent
Discuss their actual output. What did they animate? Did they draw? Did they program or do audio? Reference their specific Newgrounds movies, reviews they wrote, or art they posted.

## Personality
Map their behavioral traits and humor style. Are they aggressive, warm, introspective, shitposting, or helpful? Provide 2-3 specific behavioral patterns or quotes that encapsulate their style.

## Community Role
What role did they play? Were they a moderator, a lurker, a contest organizer, a troll, a respected elder? Did they lead any projects?

## Interests & Tastes
List their favorite music, games, technologies, foods, or opinions they argued strongly about.

## Timeline
Provide a small chronological timeline of their presence (e.g. joined in 200X, peaked in 200Y discussing Z, faded out by 20ZZ).

IMPORTANT: 
- Do NOT use generic pleasantries ("Here is the profile..."). Output ONLY the markdown text.
- Rely strictly on the provided data. Use exact quotes where possible to add flavor.
- This was an edgy, early 2000s forum. Do not censor profanity or edgy humor in your analysis if it reflects their authentic personality.`;

async function main() {
  await client.connect();
  const db = client.db("clockcrew");
  
  // Sort by post count descending so we hit the biggest members first
  // Filter out people with 0 posts and 0 NG footprint to save API calls
  const users = await db.collection("ClockCrewNetUsers")
    .find({ postCount: { $gt: 10 } })
    .sort({ postCount: -1 })
    .toArray();

  console.log(`\n=============================================================`);
  console.log(`Starting generation for ${users.length} eligible users. Processing 15 concurrently...`);
  console.log(`=============================================================\n`);

  const CONCURRENCY = 15;
  let activeWorkers = 0;
  let currentIndex = 0;
  let completedCount = 0;

  await new Promise((resolve) => {
    function processNext() {
      if (currentIndex >= users.length) {
        if (activeWorkers === 0) resolve();
        return;
      }

      const user = users[currentIndex++];
      const userNumber = currentIndex;
      activeWorkers++;

      (async () => {
        const safeUsername = user.username.replace(/[^a-z0-9_-]/gi, "_");
        const filePath = path.join(OUTPUT_DIR, `${safeUsername}.md`);

        if (existsSync(filePath)) {
          console.log(`[${userNumber}/${users.length}] ⏭️  Skipping ${user.username} (Already exists)`);
        } else {
          console.log(`[${userNumber}/${users.length}] ⏳ Generating profile for: ${user.username} (${user.postCount || 0} posts)...`);
          try {
            const dataDump = await generateDataDump(db, user);
            const res = await fetch(`${CONFIG.PRISM_API_URL}/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "google",
                model: "gemini-2.5-pro",
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content: `Here is the data dump for ${user.username}:\n\n${dataDump}` }
                ],
                project: "tools-api",
                username: "system",
                skipConversation: true
              })
            });

            if (!res.ok) throw new Error(`Prism fetch failed: ${res.status}`);

            const responseText = await res.text();
            let profileContent = '';
            for (const line of responseText.split('\\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const chunk = JSON.parse(line.substring(6));
                  if (chunk.type === "chunk" && chunk.content) {
                    profileContent += chunk.content;
                  }
                } catch(e){}
              }
            }

            if (profileContent) {
              writeFileSync(filePath, profileContent.trim());
              console.log(`     ✅ Saved: ${filePath}`);
            } else {
              throw new Error("Received empty content from Prism");
            }
          } catch (err) {
            console.error(`     ❌ Error generating for ${user.username}:`, err.message);
          }
        }
        
        activeWorkers--;
        completedCount++;
        processNext();
      })();
    }

    // Start initial workers
    for (let i = 0; i < CONCURRENCY; i++) {
      processNext();
    }
  });

  await client.close();
  console.log(`\n🎉 All ${completedCount} summaries complete! Output directory: ${OUTPUT_DIR}\n`);
}

main().catch(console.error);
