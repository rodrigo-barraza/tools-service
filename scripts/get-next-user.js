import { MongoClient } from "mongodb";
import { readdirSync, existsSync } from "fs";
import path from "path";
import CONFIG from "../config.js";

const OUTPUT_DIR = path.join(process.cwd(), "user_summaries");
const client = new MongoClient(CONFIG.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db("clockcrew");
  
  const users = await db.collection("ClockCrewNetUsers")
    .find({ postCount: { $gt: 10 } })
    .sort({ postCount: -1 })
    .toArray();

  let nextUser = null;
  for (const user of users) {
    const safeUsername = user.username.replace(/[^a-z0-9_-]/gi, "_");
    if (!existsSync(path.join(OUTPUT_DIR, `${safeUsername}.md`)) && user.username !== 'VirusClock') {
      nextUser = user;
      break;
    }
  }

  if (!nextUser) {
    console.log("ALL_DONE");
    process.exit(0);
  }

  // Generate Dump
  let output = `--- BEGIN DUMP FOR: ${nextUser.username} (PostCount: ${nextUser.postCount}) ---\n`;
  output += JSON.stringify(nextUser, null, 2) + "\n\n";

  const posts = await db.collection("ClockCrewNetPosts")
    .find({ author: new RegExp(`^${nextUser.username}$`, "i") })
    .sort({ date: 1 })
    .limit(100) // Sample of 100 for agent context window
    .toArray();
  
  output += `[POSTS SAMPLE]\n`;
  for (const p of posts) {
    let body = (p.body || "").replace(/\n+/g, " ").trim();
    if (body.length > 300) body = body.substring(0, 300) + "...";
    output += `- ${body}\n`;
  }

  const threads = await db.collection("ClockCrewNetThreads")
    .find({ author: new RegExp(`^${nextUser.username}$`, "i") })
    .sort({ date: 1 })
    .limit(20)
    .toArray();
  output += `\n[THREADS SAMPLED]\n` + threads.map(t => t.title).join("\n") + "\n";

  const links = await db.collection("UserProfileLink").find({ ccUserId: nextUser.userId }).toArray();
  for (const link of links) {
    const ng = await db.collection("NewgroundsProfiles").findOne({ usernameLower: link.ngUsernameLower });
    if (ng) {
      output += `\n[NG PROFILE]\n${JSON.stringify({ username: ng.username, blams: ng.blams, saves: ng.saves, fans: ng.fans, url: ng.url })}\n`;
      const movies = await db.collection("NewgroundsMovies").find({ usernameLower: link.ngUsernameLower }).toArray();
      output += `[NG MOVIES]\n${movies.map(m => m.title + " (" + m.score + ")").join(", ")}\n`;
    }
  }

  console.log(output);
  await client.close();
}
main().catch(console.error);
