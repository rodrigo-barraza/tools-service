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
import { asyncHandler, toISODate } from "../utilities.js";

const router = Router();

// ─── Stock Quote (on-demand with 1-min TTL cache) ──────────────────

router.get("/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const cached = getCachedQuote(symbol);
  if (cached) {
    return res.json({ symbol, ...cached, cached: true });
  }

  try {
    const quote = await fetchStockQuote(symbol);
    cacheQuote(symbol, quote);
    res.json({ symbol, ...quote, cached: false });
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch quote: ${err.message}` });
  }
});

// ─── Company Profile (on-demand with 24h TTL cache) ────────────────

router.get("/profile/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const cached = getCachedProfile(symbol);
  if (cached) {
    return res.json(cached);
  }

  try {
    const profile = await fetchCompanyProfile(symbol);
    cacheProfile(symbol, profile);
    res.json(profile);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch profile: ${err.message}` });
  }
});

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

router.get("/recommendation/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const cached = getCachedRecommendation(symbol);
  if (cached) {
    return res.json(cached);
  }

  try {
    const data = await fetchRecommendationTrends(symbol);
    cacheRecommendation(symbol, data);
    res.json(data);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to fetch recommendations: ${err.message}` });
  }
});

// ─── Basic Financials (on-demand with 1h TTL cache) ────────────────

router.get("/financials/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const cached = getCachedFinancials(symbol);
  if (cached) {
    return res.json(cached);
  }

  try {
    const data = await fetchBasicFinancials(symbol);
    cacheFinancials(symbol, data);
    res.json(data);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to fetch financials: ${err.message}` });
  }
});

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

export default router;
