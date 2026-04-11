import { MongoClient } from "mongodb";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import CONFIG from "../config.js";

const client = new MongoClient(CONFIG.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db("clockcrew");
  const collection = db.collection("ClockProfileSummaries");

  // Read existing MD files to import them
  const OUTPUT_DIR = path.join(process.cwd(), "user_summaries");
  const files = readdirSync(OUTPUT_DIR);
  
  for (const file of files) {
    if (file.endsWith(".md")) {
      const username = file.replace(".md", "");
      const content = readFileSync(path.join(OUTPUT_DIR, file), "utf-8");
      
      const doc = {
        username: username,
        usernameLower: username.toLowerCase(),
        summaryMarkdown: content,
        generatedAt: new Date()
      };
      
      await collection.updateOne(
        { usernameLower: username.toLowerCase() },
        { $set: doc },
        { upsert: true }
      );
      console.log(`Inserted ${username} into ClockProfileSummaries`);
    }
  }
  
  // also insert VirusClock since he might have been named virusclock_profile.md
  // or I can rely on the python script to do it.

  await client.close();
}

main().catch(console.error);
