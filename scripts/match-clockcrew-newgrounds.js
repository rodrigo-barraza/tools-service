#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Clock Crew ↔ Newgrounds — Username Cross-Reference
// ═══════════════════════════════════════════════════════════════
//  Fuzzy-matches ClockCrewNetUsers.username against
//  NewgroundsProfiles.usernameLower to discover linked accounts.
//
//  Matching tiers (in order of confidence):
//    1. Exact (case-insensitive)
//    2. Alphanumeric-only (strip dashes, underscores, spaces)
//    3. Contains — one username is a substring of the other
//
//  Usage:
//    node scripts/match-clockcrew-newgrounds.js
//    node scripts/match-clockcrew-newgrounds.js --json          # output JSON
//    node scripts/match-clockcrew-newgrounds.js --unmatched     # show unmatched users too
// ═══════════════════════════════════════════════════════════════

import { MongoClient } from "mongodb";
import CONFIG from "../config.js";

const JSON_OUTPUT = process.argv.includes("--json");
const SHOW_UNMATCHED = process.argv.includes("--unmatched");

/**
 * Normalize a username to alphanumeric-only lowercase for fuzzy comparison.
 */
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const client = new MongoClient(CONFIG.MONGODB_URI);
  await client.connect();
  const db = client.db("clockcrew");

  // ─── Load both collections ────────────────────────────────────
  const ccUsers = await db
    .collection("ClockCrewNetUsers")
    .find({}, { projection: { userId: 1, username: 1, newgroundsUsername: 1 } })
    .toArray();

  const ngProfiles = await db
    .collection("NewgroundsProfiles")
    .find({}, { projection: { usernameLower: 1, username: 1 } })
    .toArray();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🔗 Clock Crew ↔ Newgrounds — Username Cross-Reference");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  ClockCrew users:    ${ccUsers.length}`);
  console.log(`  Newgrounds profiles: ${ngProfiles.length}`);
  console.log("");

  // ─── Build lookup indexes ─────────────────────────────────────
  // Map normalized → [{ usernameLower, username }]
  const ngExactMap = new Map();   // lowercase → profiles[]
  const ngNormMap = new Map();    // alphanumeric-only → profiles[]

  for (const p of ngProfiles) {
    const lower = p.usernameLower;
    const norm = normalize(p.username);

    if (!ngExactMap.has(lower)) ngExactMap.set(lower, []);
    ngExactMap.get(lower).push(p);

    if (!ngNormMap.has(norm)) ngNormMap.set(norm, []);
    ngNormMap.get(norm).push(p);
  }

  // ─── Match each CC user ───────────────────────────────────────
  const matches = [];
  const unmatched = [];

  for (const cc of ccUsers) {
    const ccLower = cc.username.toLowerCase();
    const ccNorm = normalize(cc.username);
    const found = [];

    // Tier 1: Exact (case-insensitive)
    if (ngExactMap.has(ccLower)) {
      for (const p of ngExactMap.get(ccLower)) {
        found.push({ ng: p.username, tier: "exact" });
      }
    }

    // Tier 1b: If ClockCrew has an explicit newgroundsUsername field, try that too
    if (cc.newgroundsUsername) {
      const ngLower = cc.newgroundsUsername.toLowerCase();
      if (ngExactMap.has(ngLower)) {
        for (const p of ngExactMap.get(ngLower)) {
          const already = found.some((f) => f.ng.toLowerCase() === p.usernameLower);
          if (!already) found.push({ ng: p.username, tier: "explicit-link" });
        }
      }
    }

    // Tier 2: Alphanumeric-only
    if (found.length === 0 && ccNorm.length >= 3) {
      if (ngNormMap.has(ccNorm)) {
        for (const p of ngNormMap.get(ccNorm)) {
          found.push({ ng: p.username, tier: "normalized" });
        }
      }
    }

    // Tier 3: Substring containment (strip "clock" suffix to avoid false positives)
    if (found.length === 0 && ccNorm.length >= 5) {
      const ccCore = ccNorm.replace(/clock$/i, "").replace(/^clock/i, "");
      if (ccCore.length >= 4) {
        for (const p of ngProfiles) {
          const pNorm = normalize(p.username);
          const pCore = pNorm.replace(/clock$/i, "").replace(/^clock/i, "");
          if (pCore.length >= 4) {
            const shorter = Math.min(ccCore.length, pCore.length);
            const longer = Math.max(ccCore.length, pCore.length);
            // Require the shorter to be ≥60% of the longer to avoid noise
            if (shorter / longer >= 0.6 && (pCore.includes(ccCore) || ccCore.includes(pCore))) {
              found.push({ ng: p.username, tier: "contains" });
            }
          }
        }
      }
    }

    if (found.length > 0) {
      matches.push({
        ccUsername: cc.username,
        ccUserId: cc.userId,
        ngLinked: cc.newgroundsUsername || null,
        matches: found,
      });
    } else {
      unmatched.push(cc.username);
    }
  }

  // ─── Persist to UserProfileLink ────────────────────────────────
  const linksCol = db.collection("UserProfileLink");
  const linkDocs = [];
  for (const m of matches) {
    for (const f of m.matches) {
      linkDocs.push({
        ccUserId: m.ccUserId,
        ccUsername: m.ccUsername,
        ngUsernameLower: f.ng.toLowerCase(),
        ngUsername: f.ng,
        matchTier: f.tier,
      });
    }
  }

  if (linkDocs.length > 0) {
    const ops = linkDocs.map((doc) => ({
      updateOne: {
        filter: { ccUserId: doc.ccUserId, ngUsernameLower: doc.ngUsernameLower },
        update: {
          $set: { ...doc, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    }));
    const result = await linksCol.bulkWrite(ops, { ordered: false });
    console.log(`  💾 Persisted to UserProfileLink: ${result.upsertedCount} new, ${result.modifiedCount} updated`);
    console.log("");
  }

  // ─── Output ───────────────────────────────────────────────────
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ matches, unmatched: SHOW_UNMATCHED ? unmatched : undefined }, null, 2));
  } else {
    // Sort by number of matches desc, then by CC username
    matches.sort((a, b) => b.matches.length - a.matches.length || a.ccUsername.localeCompare(b.ccUsername));

    console.log(`  ✅ Matched: ${matches.length} Clock Crew users`);
    console.log(`  ❌ Unmatched: ${unmatched.length} Clock Crew users`);
    console.log("");

    // Group by tier for summary
    const tierCounts = {};
    for (const m of matches) {
      for (const f of m.matches) {
        tierCounts[f.tier] = (tierCounts[f.tier] || 0) + 1;
      }
    }
    console.log("  Match tiers:");
    for (const [tier, count] of Object.entries(tierCounts)) {
      console.log(`    ${tier}: ${count}`);
    }
    console.log("");

    console.log("───────────────────────────────────────────────────────────");
    console.log("  CC Username               │ NG Username               │ Tier");
    console.log("───────────────────────────────────────────────────────────");

    for (const m of matches) {
      for (const f of m.matches) {
        const cc = m.ccUsername.padEnd(25);
        const ng = f.ng.padEnd(25);
        const tier = f.tier;
        console.log(`  ${cc}  │ ${ng}  │ ${tier}`);
      }
    }

    if (SHOW_UNMATCHED && unmatched.length > 0) {
      console.log("");
      console.log("───────────────────────────────────────────────────────────");
      console.log("  Unmatched Clock Crew Users:");
      console.log("───────────────────────────────────────────────────────────");
      for (const u of unmatched.sort()) {
        console.log(`  ${u}`);
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
