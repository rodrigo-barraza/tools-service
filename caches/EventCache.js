import { upsertEvents } from "../models/Event.js";
import { EVENT_SOURCES, EVENT_CATEGORIES } from "../constants.js";
import { batchGeocodeEvents } from "../fetchers/event/GeocodingService.js";
import { enrichEventWithMapUrl } from "../utilities.js";

/**
 * In-memory cache for the latest event data from each source.
 * Dynamically initializes entries for all EVENT_SOURCES.
 */

const cache = {};

// Initialize cache for all sources
for (const source of Object.values(EVENT_SOURCES)) {
  cache[source] = {
    events: [],
    lastFetch: null,
    error: null,
  };
}

// Sources that benefit from geocoding (scraped, no native lat/lng)
const GEOCODE_SOURCES = new Set([
  EVENT_SOURCES.CRAIGSLIST,
  EVENT_SOURCES.UBC,
  EVENT_SOURCES.SFU,
  EVENT_SOURCES.CITY_OF_VANCOUVER,
]);

/**
 * Update the cache with freshly fetched events from a source.
 * Enriches scraped events with geocoding and static map URLs.
 * Persists to MongoDB via upsert (deduplication by sourceId + source).
 */
export async function updateEvents(source, events) {
  if (!cache[source]) {
    cache[source] = { events: [], lastFetch: null, error: null };
  }

  // Geocode scraped sources that lack coordinates
  if (GEOCODE_SOURCES.has(source) && events.length > 0) {
    const geocoded = await batchGeocodeEvents(events);
    if (geocoded > 0) {
      console.log(`[Geocoding] 📍 Enriched ${geocoded} ${source} events`);
    }
  }

  // Add static map URLs for all events with coordinates
  events.forEach(enrichEventWithMapUrl);

  cache[source].events = events;
  cache[source].lastFetch = new Date();
  cache[source].error = null;

  const result = await upsertEvents(events);
  return result;
}

/**
 * Restore events from a DB snapshot into the in-memory cache.
 * Memory-only — skips geocoding and DB upserts.
 */
export function restoreEvents(source, events) {
  if (!cache[source]) {
    cache[source] = { events: [], lastFetch: null, error: null };
  }
  cache[source].events = events;
  cache[source].lastFetch = new Date();
  cache[source].error = null;
}

/**
 * Record a fetch error for a source.
 */
export function setError(source, error) {
  if (!cache[source]) {
    cache[source] = { events: [], lastFetch: null, error: null };
  }
  cache[source].error = {
    message: error.message,
    time: new Date(),
  };
}

/**
 * Get all cached events merged from all sources, sorted by date.
 */
export function getLatestEvents() {
  const all = [];
  for (const source of Object.values(EVENT_SOURCES)) {
    if (cache[source]) {
      all.push(...cache[source].events);
    }
  }
  return all.sort(
    (a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0),
  );
}

/**
 * Get a summary of cached events — counts by category, source, and time bucket.
 */
export function getEventSummary() {
  const all = getLatestEvents();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const byCategoryCount = {};
  for (const cat of Object.values(EVENT_CATEGORIES)) {
    byCategoryCount[cat] = 0;
  }

  const bySource = {};
  for (const source of Object.values(EVENT_SOURCES)) {
    bySource[source] = cache[source]?.events.length || 0;
  }

  let todayCount = 0;
  let upcomingCount = 0;

  for (const event of all) {
    // Category counts
    if (event.category && byCategoryCount[event.category] !== undefined) {
      byCategoryCount[event.category]++;
    }

    // Time bucket counts
    const ts = event.startDate?.getTime() ?? 0;
    if (ts >= todayStart.getTime() && ts <= todayEnd.getTime()) {
      todayCount++;
    }
    if (ts > now.getTime()) {
      upcomingCount++;
    }
  }

  const lastFetch = {};
  for (const source of Object.values(EVENT_SOURCES)) {
    lastFetch[source] = cache[source]?.lastFetch || null;
  }

  return {
    total: all.length,
    today: todayCount,
    upcoming: upcomingCount,
    byCategory: byCategoryCount,
    bySource,
    lastFetch,
  };
}

/**
 * Get health info for the /health endpoint.
 */
export function getHealth() {
  const health = {};
  for (const source of Object.values(EVENT_SOURCES)) {
    health[source] = {
      lastFetch: cache[source]?.lastFetch || null,
      error: cache[source]?.error || null,
      eventCount: cache[source]?.events.length || 0,
    };
  }
  return health;
}
