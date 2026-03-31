import { getDB } from "../db.js";

let collection = null;

export async function setupWebcamCollection() {
  const db = getDB();
  if (!db) return;
  
  collection = db.collection("webcams");

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ city: 1 });
  await collection.createIndex({ lastUpdated: -1 });

  console.log("📷 Webcam collection indexes ready");
}

export async function upsertWebcams(webcams) {
  if (!collection || webcams.length === 0) return null;

  const now = new Date();
  const operations = webcams.map((cam) => ({
    updateOne: {
      filter: { id: cam.id },
      update: {
        $set: { ...cam, lastUpdated: now },
        $setOnInsert: { firstSeen: now },
      },
      upsert: true,
    },
  }));

  try {
    const result = await collection.bulkWrite(operations, { ordered: false });
    return result;
  } catch (error) {
    console.error("Failed to upsert webcams:", error.message);
    return null;
  }
}

export async function getWebcamsByCity(city, limit = 100) {
  if (!collection) return [];
  // Exclude mongodb _id from results so it's clean
  return collection.find({ city }, { projection: { _id: 0, lastUpdated: 0, firstSeen: 0 } }).limit(limit).toArray();
}

export async function getWebcamsLastUpdated(city) {
  if (!collection) return null;
  const latest = await collection.find({ city }).sort({ lastUpdated: -1 }).limit(1).toArray();
  return latest.length > 0 ? latest[0].lastUpdated : null;
}
