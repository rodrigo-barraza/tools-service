import { upsertEarthquakes } from "../models/Earthquake.js";
import { EARTHQUAKE_MAGNITUDE_SCALE } from "../constants.js";

/**
 * In-memory cache for the latest earthquake feed.
 * Separate from WeatherCache since earthquake data is event-based,
 * not a single rolling snapshot.
 */

const cache = {
  events: [],
  lastFetch: null,
  error: null,
};

/**
 * Update the cache with freshly fetched earthquake events.
 * Persists to MongoDB via upsert (deduplication by USGS ID).
 */
export async function updateEarthquakes(events) {
  cache.events = events;
  cache.lastFetch = new Date();
  cache.error = null;

  const result = await upsertEarthquakes(events);
  return result;
}

/**
 * Restore earthquakes from a DB snapshot into the in-memory cache.
 * Memory-only — no MongoDB upsert.
 */
export function restoreEarthquakes(events) {
  cache.events = events;
  cache.lastFetch = new Date();
  cache.error = null;
}

/**
 * Record a fetch error.
 */
export function setEarthquakeError(error) {
  cache.error = {
    message: error.message,
    time: new Date(),
  };
}

/**
 * Get the latest hourly feed from memory.
 */
export function getLatestEarthquakes() {
  return [...cache.events];
}

/**
 * Get a summary of the latest feed — counts by magnitude bracket + strongest event.
 */
export function getEarthquakeSummary() {
  const counts = {};
  for (const scale of EARTHQUAKE_MAGNITUDE_SCALE) {
    counts[scale.label] = 0;
  }

  let strongest = null;

  for (const event of cache.events) {
    // Classify into magnitude bracket
    const scale = EARTHQUAKE_MAGNITUDE_SCALE.find(
      (s) => event.magnitude >= s.min && event.magnitude < s.max,
    );
    if (scale) {
      counts[scale.label]++;
    }

    // Track strongest
    if (!strongest || (event.magnitude ?? -1) > (strongest.magnitude ?? -1)) {
      strongest = event;
    }
  }

  return {
    total: cache.events.length,
    counts,
    strongest,
    lastFetch: cache.lastFetch,
  };
}

/**
 * Get earthquake health info for the /health endpoint.
 */
export function getEarthquakeHealth() {
  return {
    lastFetch: cache.lastFetch,
    error: cache.error,
    eventCount: cache.events.length,
  };
}
