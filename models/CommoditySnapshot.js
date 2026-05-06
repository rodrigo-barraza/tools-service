import { hours as hoursToMs } from "@rodrigo-barraza/utilities-library";
import { getDB } from "../db.js";
import { SNAPSHOT_TTL_SECONDS } from "../constants.js";

/**
 * Set up the commodity_snapshots collection with a TTL index.
 */
export async function setupCommodityCollection() {
  const db = getDB();
  const collection = db.collection("commodity_snapshots");

  await collection.createIndex(
    { fetchedAt: 1 },
    { expireAfterSeconds: SNAPSHOT_TTL_SECONDS },
  );
  await collection.createIndex({ ticker: 1, fetchedAt: -1 });

  console.log("💰 commodity_snapshots collection ready");
}

/**
 * Insert a batch of commodity snapshots.
 */
export async function insertSnapshots(quotes) {
  if (!quotes.length) return;

  const db = getDB();
  const collection = db.collection("commodity_snapshots");
  const docs = quotes.map((q) => ({
    ...q,
    fetchedAt: new Date(q.fetchedAt),
  }));

  const result = await collection.insertMany(docs);
  return { inserted: result.insertedCount };
}

/**
 * Get historical price data for a specific ticker.
 */
export async function getHistory(ticker, hours = 24) {
  const db = getDB();
  const collection = db.collection("commodity_snapshots");
  const since = new Date(Date.now() - hoursToMs(hours));

  return collection
    .find({ ticker, fetchedAt: { $gte: since } })
    .sort({ fetchedAt: -1 })
    .toArray();
}
