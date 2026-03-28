import { insertSnapshots } from "../models/CommoditySnapshot.js";

/**
 * In-memory cache for the latest commodity quotes.
 * Follows the Nimbus cache pattern — update/get/health/error.
 */

const cache = {
  commodities: [],
  lastFetch: null,
  error: null,
};

// ─── Setters ───────────────────────────────────────────────────────

/**
 * Update the cache with freshly fetched commodity quotes.
 * Persists to MongoDB as timestamped snapshots.
 */
export async function updateCommodities(quotes) {
  cache.commodities = quotes;
  cache.lastFetch = new Date();
  cache.error = null;

  const result = await insertSnapshots(quotes);
  return result;
}

/**
 * Restore commodities from a DB snapshot into the in-memory cache.
 * Memory-only — no MongoDB snapshot insertion.
 */
export function restoreCommodities(quotes) {
  cache.commodities = quotes;
  cache.lastFetch = new Date();
  cache.error = null;
}

/**
 * Record a fetch error.
 */
export function setCommodityError(error) {
  cache.error = {
    message: error.message,
    time: new Date(),
  };
}

// ─── Getters ───────────────────────────────────────────────────────

/**
 * Get all latest commodity quotes.
 */
export function getAllCommodities() {
  return [...cache.commodities];
}

/**
 * Get commodities filtered by category.
 */
export function getCommoditiesByCategory(category) {
  return cache.commodities.filter((c) => c.category === category);
}

/**
 * Get a single commodity by ticker symbol.
 */
export function getCommodityByTicker(ticker) {
  return cache.commodities.find(
    (c) => c.ticker.toUpperCase() === ticker.toUpperCase(),
  );
}

/**
 * Get a market overview summary — totals, top gainers, top losers, by category.
 */
export function getCommoditySummary() {
  const commodities = cache.commodities;

  if (!commodities.length) {
    return { total: 0, lastFetch: cache.lastFetch };
  }

  // Sort by changePercent for gainers/losers
  const withChange = commodities.filter((c) => c.changePercent != null);
  const sorted = [...withChange].sort(
    (a, b) => b.changePercent - a.changePercent,
  );

  const gainers = sorted.slice(0, 5).map(summarize);
  const losers = sorted.slice(-5).reverse().map(summarize);

  // Group by category
  const byCategory = {};
  for (const c of commodities) {
    if (!byCategory[c.category]) {
      byCategory[c.category] = [];
    }
    byCategory[c.category].push(summarize(c));
  }

  return {
    total: commodities.length,
    lastFetch: cache.lastFetch,
    gainers,
    losers,
    byCategory,
  };
}

/**
 * Get commodity health info for the /health endpoint.
 */
export function getCommodityHealth() {
  return {
    lastFetch: cache.lastFetch,
    error: cache.error,
    tickerCount: cache.commodities.length,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function summarize(c) {
  return {
    ticker: c.ticker,
    name: c.name,
    price: c.price,
    change: c.change,
    changePercent: c.changePercent,
    unit: c.unit,
  };
}
