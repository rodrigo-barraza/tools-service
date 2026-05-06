import { hours as hoursToMs } from "@rodrigo-barraza/utilities-library";
import { getDB } from "../db.js";

/**
 * Sets up the trends collection with indexes.
 */
export async function setupTrendCollection() {
  const db = getDB();
  const collection = db.collection("trends");
  await collection.createIndex({ normalizedName: 1, source: 1 });
  await collection.createIndex({ lastSeen: -1 });
  await collection.createIndex({ category: 1 });
  await collection.createIndex({ source: 1 });
  await collection.createIndex({ volume: -1 });
  console.log("📈 Trend collection indexes ready");
}

/**
 * Upserts an array of trend objects into the database.
 */
export async function upsertTrends(trends) {
  if (!trends.length) return { upserted: 0, modified: 0 };

  const db = getDB();
  const collection = db.collection("trends");
  const now = new Date();

  const bulkOps = trends.map((trend) => ({
    updateOne: {
      filter: {
        normalizedName: trend.normalizedName,
        source: trend.source,
      },
      update: {
        $set: {
          name: trend.name,
          normalizedName: trend.normalizedName,
          source: trend.source,
          category: trend.category || null,
          volume: trend.volume || 0,
          url: trend.url || null,
          context: trend.context || {},
          lastSeen: now,
        },
        $setOnInsert: { firstSeen: now },
        $push: {
          appearances: {
            $each: [{ timestamp: now, volume: trend.volume || 0 }],
            $slice: -100,
          },
        },
      },
      upsert: true,
    },
  }));

  const result = await collection.bulkWrite(bulkOps, { ordered: false });
  return {
    upserted: result.upsertedCount || 0,
    modified: result.modifiedCount || 0,
  };
}

/**
 * Gets recent trends from the database.
 */
export async function getRecentTrends(
  hours = 24,
  category = null,
  source = null,
  limit = 50,
) {
  const db = getDB();
  const collection = db.collection("trends");
  const since = new Date(Date.now() - hoursToMs(hours));

  const filter = { lastSeen: { $gte: since } };
  if (category) filter.category = category;
  if (source) filter.source = source;

  return collection.find(filter).sort({ volume: -1 }).limit(limit).toArray();
}

/**
 * Searches trends in the database by keyword.
 */
export async function searchTrendsDB(query, limit = 50) {
  const db = getDB();
  const collection = db.collection("trends");
  return collection
    .find({ name: { $regex: query, $options: "i" } })
    .sort({ lastSeen: -1, volume: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Gets top trends aggregated across all sources.
 */
export async function getTopTrends(hours = 24, limit = 20) {
  const db = getDB();
  const collection = db.collection("trends");
  const since = new Date(Date.now() - hoursToMs(hours));

  return collection
    .aggregate([
      { $match: { lastSeen: { $gte: since } } },
      {
        $group: {
          _id: "$normalizedName",
          name: { $first: "$name" },
          sources: { $addToSet: "$source" },
          totalVolume: { $sum: "$volume" },
          category: { $first: "$category" },
          lastSeen: { $max: "$lastSeen" },
          firstSeen: { $min: "$firstSeen" },
          urls: { $push: "$url" },
        },
      },
      {
        $project: {
          _id: 0,
          normalizedName: "$_id",
          name: 1,
          sources: 1,
          sourceCount: { $size: "$sources" },
          totalVolume: 1,
          category: 1,
          lastSeen: 1,
          firstSeen: 1,
          urls: { $slice: ["$urls", 3] },
        },
      },
      { $sort: { sourceCount: -1, totalVolume: -1 } },
      { $limit: limit },
    ])
    .toArray();
}
