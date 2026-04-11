import { MongoClient } from "mongodb";
import CONFIG from "../config.js";

const client = new MongoClient(CONFIG.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db("clockcrew");
  
  // Find users with > 10 posts, sorted descending
  const users = await db.collection("ClockCrewNetUsers")
    .find({ postCount: { $gt: 10 } })
    .sort({ postCount: -1 })
    .toArray();

  const summaries = await db.collection("ClockProfileSummaries")
    .find({})
    .project({ usernameLower: 1 })
    .toArray();
  const processedSet = new Set(summaries.map(s => s.usernameLower));

  let batchedCount = 0;
  for (const user of users) {
    if (processedSet.has(user.username.toLowerCase())) continue;

    batchedCount++;
    // Generate Dump
    let output = `\n════════════════════════════════════════════════════════════════\n`;
    output += `USER DUMP: ${user.username} (PostCount: ${user.postCount})\n`;
    output += `════════════════════════════════════════════════════════════════\n\n`;
    output += JSON.stringify(user, null, 2) + "\n\n";

    const posts = await db.collection("ClockCrewNetPosts")
      .find({ author: new RegExp(`^${user.username}$`, "i") })
      .sort({ date: 1 })
      .limit(60) // Sample of 60 for brevity
      .toArray();
    
    output += `[POSTS SAMPLE]\n`;
    for (const p of posts) {
      let body = (p.body || "").replace(/\n+/g, " ").trim();
      if (body.length > 200) body = body.substring(0, 200) + "...";
      output += `- ${body}\n`;
    }

    const threads = await db.collection("ClockCrewNetThreads")
      .find({ author: new RegExp(`^${user.username}$`, "i") })
      .sort({ date: 1 })
      .limit(10)
      .toArray();
    output += `\n[THREADS SAMPLED]\n` + threads.map(t => t.title).join("\n") + "\n";

    const links = await db.collection("UserProfileLink").find({ ccUserId: user.userId }).toArray();
    for (const link of links) {
      const ng = await db.collection("NewgroundsProfiles").findOne({ usernameLower: link.ngUsernameLower });
      if (ng) {
        output += `\n[NG PROFILE]\n${JSON.stringify({ username: ng.username, blams: ng.blams, saves: ng.saves, fans: ng.fans, url: ng.url })}\n`;
        const movies = await db.collection("NewgroundsMovies").find({ usernameLower: link.ngUsernameLower }).toArray();
        if(movies.length > 0) output += `[NG MOVIES]\n${movies.map(m => m.title + " (" + m.score + ")").join(", ")}\n`;
      }
    }
    
    console.log(output);

    if (batchedCount >= 2) break;
  }

  if (batchedCount === 0) {
    console.log("ALL_DONE");
  }
  await client.close();
}
main().catch(console.error);
