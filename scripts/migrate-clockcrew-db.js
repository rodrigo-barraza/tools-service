#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Clock Crew — Migration Script
// ═══════════════════════════════════════════════════════════════
//  Copies documents from the old `tools` database collections
//  to the new `clockcrew` database with renamed collections:
//
//    tools.clockcrew_boards  →  clockcrew.ClockCrewNetBoards
//    tools.clockcrew_threads →  clockcrew.ClockCrewNetThreads
//    tools.clockcrew_posts   →  clockcrew.ClockCrewNetPosts
//    tools.clockcrew_users   →  clockcrew.ClockCrewNetUsers
//
//  Usage:
//    node scripts/migrate-clockcrew-db.js
//    node scripts/migrate-clockcrew-db.js --drop-old   # also drop old collections after migration
// ═══════════════════════════════════════════════════════════════

import { MongoClient } from "mongodb";
import CONFIG from "../config.js";

const DROP_OLD = process.argv.includes("--drop-old");

const COLLECTION_MAP = [
  { old: "clockcrew_boards",  new: "ClockCrewNetBoards"  },
  { old: "clockcrew_threads", new: "ClockCrewNetThreads" },
  { old: "clockcrew_posts",   new: "ClockCrewNetPosts"   },
  { old: "clockcrew_users",   new: "ClockCrewNetUsers"   },
];

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🕰️  Clock Crew — Database Migration");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Source DB: tools`);
  console.log(`  Target DB: clockcrew`);
  console.log(`  Drop old:  ${DROP_OLD}`);
  console.log("");

  const client = new MongoClient(CONFIG.MONGODB_URI);
  await client.connect();

  const toolsDb = client.db("tools");
  const clockcrewDb = client.db("clockcrew");

  for (const mapping of COLLECTION_MAP) {
    const srcCol = toolsDb.collection(mapping.old);
    const dstCol = clockcrewDb.collection(mapping.new);

    const srcCount = await srcCol.countDocuments();
    const dstCount = await dstCol.countDocuments();

    console.log(`  📦 ${mapping.old} → ${mapping.new}`);
    console.log(`     Source:      ${srcCount} docs`);
    console.log(`     Destination: ${dstCount} docs (pre-migration)`);

    if (srcCount === 0) {
      console.log(`     ⚠️  Source is empty, skipping.\n`);
      continue;
    }

    if (dstCount > 0) {
      console.log(`     ⚠️  Destination already has data. Performing upsert-style insert...\n`);
    }

    // Stream documents in batches
    const BATCH_SIZE = 1000;
    let migrated = 0;
    let batch = [];

    const cursor = srcCol.find({});

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      // Remove the _id so MongoDB generates a new one (avoids duplicate key on _id)
      // Unless we want to preserve _ids — for data integrity, we do preserve them.
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        try {
          await dstCol.insertMany(batch, { ordered: false });
        } catch (err) {
          // E11000 duplicates are expected if re-running migration
          if (err.code !== 11000 && !err.message?.includes("E11000")) {
            throw err;
          }
        }
        migrated += batch.length;
        process.stdout.write(`     Migrated: ${migrated}/${srcCount}\r`);
        batch = [];
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      try {
        await dstCol.insertMany(batch, { ordered: false });
      } catch (err) {
        if (err.code !== 11000 && !err.message?.includes("E11000")) {
          throw err;
        }
      }
      migrated += batch.length;
    }

    const finalCount = await dstCol.countDocuments();
    console.log(`     ✅ Migrated: ${migrated} docs → ${finalCount} total in destination\n`);

    // Drop old collection if requested
    if (DROP_OLD) {
      await srcCol.drop();
      console.log(`     🗑️  Dropped ${mapping.old} from tools DB\n`);
    }
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🏁 Migration Complete");
  console.log("═══════════════════════════════════════════════════════════");

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
