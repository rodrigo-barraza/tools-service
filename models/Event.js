import { days as daysToMs } from "@rodrigo-barraza/utilities";
import { getDB } from "../db.js";

let collection = null;

/**
 * Initialize the events collection with required indexes.
 */
export async function setupEventCollection() {
  const db = getDB();
  collection = db.collection("events");

  await collection.createIndex({ sourceId: 1, source: 1 }, { unique: true });
  await collection.createIndex({ startDate: -1 });
  await collection.createIndex({ startDate: 1 });
  await collection.createIndex({ category: 1 });
  await collection.createIndex({ "venue.city": 1 });
  await collection.createIndex({ source: 1 });
  await collection.createIndex(
    { name: "text", "venue.name": "text", "venue.city": "text" },
    { name: "event_text_search" },
  );

  console.log("📅 Event collection indexes ready");
}

/**
 * Bulk upsert events by sourceId + source.
 */
export async function upsertEvents(events) {
  if (!collection || events.length === 0) return { upserted: 0, modified: 0 };

  const operations = events.map((event) => ({
    updateOne: {
      filter: { sourceId: event.sourceId, source: event.source },
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
    console.error("Failed to upsert events:", error.message);
    return { upserted: 0, modified: 0 };
  }
}

/**
 * Get events happening today (local time boundaries).
 */
export async function getEventsToday(timezone) {
  if (!collection) return [];

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = formatter.format(now);
  const startOfDay = new Date(`${todayStr}T00:00:00`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999`);

  return collection
    .find({ startDate: { $gte: startOfDay, $lte: endOfDay } })
    .sort({ startDate: 1 })
    .toArray();
}

/**
 * Get upcoming events (next N days from now).
 */
export async function getEventsUpcoming(days = 30, limit = 200) {
  if (!collection) return [];

  const now = new Date();
  const cutoff = new Date(now.getTime() + daysToMs(days));

  return collection
    .find({ startDate: { $gte: now, $lte: cutoff } })
    .sort({ startDate: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Get past events (last N days).
 */
export async function getEventsPast(days = 30, limit = 200) {
  if (!collection) return [];

  const now = new Date();
  const cutoff = new Date(now.getTime() - daysToMs(days));

  return collection
    .find({ startDate: { $gte: cutoff, $lt: now } })
    .sort({ startDate: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Search events by text query with optional filters.
 */
export async function searchEvents({
  q,
  category,
  city,
  source,
  limit = 100,
} = {}) {
  if (!collection) return [];

  const query = {};

  if (q) query.$text = { $search: q };
  if (category) query.category = category;
  if (city) query["venue.city"] = new RegExp(city, "i");
  if (source) query.source = source;

  if (!source) {
    query.startDate = { $gte: new Date() };
  }

  const cursor = q
    ? collection
        .find(query, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" } })
    : collection.find(query).sort({ startDate: 1 });

  return cursor.limit(limit).toArray();
}

/**
 * Get a single event by source and sourceId.
 */
export async function getEventBySourceId(source, sourceId) {
  if (!collection) return null;
  return collection.findOne({ source, sourceId });
}
