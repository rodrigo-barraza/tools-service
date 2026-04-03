import {
  FINNHUB_NEWS_INTERVAL_MS,
  FINNHUB_EARNINGS_INTERVAL_MS,
} from "../constants.js";
import {
  fetchMarketNews,
  fetchEarningsCalendar,
} from "../fetchers/finance/FinnhubFetcher.js";
import {
  updateMarketNews,
  setNewsError,
  updateEarnings,
  setEarningsError,
} from "../caches/FinnhubCache.js";
import { saveState, startCollectorLoop } from "../services/FreshnessService.js";
import { toISODate } from "../utilities.js";

// ─── News Collector ────────────────────────────────────────────────

async function collectMarketNews() {
  try {
    const articles = await fetchMarketNews("general");
    const sliced = Array.isArray(articles) ? articles.slice(0, 50) : [];
    updateMarketNews(sliced);
    await saveState("market_news", sliced);
    console.log(`[Finnhub/News] ✅ ${sliced.length} articles`);
  } catch (error) {
    setNewsError(error);
    console.error(`[Finnhub/News] ❌ ${error.message}`);
  }
}

// ─── Earnings Calendar Collector ───────────────────────────────────

async function collectEarnings() {
  try {
    const now = new Date();
    const from = toISODate(now);
    const to = toISODate(new Date(now.getTime() + 14 * 86_400_000));
    const result = await fetchEarningsCalendar(from, to);
    const earnings = result?.earningsCalendar || [];
    updateEarnings(earnings);
    await saveState("earnings_calendar", earnings);
    console.log(
      `[Finnhub/Earnings] ✅ ${earnings.length} upcoming (${from} → ${to})`,
    );
  } catch (error) {
    setEarningsError(error);
    console.error(`[Finnhub/Earnings] ❌ ${error.message}`);
  }
}

// ─── Startup Definitions ──────────────────────────────────────────

const STARTUP_TASKS = [
  {
    label: "Finnhub/News",
    collection: "market_news",
    ttl: FINNHUB_NEWS_INTERVAL_MS,
    collectFn: collectMarketNews,
    restoreFn: updateMarketNews,
    delay: 0,
  },
  {
    label: "Finnhub/Earnings",
    collection: "earnings_calendar",
    ttl: FINNHUB_EARNINGS_INTERVAL_MS,
    collectFn: collectEarnings,
    restoreFn: updateEarnings,
    delay: 2_000,
  },
];

// ─── Start Finance Collectors ──────────────────────────────────────

export function startFinanceCollectors() {
  startCollectorLoop(STARTUP_TASKS);
  console.log("📈 Finance collectors started (Finnhub — on-demand quotes)");
}
