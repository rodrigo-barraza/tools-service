import { parseIntParam } from "@rodrigo-barraza/utilities-library";
import { Router } from "express";
import { getRecentProducts, searchProducts } from "../models/Product.js";
import {
  getAll,
  getBySource,
  getByCategory,
  getTrending,
  getCategories,
  searchByName,
  getHealth,
} from "../caches/ProductCache.js";
import {
  getAll as getAvailabilityAll,
  getBySku,
  getInStock,
  getOutOfStock,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getAvailabilityHealth,
} from "../caches/BestBuyCAAvailabilityCache.js";
import { fetchBestBuyCAAvailability } from "../fetchers/product/BestBuyCAAvailabilityFetcher.js";
const router = Router();
// ─── Existing Product Routes ───────────────────────────────────────
router.get("/products", (_req, res) => {
  res.json(getAll());
});
router.get("/products/trending", (req, res) => {
  const limit = parseIntParam(req.query.limit, 50);
  res.json(getTrending(limit));
});
router.get("/products/categories", (_req, res) => {
  res.json(getCategories());
});
router.get("/products/category/:category", (req, res) => {
  res.json(getByCategory(req.params.category));
});
router.get("/products/source/:source", (req, res) => {
  res.json(getBySource(req.params.source));
});
router.get("/products/search", (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchByName(query));
});
router.get("/products/recent", async (req, res) => {
  const hours = parseIntParam(req.query.hours, 24);
  const category = req.query.category || null;
  const source = req.query.source || null;
  const limit = parseIntParam(req.query.limit, 50);
  res.json(await getRecentProducts(hours, category, source, limit));
});
router.get("/products/db/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  const limit = parseIntParam(req.query.limit, 50);
  res.json(await searchProducts(query, limit));
});
// ─── Best Buy CA Availability Routes ───────────────────────────────
router.get("/products/availability", (_req, res) => {
  res.json(getAvailabilityAll());
});
router.get("/products/availability/in-stock", (_req, res) => {
  res.json(getInStock());
});
router.get("/products/availability/out-of-stock", (_req, res) => {
  res.json(getOutOfStock());
});
router.get("/products/availability/sku/:sku", (req, res) => {
  const result = getBySku(req.params.sku);
  if (!result) {
    return res
      .status(404)
      .json({ error: `SKU ${req.params.sku} not found in cache` });
  }
  res.json(result);
});
/**
 * On-demand availability check for arbitrary SKUs (not watchlist-dependent).
 * GET /products/availability/check?skus=SKU1,SKU2,SKU3
 */
router.get("/products/availability/check", async (req, res) => {
  const skusParam = req.query.skus;
  if (!skusParam) {
    return res
      .status(400)
      .json({ error: "Query parameter 'skus' is required (comma-separated)" });
  }
  const skus = skusParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!skus.length) {
    return res.status(400).json({ error: "No valid SKUs provided" });
  }
  try {
    const { results, errors } = await fetchBestBuyCAAvailability(skus);
    res.json({
      count: results.length,
      inStockCount: results.filter((r) => r.inStock).length,
      results,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});
// ─── Watchlist Management ──────────────────────────────────────────
router.get("/products/availability/watchlist", (_req, res) => {
  res.json(getWatchlist());
});
/**
 * Add SKUs to the watchlist.
 * POST body: { skus: [{ sku, name?, brand?, category? }] }
 */
router.post("/products/availability/watchlist", (req, res) => {
  const { skus } = req.body || {};
  if (!Array.isArray(skus) || !skus.length) {
    return res.status(400).json({
      error:
        "Request body must contain 'skus' array: [{ sku, name?, brand?, category? }]",
    });
  }
  const result = addToWatchlist(skus);
  res.json({ ...result, watchlist: getWatchlist() });
});
router.delete("/products/availability/watchlist/:sku", (req, res) => {
  const result = removeFromWatchlist(req.params.sku);
  res.json({ ...result, watchlist: getWatchlist() });
});
// ─── Health ────────────────────────────────────────────────────────
export function getProductHealth() {
  return {
    products: getHealth(),
    availability: getAvailabilityHealth(),
  };
}
export default router;
