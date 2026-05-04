import { hours as hoursToMs } from "@rodrigo-barraza/utilities";
import { getDB } from "../db.js";

let collection = null;

/**
 * Initialize the earthquakes collection with required indexes.
 * Called once during startup after MongoDB connection is established.
 */
export async function setupEarthquakeCollection() {
  const db = getDB();
  if (!db) throw new Error("Database not connected");

  collection = db.collection("earthquakes");

  await collection.createIndex({ usgsId: 1 }, { unique: true });
  await collection.createIndex({ time: -1 });
  await collection.createIndex({ magnitude: -1 });

  console.log("🌍 Earthquake collection indexes ready");
}

/**
 * Bulk upsert earthquake events by USGS ID.
 * Updates existing events (e.g. revised magnitude) and inserts new ones.
 */
export async function upsertEarthquakes(events) {
  if (!collection || events.length === 0) return;

  const operations = events.map((event) => ({
    updateOne: {
      filter: { usgsId: event.usgsId },
      update: {
        $set: { ...event, lastSeen: new Date() },
        $setOnInsert: { firstSeen: new Date() },
      },
      upsert: true,
    },
  }));

  try {
    const result = await collection.bulkWrite(operations, { ordered: false });
    return {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    };
  } catch (error) {
    console.error("Failed to upsert earthquakes:", error.message);
    return { upserted: 0, modified: 0 };
  }
}

/**
 * Query recent earthquakes from the database.
 * @param {number} hours - How many hours back to look (default 24)
 * @param {number|null} minMagnitude - Minimum magnitude filter (optional)
 * @param {number} limit - Max results (default 100)
 */
export async function getRecentEarthquakes(
  hours = 24,
  minMagnitude = null,
  limit = 100,
) {
  if (!collection) return [];

  const cutoff = new Date(Date.now() - hoursToMs(hours));
  const query = { time: { $gte: cutoff } };

  if (minMagnitude !== null) {
    query.magnitude = { $gte: minMagnitude };
  }

  return collection.find(query).sort({ time: -1 }).limit(limit).toArray();
}

/**
 * Get a single earthquake event by its USGS ID.
 */
export async function getEarthquakeById(usgsId) {
  if (!collection) return null;
  return collection.findOne({ usgsId });
}
