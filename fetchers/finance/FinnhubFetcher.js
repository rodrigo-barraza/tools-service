import CONFIG from "../../config.js";
import { FINNHUB_BASE_URL } from "../../constants.js";
import rateLimiter from "../../services/RateLimiterService.js";

/**
 * Finnhub REST API fetcher.
 * All calls use the X-Finnhub-Token header for auth.
 * Sequential batch calls include a small delay to respect 60 calls/min rate limit.
 */

const HEADERS = () => ({
  "X-Finnhub-Token": CONFIG.FINNHUB_API_KEY,
});

// ─── Helpers ───────────────────────────────────────────────────────

async function get(path) {
  const url = `${FINNHUB_BASE_URL}${path}`;
  const res = await fetch(url, { headers: HEADERS() });
  if (!res.ok) {
    throw new Error(`Finnhub ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Rate limiting handled by RateLimiterService

// ─── Quote ─────────────────────────────────────────────────────────

/**
 * Fetch a real-time quote for a single symbol.
 * Returns { c, d, dp, h, l, o, pc, t } where:
 *   c  = current price
 *   d  = change
 *   dp = percent change
 *   h  = day high
 *   l  = day low
 *   o  = open
 *   pc = previous close
 *   t  = timestamp
 */
export async function fetchStockQuote(symbol) {
  return get(`/quote?symbol=${encodeURIComponent(symbol)}`);
}

/**
 * Fetch quotes for multiple symbols sequentially with pacing.
 * Returns an array of { symbol, ...quoteData }.
 */
export async function fetchStockQuotes(symbols) {
  const results = [];
  for (let i = 0; i < symbols.length; i++) {
    try {
      const quote = await fetchStockQuote(symbols[i]);
      results.push({ symbol: symbols[i], ...quote });
    } catch (err) {
      console.warn(
        `[FinnhubFetcher] ⚠️ Quote failed for ${symbols[i]}: ${err.message}`,
      );
    }
    // Pace requests via centralized rate limiter
    if (i < symbols.length - 1) {
      await rateLimiter.wait("FINNHUB");
    }
  }
  return results;
}

// ─── Company Profile ───────────────────────────────────────────────

/**
 * Fetch company profile (name, logo, sector, market cap, etc.).
 */
export async function fetchCompanyProfile(symbol) {
  return get(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`);
}

// ─── News ──────────────────────────────────────────────────────────

/**
 * Fetch general market news.
 * @param {string} category - "general", "forex", "crypto", "merger" (default: "general")
 */
export async function fetchMarketNews(category = "general") {
  return get(`/news?category=${encodeURIComponent(category)}`);
}

/**
 * Fetch company-specific news.
 * @param {string} symbol - Stock symbol
 * @param {string} from - Start date YYYY-MM-DD
 * @param {string} to   - End date YYYY-MM-DD
 */
export async function fetchCompanyNews(symbol, from, to) {
  return get(
    `/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`,
  );
}

// ─── Earnings ──────────────────────────────────────────────────────

/**
 * Fetch earnings calendar.
 * @param {string} from - Start date YYYY-MM-DD
 * @param {string} to   - End date YYYY-MM-DD
 */
export async function fetchEarningsCalendar(from, to) {
  return get(`/calendar/earnings?from=${from}&to=${to}`);
}

// ─── Analyst Data ──────────────────────────────────────────────────

/**
 * Fetch analyst recommendation trends for a symbol.
 */
export async function fetchRecommendationTrends(symbol) {
  return get(`/stock/recommendation?symbol=${encodeURIComponent(symbol)}`);
}

/**
 * Fetch basic financial metrics (PE, EPS, 52w high/low, beta, etc.).
 */
export async function fetchBasicFinancials(symbol) {
  return get(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`);
}
