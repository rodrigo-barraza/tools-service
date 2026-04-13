import { TREND_SOURCES } from "../constants.js";

// ─── In-Memory Cache ───────────────────────────────────────────────

const cache = {};

// Initialize cache slots for each source
for (const source of Object.values(TREND_SOURCES)) {
  cache[source] = {
    trends: [],
    lastFetch: null,
    error: null,
  };
}

// ─── Cache Update ──────────────────────────────────────────────────

/**
 * Updates the cache for a given source with fresh trend data.
 * @param {string} source - Source identifier from SOURCES
 * @param {Array} trends - Array of normalized trend objects
 */
export function updateTrends(source, trends) {
  cache[source] = {
    trends,
    lastFetch: new Date().toISOString(),
    error: null,
  };
}

/**
 * Records an error for the given source.
 * @param {string} source - Source identifier
 * @param {Error} error - The error object
 */
export function setTrendError(source, error) {
  if (cache[source]) {
    cache[source].error = {
      message: error.message,
      time: new Date().toISOString(),
    };
  }
}

// ─── Cache Queries ─────────────────────────────────────────────────

/**
 * Returns all cached trends across all sources.
 * @returns {object} { count, sources, trends }
 */
export function getAll() {
  const allTrends = [];
  const sourceSummary = {};

  for (const [source, data] of Object.entries(cache)) {
    allTrends.push(...data.trends);
    sourceSummary[source] = {
      count: data.trends.length,
      lastFetch: data.lastFetch,
    };
  }

  return {
    count: allTrends.length,
    sources: sourceSummary,
    trends: allTrends.sort((a, b) => (b.volume || 0) - (a.volume || 0)),
  };
}

/**
 * Returns cached trends from a specific source.
 * @param {string} source - Source identifier
 * @returns {object} { count, source, lastFetch, trends }
 */
export function getBySource(source) {
  const data = cache[source];
  if (!data) {
    return { count: 0, source, lastFetch: null, trends: [] };
  }
  return {
    count: data.trends.length,
    source,
    lastFetch: data.lastFetch,
    trends: data.trends.sort((a, b) => (b.volume || 0) - (a.volume || 0)),
  };
}

/**
 * Returns cached trends filtered by category.
 * @param {string} category - Category to filter by
 * @returns {object} { count, category, trends }
 */
export function getByCategory(category) {
  const allTrends = [];
  for (const data of Object.values(cache)) {
    allTrends.push(
      ...data.trends.filter(
        (t) =>
          t.category && t.category.toLowerCase() === category.toLowerCase(),
      ),
    );
  }

  return {
    count: allTrends.length,
    category,
    trends: allTrends.sort((a, b) => (b.volume || 0) - (a.volume || 0)),
  };
}

/**
 * Finds cross-source correlated trends — topics appearing in 2+ sources.
 * Uses normalized name matching to find overlapping topics.
 * @returns {object} { count, trends }
 */
export function getCorrelatedTrends() {
  // Build a map of normalizedName → { sources, totalVolume, entries }
  const topicMap = new Map();

  for (const data of Object.values(cache)) {
    for (const trend of data.trends) {
      const key = trend.normalizedName;
      if (!topicMap.has(key)) {
        topicMap.set(key, {
          name: trend.name,
          normalizedName: key,
          sources: new Set(),
          totalVolume: 0,
          entries: [],
        });
      }
      const topic = topicMap.get(key);
      topic.sources.add(trend.source);
      topic.totalVolume += trend.volume || 0;
      topic.entries.push(trend);
    }
  }

  // Filter to topics in 2+ sources
  const correlated = Array.from(topicMap.values())
    .filter((t) => t.sources.size >= 2)
    .map((t) => ({
      name: t.name,
      normalizedName: t.normalizedName,
      sourceCount: t.sources.size,
      sources: Array.from(t.sources),
      totalVolume: t.totalVolume,
      entries: t.entries,
    }))
    .sort(
      (a, b) => b.sourceCount - a.sourceCount || b.totalVolume - a.totalVolume,
    );

  return {
    count: correlated.length,
    trends: correlated,
  };
}

/**
 * Searches cached trends by keyword (case-insensitive).
 * @param {string} query - Search query
 * @returns {object} { count, query, trends }
 */
export function searchTrends(query) {
  const q = query.toLowerCase();
  const allTrends = [];

  for (const data of Object.values(cache)) {
    allTrends.push(
      ...data.trends.filter(
        (t) => t.name.toLowerCase().includes(q) || t.normalizedName.includes(q),
      ),
    );
  }

  return {
    count: allTrends.length,
    query,
    trends: allTrends.sort((a, b) => (b.volume || 0) - (a.volume || 0)),
  };
}

/**
 * Returns health status for all collectors.
 * @returns {object} Per-source health info
 */
export function getHealth() {
  const health = {};
  for (const [source, data] of Object.entries(cache)) {
    health[source] = {
      trendCount: data.trends.length,
      lastFetch: data.lastFetch,
      error: data.error,
    };
  }
  return health;
}
