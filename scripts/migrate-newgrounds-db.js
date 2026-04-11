#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Newgrounds — Migration Script
// ═══════════════════════════════════════════════════════════════
//  Copies documents from the old `newgrounds` database collections
//  to the `clockcrew` database with renamed collections:
//
//    newgrounds.ng_profiles  →  clockcrew.NewgroundsProfiles
//    newgrounds.ng_fans      →  clockcrew.NewgroundsFans
//    newgrounds.ng_news      →  clockcrew.NewgroundsNews
//    newgrounds.ng_movies    →  clockcrew.NewgroundsMovies
//    newgrounds.ng_games     →  clockcrew.NewgroundsGames
//    newgrounds.ng_audio     →  clockcrew.NewgroundsAudio
//    newgrounds.ng_art       →  clockcrew.NewgroundsArt
//    newgrounds.ng_faves     →  clockcrew.NewgroundsFaves
//    newgrounds.ng_reviews   →  clockcrew.NewgroundsReviews
//    newgrounds.ng_posts     →  clockcrew.NewgroundsPosts
//
//  Usage:
//    node scripts/migrate-newgrounds-db.js
//    node scripts/migrate-newgrounds-db.js --drop-old   # also drop old collections after migration
// ═══════════════════════════════════════════════════════════════

import { MongoClient } from "mongodb";
import CONFIG from "../config.js";

const DROP_OLD = process.argv.includes("--drop-old");

const COLLECTION_MAP = [
  { old: "ng_profiles", new: "NewgroundsProfiles" },
  { old: "ng_fans",     new: "NewgroundsFans"     },
  { old: "ng_news",     new: "NewgroundsNews"     },
  { old: "ng_movies",   new: "NewgroundsMovies"   },
  { old: "ng_games",    new: "NewgroundsGames"    },
  { old: "ng_audio",    new: "NewgroundsAudio"    },
  { old: "ng_art",      new: "NewgroundsArt"      },
  { old: "ng_faves",    new: "NewgroundsFaves"    },
  { old: "ng_reviews",  new: "NewgroundsReviews"  },
  { old: "ng_posts",    new: "NewgroundsPosts"    },
];

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🎮 Newgrounds — Database Migration");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Source DB: newgrounds`);
  console.log(`  Target DB: clockcrew`);
  console.log(`  Drop old:  ${DROP_OLD}`);
  console.log("");

  const client = new MongoClient(CONFIG.MONGODB_URI);
  await client.connect();

  const ngDb = client.db("newgrounds");
  const clockcrewDb = client.db("clockcrew");

  for (const mapping of COLLECTION_MAP) {
    const srcCol = ngDb.collection(mapping.old);
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
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        try {
          await dstCol.insertMany(batch, { ordered: false });
        } catch (err) {
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
      console.log(`     🗑️  Dropped ${mapping.old} from newgrounds DB\n`);
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
