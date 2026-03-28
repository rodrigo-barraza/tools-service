import {
  GOOGLE_TRENDS_INTERVAL_MS,
  REDDIT_INTERVAL_MS,
  WIKIPEDIA_INTERVAL_MS,
  HACKERNEWS_INTERVAL_MS,
  X_TRENDS_INTERVAL_MS,
  GOOGLE_NEWS_INTERVAL_MS,
  MASTODON_INTERVAL_MS,
  TVMAZE_INTERVAL_MS,
  BLUESKY_INTERVAL_MS,
  GITHUB_TRENDING_INTERVAL_MS,
  PRODUCTHUNT_TREND_INTERVAL_MS,
} from "../constants.js";
import { upsertTrends } from "../models/Trend.js";
import { fetchGoogleTrends } from "../fetchers/trend/GoogleTrendsFetcher.js";
import { fetchRedditTrends } from "../fetchers/trend/RedditFetcher.js";
import { fetchWikipediaTrends } from "../fetchers/trend/WikipediaFetcher.js";
import { fetchHackerNewsTrends } from "../fetchers/trend/HackerNewsFetcher.js";
import { fetchAllXTrends } from "../fetchers/trend/XTrendsFetcher.js";
import { fetchGoogleNews } from "../fetchers/trend/GoogleNewsFetcher.js";
import { fetchMastodonTrends } from "../fetchers/trend/MastodonFetcher.js";
import { fetchTVMazeTrends } from "../fetchers/trend/TVMazeFetcher.js";
import { fetchBlueskyTrends } from "../fetchers/trend/BlueskyFetcher.js";
import { fetchGitHubTrending } from "../fetchers/trend/GitHubTrendingFetcher.js";
import { fetchProductHuntTrends } from "../fetchers/trend/ProductHuntFetcher.js";
import { updateTrends, setTrendError } from "../caches/TrendCache.js";

// ─── Collector Factory ─────────────────────────────────────────────

/**
 * Create a standard trend collector that fetches, caches, and persists.
 * @param {string} label - Log label (e.g. "Google Trends")
 * @param {string} source - Cache source key (e.g. "google-trends")
 * @param {Function} fetchFn - Async function returning trend array
 * @param {string} [noun="trends"] - Noun for log output (e.g. "stories", "repos")
 */
function createTrendCollector(label, source, fetchFn, noun = "trends") {
  return async function () {
    try {
      const trends = await fetchFn();
      updateTrends(source, trends);
      const result = await upsertTrends(trends);
      console.log(
        `[${label}] ✅ ${trends.length} ${noun} | ${result.upserted} new, ${result.modified} updated`,
      );
    } catch (error) {
      setTrendError(source, error);
      console.error(`[${label}] ❌ ${error.message}`);
    }
  };
}

// ─── Collectors ────────────────────────────────────────────────────

const collectGoogleTrends = createTrendCollector(
  "Google Trends",
  "google-trends",
  fetchGoogleTrends,
);
const collectWikipedia = createTrendCollector(
  "Wikipedia",
  "wikipedia",
  fetchWikipediaTrends,
  "articles",
);
const collectHackerNews = createTrendCollector(
  "Hacker News",
  "hackernews",
  fetchHackerNewsTrends,
  "stories",
);
const collectReddit = createTrendCollector(
  "Reddit",
  "reddit",
  fetchRedditTrends,
);
const collectXTrends = createTrendCollector(
  "X",
  "x",
  fetchAllXTrends,
  "trending topics",
);
const collectGoogleNews = createTrendCollector(
  "Google News",
  "google-news",
  fetchGoogleNews,
  "articles",
);
const collectMastodon = createTrendCollector(
  "Mastodon",
  "mastodon",
  fetchMastodonTrends,
  "trending items",
);
const collectTVMaze = createTrendCollector(
  "TVMaze",
  "tvmaze",
  fetchTVMazeTrends,
  "shows",
);
const collectBluesky = createTrendCollector(
  "Bluesky",
  "bluesky",
  fetchBlueskyTrends,
  "trending items",
);
const collectGitHubTrending = createTrendCollector(
  "GitHub Trending",
  "github",
  fetchGitHubTrending,
  "repos",
);
const collectProductHunt = createTrendCollector(
  "Product Hunt",
  "producthunt",
  fetchProductHuntTrends,
  "products",
);

export function startTrendCollectors() {
  collectGoogleTrends();
  setTimeout(collectWikipedia, 3_000);
  setTimeout(collectHackerNews, 6_000);
  setTimeout(collectReddit, 9_000);
  setTimeout(collectXTrends, 12_000);
  setTimeout(collectGoogleNews, 15_000);
  setTimeout(collectMastodon, 18_000);
  setTimeout(collectTVMaze, 21_000);
  setTimeout(collectBluesky, 24_000);
  setTimeout(collectGitHubTrending, 27_000);
  setTimeout(collectProductHunt, 30_000);

  setInterval(collectGoogleTrends, GOOGLE_TRENDS_INTERVAL_MS);
  setInterval(collectWikipedia, WIKIPEDIA_INTERVAL_MS);
  setInterval(collectHackerNews, HACKERNEWS_INTERVAL_MS);
  setInterval(collectReddit, REDDIT_INTERVAL_MS);
  setInterval(collectXTrends, X_TRENDS_INTERVAL_MS);
  setInterval(collectGoogleNews, GOOGLE_NEWS_INTERVAL_MS);
  setInterval(collectMastodon, MASTODON_INTERVAL_MS);
  setInterval(collectTVMaze, TVMAZE_INTERVAL_MS);
  setInterval(collectBluesky, BLUESKY_INTERVAL_MS);
  setInterval(collectGitHubTrending, GITHUB_TRENDING_INTERVAL_MS);
  setInterval(collectProductHunt, PRODUCTHUNT_TREND_INTERVAL_MS);

  console.log("📈 Trend collectors started");
}
