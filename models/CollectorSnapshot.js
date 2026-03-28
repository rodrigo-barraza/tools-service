import { getDB } from "../db.js";

// ═══════════════════════════════════════════════════════════════
//  Collector State — Per-Collection Persistence
// ═══════════════════════════════════════════════════════════════
// Each data type is stored in its own MongoDB collection
// (e.g., "wildfires", "tides", "apod") as a single document
// representing the latest state. No generic blob store.
// ═══════════════════════════════════════════════════════════════

/**
 * Save the latest collector state to a dedicated collection.
 * Uses a fixed _id so each collection only ever has one "current" document.
 *
 * @param {string} collectionName - MongoDB collection name (e.g. "wildfires", "apod")
 * @param {*} data - The full payload to persist
 */
export async function saveState(collectionName, data) {
  try {
    const db = getDB();
    await db.collection(collectionName).updateOne(
      { _id: "current" },
      { $set: { _id: "current", data, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (error) {
    console.error(
      `[State] ⚠️ Failed to save "${collectionName}": ${error.message}`,
    );
  }
}

/**
 * Load the latest state from a dedicated collection.
 *
 * @param {string} collectionName - MongoDB collection name
 * @returns {Promise<{ data: *, updatedAt: Date } | null>}
 */
export async function loadState(collectionName) {
  try {
    const db = getDB();
    const doc = await db
      .collection(collectionName)
      .findOne({ _id: "current" });
    if (!doc) return null;
    return { data: doc.data, updatedAt: doc.updatedAt };
  } catch (error) {
    console.error(
      `[State] ⚠️ Failed to load "${collectionName}": ${error.message}`,
    );
    return null;
  }
}
