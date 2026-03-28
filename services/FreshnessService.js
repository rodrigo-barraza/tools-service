import { saveState, loadState } from "../models/CollectorSnapshot.js";

// ═══════════════════════════════════════════════════════════════
//  Freshness Service — Cache-Aside Staleness Check
// ═══════════════════════════════════════════════════════════════
// Each collector stores its latest state in a dedicated MongoDB
// collection. On startup, checks that collection for freshness.
// If fresh → restore from DB. If stale → fetch from API.
// ═══════════════════════════════════════════════════════════════

/**
 * Conditionally execute a collector function only if the data is stale.
 * If data is fresh, restores the in-memory cache from the DB.
 *
 * @param {string} label - Human-readable log label (e.g. "Ticketmaster")
 * @param {string} collection - MongoDB collection name (e.g. "wildfires", "apod")
 * @param {number} ttlMs - Maximum age in milliseconds before data is considered stale
 * @param {Function} collectFn - Async function to fetch from API + update cache + save to DB
 * @param {Function} restoreFn - Function(data) to populate in-memory cache from DB data
 * @returns {Promise<boolean>} Whether the collector ran (true = fetched, false = restored from DB)
 */
export async function collectIfStale(
  label,
  collection,
  ttlMs,
  collectFn,
  restoreFn,
) {
  const state = await loadState(collection);

  if (state) {
    const ageMs = Date.now() - new Date(state.updatedAt).getTime();

    if (ageMs < ttlMs) {
      const ageMinutes = Math.round(ageMs / 60_000);
      const ttlMinutes = Math.round(ttlMs / 60_000);
      restoreFn(state.data);
      console.log(
        `[${label}] ♻️  Restored from DB (${ageMinutes}m old, TTL: ${ttlMinutes}m)`,
      );
      return false;
    }

    const ageMinutes = Math.round(ageMs / 60_000);
    console.log(
      `[${label}] 🔄 Stale data in DB (${ageMinutes}m old) — refreshing`,
    );
  } else {
    console.log(`[${label}] 🆕 No data in DB — initial fetch`);
  }

  await collectFn();
  return true;
}

// Re-export saveState for collectors to call after each fetch
export { saveState };
