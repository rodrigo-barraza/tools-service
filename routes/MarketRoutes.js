import { Router } from "express";
import { getHistory } from "../models/CommoditySnapshot.js";
import {
  getAllCommodities,
  getCommoditiesByCategory,
  getCommodityByTicker,
  getCommoditySummary,
  getCommodityHealth,
} from "../caches/CommodityCache.js";
import { ASSET_CATEGORIES } from "../constants.js";
import { parseIntParam } from "../utilities.js";

const router = Router();

router.get("/commodities", (_req, res) => {
  res.json(getAllCommodities());
});

router.get("/commodities/summary", (_req, res) => {
  res.json(getCommoditySummary());
});

router.get("/commodities/categories", (_req, res) => {
  res.json(Object.values(ASSET_CATEGORIES));
});

router.get("/commodities/category/:category", (req, res) => {
  const category = req.params.category.toLowerCase();
  const valid = Object.values(ASSET_CATEGORIES);
  if (!valid.includes(category)) {
    return res.status(400).json({
      error: `Invalid category. Valid: ${valid.join(", ")}`,
    });
  }
  res.json(getCommoditiesByCategory(category));
});

router.get("/commodities/ticker/:ticker", (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const commodity = getCommodityByTicker(ticker);
  if (!commodity) {
    return res.status(404).json({ error: `Ticker ${ticker} not found` });
  }
  res.json(commodity);
});

router.get("/commodities/history/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const hours = parseIntParam(req.query.hours, 24);
  const history = await getHistory(ticker, hours);
  res.json({ ticker, hours, count: history.length, snapshots: history });
});

export function getMarketHealth() {
  return { commodities: getCommodityHealth() };
}

export default router;
