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
import { collectIfStale, saveState } from "../services/FreshnessService.js";

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
    const from = now.toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
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

// ─── Start Finance Collectors ──────────────────────────────────────

export function startFinanceCollectors() {
  collectIfStale(
    "Finnhub/News",
    "market_news",
    FINNHUB_NEWS_INTERVAL_MS,
    collectMarketNews,
    updateMarketNews,
  );
  setTimeout(
    () =>
      collectIfStale(
        "Finnhub/Earnings",
        "earnings_calendar",
        FINNHUB_EARNINGS_INTERVAL_MS,
        collectEarnings,
        updateEarnings,
      ),
    2_000,
  );

  setInterval(collectMarketNews, FINNHUB_NEWS_INTERVAL_MS);
  setInterval(collectEarnings, FINNHUB_EARNINGS_INTERVAL_MS);

  console.log("📈 Finance collectors started (Finnhub — on-demand quotes)");
}
