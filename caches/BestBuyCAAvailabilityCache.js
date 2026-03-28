import { BESTBUY_CA_DEFAULT_SKUS } from "../constants.js";

// ─── In-Memory Store ───────────────────────────────────────────────

const store = {
  /** @type {Object<string, { name: string, brand: string, category: string }>} */
  watchlist: { ...BESTBUY_CA_DEFAULT_SKUS },
  /** @type {Object<string, object>} */
  statuses: {},
  lastCheck: null,
  error: null,
};

// ─── Update Methods ────────────────────────────────────────────────

/**
 * Update availability statuses from a fetcher result set.
 */
export function updateStatuses(results) {
  for (const result of results) {
    store.statuses[result.sku] = result;
  }
  store.lastCheck = new Date();
  store.error = null;
}

/**
 * Record an error from the collector.
 */
export function setAvailabilityError(error) {
  store.error = {
    message: error.message,
    timestamp: new Date(),
  };
}

// ─── Watchlist Management ──────────────────────────────────────────

/**
 * Get the current watchlist (SKU → metadata map).
 */
export function getWatchlist() {
  return {
    count: Object.keys(store.watchlist).length,
    skus: Object.entries(store.watchlist).map(([sku, meta]) => ({
      sku,
      ...meta,
    })),
  };
}

/**
 * Get all watched SKU strings.
 */
export function getWatchedSkus() {
  return Object.keys(store.watchlist);
}

/**
 * Get the full watchlist metadata map.
 */
export function getWatchlistMetadata() {
  return store.watchlist;
}

/**
 * Add SKUs to the watchlist.
 * @param {Array<{ sku: string, name?: string, brand?: string, category?: string }>} items
 */
export function addToWatchlist(items) {
  let added = 0;
  for (const item of items) {
    if (!item.sku) continue;
    const sku = String(item.sku);
    if (!store.watchlist[sku]) added++;
    store.watchlist[sku] = {
      name: item.name || null,
      brand: item.brand || null,
      category: item.category || null,
    };
  }
  return { added, total: Object.keys(store.watchlist).length };
}

/**
 * Remove a SKU from the watchlist and its cached status.
 */
export function removeFromWatchlist(sku) {
  const existed = sku in store.watchlist;
  delete store.watchlist[sku];
  delete store.statuses[sku];
  return { removed: existed, total: Object.keys(store.watchlist).length };
}

// ─── Query Methods ─────────────────────────────────────────────────

/**
 * Get all monitored SKUs with their latest availability.
 */
export function getAll() {
  const results = Object.values(store.statuses);
  return {
    count: results.length,
    lastCheck: store.lastCheck,
    inStockCount: results.filter((r) => r.inStock).length,
    results,
  };
}

/**
 * Get availability for a single SKU.
 */
export function getBySku(sku) {
  return store.statuses[sku] || null;
}

/**
 * Get only in-stock items.
 */
export function getInStock() {
  const results = Object.values(store.statuses).filter((r) => r.inStock);
  return {
    count: results.length,
    lastCheck: store.lastCheck,
    results,
  };
}

/**
 * Get only out-of-stock items.
 */
export function getOutOfStock() {
  const results = Object.values(store.statuses).filter((r) => !r.inStock);
  return {
    count: results.length,
    lastCheck: store.lastCheck,
    results,
  };
}

// ─── Health ────────────────────────────────────────────────────────

export function getAvailabilityHealth() {
  const statusCount = Object.keys(store.statuses).length;
  const inStock = Object.values(store.statuses).filter((r) => r.inStock).length;

  return {
    watchlistSize: Object.keys(store.watchlist).length,
    statusCount,
    inStock,
    outOfStock: statusCount - inStock,
    lastCheck: store.lastCheck,
    error: store.error,
  };
}
