import { asyncHandler } from "@rodrigo-barraza/utilities/node";
import { toISODate } from "@rodrigo-barraza/utilities";
import { Router } from "express";
import {
  getCachedQuote,
  cacheQuote,
  getCachedProfile,
  cacheProfile,
  getMarketNews,
  getEarnings,
  getCachedRecommendation,
  cacheRecommendation,
  getCachedFinancials,
  cacheFinancials,
  getFinanceHealth as getHealth,
} from "../caches/FinnhubCache.js";
import {
  fetchStockQuote,
  fetchCompanyProfile,
  fetchCompanyNews,
  fetchRecommendationTrends,
  fetchBasicFinancials,
} from "../fetchers/finance/FinnhubFetcher.js";
import {
  getSeriesInfo,
  getSeriesObservations,
  searchSeries,
  getKeyIndicators,
} from "../fetchers/finance/FredFetcher.js";
import {  } from "../utilities.js";
const router = Router();
// ─── Stock Quote (on-demand with 1-min TTL cache) ──────────────────
router.get("/quote/:symbol", asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = getCachedQuote(symbol);
  if (cached) {
    res.json({ symbol, ...cached, cached: true });
    return;
  }
  const quote = await fetchStockQuote(symbol);
  cacheQuote(symbol, quote);
  return { symbol, ...quote, cached: false };
}, "Stock quote"));
// ─── Company Profile (on-demand with 24h TTL cache) ────────────────
router.get("/profile/:symbol", asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = getCachedProfile(symbol);
  if (cached) {
    res.json(cached);
    return;
  }
  const profile = await fetchCompanyProfile(symbol);
  cacheProfile(symbol, profile);
  return profile;
}, "Company profile"));
// ─── News (general = cached poll, company-specific = on-demand) ────
router.get("/news", async (req, res) => {
  const symbol = req.query.symbol;
  if (symbol) {
    try {
      const now = new Date();
      const to = toISODate(now);
      const from = toISODate(new Date(now - 7 * 86_400_000));
      const news = await fetchCompanyNews(symbol.toUpperCase(), from, to);
      return res.json({
        symbol: symbol.toUpperCase(),
        count: news.length,
        articles: news.slice(0, 50),
      });
    } catch (err) {
      return res
        .status(502)
        .json({ error: `Failed to fetch company news: ${err.message}` });
    }
  }
  const articles = getMarketNews();
  res.json({ count: articles.length, articles });
});
// ─── Earnings Calendar (cached poll) ───────────────────────────────
router.get("/earnings", (_req, res) => {
  const earnings = getEarnings();
  res.json({ count: earnings.length, earnings });
});
// ─── Analyst Recommendations (on-demand with 1h TTL cache) ─────────
router.get("/recommendation/:symbol", asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = getCachedRecommendation(symbol);
  if (cached) {
    res.json(cached);
    return;
  }
  const data = await fetchRecommendationTrends(symbol);
  cacheRecommendation(symbol, data);
  return data;
}, "Analyst recommendations"));
// ─── Basic Financials (on-demand with 1h TTL cache) ────────────────
router.get("/financials/:symbol", asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = getCachedFinancials(symbol);
  if (cached) {
    res.json(cached);
    return;
  }
  const data = await fetchBasicFinancials(symbol);
  cacheFinancials(symbol, data);
  return data;
}, "Basic financials"));
// ─── Macroeconomics (FRED) ─────────────────────────────────────────
router.get("/macro/indicators", asyncHandler(
  () => getKeyIndicators(),
  "Key indicators fetch",
));
router.get("/macro/search", async (req, res) => {
  const { q, limit, orderBy } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchSeries(q, {
    limit: parseInt(limit, 10) || 10,
    orderBy,
  }));
});
router.get("/macro/series/:seriesId/observations", asyncHandler(
  (req) => {
    const { limit, sortOrder, observationStart, observationEnd } = req.query;
    return getSeriesObservations(req.params.seriesId, {
      limit: parseInt(limit, 10) || 50,
      sortOrder,
      observationStart,
      observationEnd,
    });
  },
  "Series observations fetch",
));
router.get("/macro/series/:seriesId", asyncHandler(
  (req) => getSeriesInfo(req.params.seriesId),
  "Series info fetch",
));
// ─── Health ────────────────────────────────────────────────────────
export function getFinanceHealth() {
  const health = getHealth();
  health.fred = "on-demand";
  return health;
}
// ── Unified Stock Data Dispatcher ──────────────────────────────────
router.get("/stock/data", async (req, res) => {
  const { action, symbol } = req.query;
  if (!action || !symbol) return res.status(400).json({ error: "'action' and 'symbol' are required", actions: ["quote", "profile", "recommendation", "financials"] });
  const pathMap = {
    quote: `/quote/${symbol}`,
    profile: `/profile/${symbol}`,
    recommendation: `/recommendation/${symbol}`,
    financials: `/financials/${symbol}`,
  };
  if (!pathMap[action]) return res.status(400).json({ error: `Unknown action: ${action}`, actions: Object.keys(pathMap) });
  // Internal redirect: re-use existing routes by forwarding the request
  req.url = pathMap[action];
  req.params.symbol = symbol;
  return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
});
// ── Unified Macro Data Dispatcher ──────────────────────────────────
router.get("/macro/data", async (req, res) => {
  const { action, q, seriesId, limit, orderBy, sortOrder, observationStart, observationEnd } = req.query;
  if (!action) return res.status(400).json({ error: "'action' is required", actions: ["indicators", "search", "series", "observations"] });
  const pathMap = {
    indicators: "/macro/indicators",
    search: `/macro/search?q=${q || ""}&limit=${limit || 10}&orderBy=${orderBy || ""}`,
    series: `/macro/series/${seriesId || "GDP"}`,
    observations: `/macro/series/${seriesId || "GDP"}/observations?limit=${limit || 10}&sortOrder=${sortOrder || "desc"}&observationStart=${observationStart || ""}&observationEnd=${observationEnd || ""}`,
  };
  if (!pathMap[action]) return res.status(400).json({ error: `Unknown action: ${action}`, actions: Object.keys(pathMap) });
  req.url = pathMap[action];
  if (seriesId) req.params.seriesId = seriesId;
  return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
});
export default router;
