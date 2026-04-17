import { MongoClient } from "mongodb";

// ═══════════════════════════════════════════════════════════════
//  Lupos Discord — MongoDB Connection (separate database)
// ═══════════════════════════════════════════════════════════════
//  Database: lupos
//  Collections:
//    Messages — One doc per Discord message (scraped from servers)
// ═══════════════════════════════════════════════════════════════

let client = null;
let luposDb = null;
let messagesCol = null;

/**
 * Connect to the Lupos database.
 * Uses the same MongoDB host but targets the `lupos` database.
 *
 * @param {string} baseUri - MongoDB connection string (will switch to `lupos` db)
 */
export async function connectLuposDB(baseUri) {
  if (luposDb) return luposDb;

  // Replace the database name in the URI
  const luposUri = baseUri.replace(
    /\/tools\b/,
    "/lupos",
  );

  client = new MongoClient(luposUri);
  await client.connect();
  luposDb = client.db("lupos");
  console.log(`🐺 Connected to Lupos DB: ${luposDb.databaseName}`);
  return luposDb;
}

/**
 * Get the Lupos database instance.
 */
export function getLuposDB() {
  if (!luposDb) throw new Error("Lupos DB not connected — call connectLuposDB() first");
  return luposDb;
}

/**
 * Initialize collections with required indexes.
 * Index creation runs in the background (MongoDB handles large collections asynchronously).
 */
export async function setupLuposCollections() {
  const db = getLuposDB();
  messagesCol = db.collection("Messages");

  // Fire-and-forget index creation — these are additive.
  // If Lupos already created them, MongoDB noops.
  // On 8M+ docs, new indexes may take several minutes to build in background.
  const ensureIndexes = async () => {
    try {
      await messagesCol.createIndex({ id: 1 }, { unique: true, background: true });
      await messagesCol.createIndex({ "author.id": 1, createdTimestamp: -1 }, { background: true });
      await messagesCol.createIndex({ guildId: 1, channelId: 1, createdTimestamp: -1 }, { background: true });
      await messagesCol.createIndex({ guildId: 1, createdTimestamp: -1 }, { background: true });
    } catch (err) {
      console.warn(`🐺 Lupos index creation warning: ${err.message}`);
    }

    try {
      await messagesCol.createIndex(
        { content: "text" },
        { name: "lupos_message_text_search", background: true },
      );
    } catch (err) {
      // Text index may already exist with different fields — non-fatal
      console.warn(`🐺 Lupos text index skipped: ${err.message}`);
    }
  };

  // Don't block startup on index creation
  ensureIndexes().then(() => {
    console.log("🐺 Lupos collections & indexes ready");
  });
}

/**
 * Get the Messages collection reference.
 */
export function getMessagesCollection() {
  if (!messagesCol) {
    const db = getLuposDB();
    messagesCol = db.collection("Messages");
  }
  return messagesCol;
}
