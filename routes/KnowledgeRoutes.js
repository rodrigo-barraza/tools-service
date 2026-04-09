import { Router } from "express";
import { fetchDefinition } from "../fetchers/knowledge/DictionaryFetcher.js";
import {
  searchBooks,
  getBookDetails,
  getAuthorInfo,
} from "../fetchers/knowledge/OpenLibraryFetcher.js";
import {
  searchCountries,
  getCountryByCode,
} from "../fetchers/knowledge/RestCountriesFetcher.js";
import { searchPapers } from "../fetchers/knowledge/ArxivFetcher.js";
import {
  getArticleSummary,
  getOnThisDay,
} from "../fetchers/knowledge/WikipediaSummaryFetcher.js";
import {
  searchAnime,
  getTopAnime,
  getCurrentSeasonAnime,
  getAnimeDetails,
} from "../fetchers/knowledge/JikanFetcher.js";
import {
  searchMovies,
  getMovieDetails,
  getMovieCredits,
  getTrendingMovies,
  discoverMovies,
  getMovieGenres,
  searchTvShows,
  getTvShowDetails,
  getTvShowCredits,
  getTvSeasonDetails,
  getTrendingTvShows,
  discoverTvShows,
  getTvGenres,
} from "../fetchers/knowledge/TMDbFetcher.js";
import {
  searchElements,
  getElementBySymbol,
  rankElementsByProperty,
  getElementCategories,
} from "../fetchers/knowledge/PeriodicTableFetcher.js";
import {
  getCountryIndicators,
  rankCountriesByIndicator,
  compareCountries,
  getAvailableIndicators,
} from "../fetchers/knowledge/WorldBankFetcher.js";
import {
  searchExoplanets,
  getExoplanetByName,
  rankExoplanets,
  getDiscoveryStats,
  getHabitableZonePlanets,
} from "../fetchers/knowledge/ExoplanetFetcher.js";
import { getYouTubeVideoInfo } from "../fetchers/knowledge/YouTubeFetcher.js";
import { getGitHubRepo } from "../fetchers/web/GitHubFetcher.js";
import { getRedditThread } from "../fetchers/web/RedditFetcher.js";
import { getNpmPackage } from "../fetchers/web/NpmFetcher.js";
import { getPyPiPackage } from "../fetchers/web/PyPiFetcher.js";
import { readPdfUrl } from "../fetchers/web/PdfFetcher.js";
import { readRssFeed } from "../fetchers/web/RssFetcher.js";
import { getTwitterPost } from "../fetchers/web/TwitterFetcher.js";
import { getHackerNewsThread } from "../fetchers/web/HackerNewsFetcher.js";
import { getStackOverflowQuestion } from "../fetchers/web/StackOverflowFetcher.js";
import { getWebContent } from "../fetchers/web/WebContentFetcher.js";
import { getPackageInfo } from "../fetchers/web/PackageFetcher.js";
import { parseIntParam, asyncHandler } from "../utilities.js";

const router = Router();

// ─── Dictionary ────────────────────────────────────────────────────

router.get("/dictionary/:word", asyncHandler(
  (req) => fetchDefinition(req.params.word),
  "Dictionary lookup",
));

// ─── Books ─────────────────────────────────────────────────────────

router.get("/books/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchBooks(q, parseIntParam(limit, 10)));
});

router.get("/books/work/:workKey", asyncHandler(
  (req) => getBookDetails(req.params.workKey),
  "Book details",
));

router.get("/books/author/:authorKey", asyncHandler(
  (req) => getAuthorInfo(req.params.authorKey),
  "Author info",
));

// ─── Countries ─────────────────────────────────────────────────────

router.get("/countries/search/:name", asyncHandler(
  (req) => searchCountries(req.params.name),
  "Country search",
));

router.get("/countries/code/:code", asyncHandler(
  (req) => getCountryByCode(req.params.code),
  "Country lookup",
));

// ─── Papers (arXiv) ────────────────────────────────────────────────

router.get("/papers/search", async (req, res) => {
  const { q, category, limit, sortBy } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchPapers(q, {
    category,
    limit: parseIntParam(limit, 10),
    sortBy: sortBy || "relevance",
  }));
});

// ─── Wikipedia Summaries ───────────────────────────────────────────

router.get("/wikipedia/summary/:title", asyncHandler(
  (req) => getArticleSummary(req.params.title),
  "Wikipedia summary",
));

router.get("/wikipedia/onthisday", asyncHandler(
  (req) => getOnThisDay(
    req.query.type || "selected",
    req.query.month ? parseInt(req.query.month, 10) : undefined,
    req.query.day ? parseInt(req.query.day, 10) : undefined,
  ),
  "On This Day",
));

// ─── Anime (Jikan / MyAnimeList) ───────────────────────────────────

router.get("/anime/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchAnime(q, parseIntParam(limit, 10)));
});

router.get("/anime/top", asyncHandler(
  (req) => getTopAnime(parseIntParam(req.query.limit, 10)),
  "Top anime fetch",
));

router.get("/anime/season/now", asyncHandler(
  (req) => getCurrentSeasonAnime(parseIntParam(req.query.limit, 10)),
  "Seasonal anime fetch",
));

router.get("/anime/:id", asyncHandler(
  (req) => getAnimeDetails(req.params.id),
  "Anime details",
));

// ─── Movies (TMDb) ─────────────────────────────────────────────────

router.get("/movies/search", async (req, res) => {
  const { q, page, year } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchMovies(q, {
    page: parseIntParam(page, 1),
    year: year ? parseInt(year, 10) : undefined,
  }));
});

router.get("/movies/trending", asyncHandler(
  (req) => getTrendingMovies(
    req.query.timeWindow || "day",
    parseIntParam(req.query.limit, 10),
  ),
  "Trending movies",
));

router.get("/movies/discover", asyncHandler(
  (req) => {
    const { genreId, year, sortBy, page, minVoteAverage, minVoteCount } = req.query;
    return discoverMovies({
      genreId: genreId ? parseInt(genreId, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      sortBy,
      page: parseIntParam(page, 1),
      minVoteAverage: minVoteAverage ? parseFloat(minVoteAverage) : undefined,
      minVoteCount: minVoteCount ? parseInt(minVoteCount, 10) : undefined,
    });
  },
  "Discover movies",
));

router.get("/movies/genres", asyncHandler(
  () => getMovieGenres(),
  "Movie genres",
));

router.get("/movies/:id/credits", asyncHandler(
  (req) => getMovieCredits(req.params.id),
  "Movie credits",
));

router.get("/movies/:id", asyncHandler(
  (req) => getMovieDetails(req.params.id),
  "Movie details",
));

// ─── TV Series (TMDb) ──────────────────────────────────────────────

router.get("/tv/search", async (req, res) => {
  const { q, page, firstAirDateYear } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchTvShows(q, {
    page: parseIntParam(page, 1),
    firstAirDateYear: firstAirDateYear
      ? parseInt(firstAirDateYear, 10)
      : undefined,
  }));
});

router.get("/tv/trending", asyncHandler(
  (req) => getTrendingTvShows(
    req.query.timeWindow || "day",
    parseIntParam(req.query.limit, 10),
  ),
  "Trending TV shows",
));

router.get("/tv/discover", asyncHandler(
  (req) => {
    const { genreId, firstAirDateYear, sortBy, page, minVoteAverage, minVoteCount } = req.query;
    return discoverTvShows({
      genreId: genreId ? parseInt(genreId, 10) : undefined,
      firstAirDateYear: firstAirDateYear
        ? parseInt(firstAirDateYear, 10)
        : undefined,
      sortBy,
      page: parseIntParam(page, 1),
      minVoteAverage: minVoteAverage ? parseFloat(minVoteAverage) : undefined,
      minVoteCount: minVoteCount ? parseInt(minVoteCount, 10) : undefined,
    });
  },
  "Discover TV shows",
));

router.get("/tv/genres", asyncHandler(
  () => getTvGenres(),
  "TV genres",
));

router.get("/tv/:id/credits", asyncHandler(
  (req) => getTvShowCredits(req.params.id),
  "TV credits",
));

router.get("/tv/:id/season/:seasonNumber", asyncHandler(
  (req) => getTvSeasonDetails(
    req.params.id,
    parseInt(req.params.seasonNumber, 10),
  ),
  "TV season details",
));

router.get("/tv/:id", asyncHandler(
  (req) => getTvShowDetails(req.params.id),
  "TV show details",
));

// ─── Periodic Table (in-memory) ────────────────────────────────────

router.get("/elements/search", (req, res) => {
  const { q, limit, category, block } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchElements(q, {
    limit: parseIntParam(limit, 10),
    category,
    block,
  }));
});

router.get("/elements/rank", (req, res) => {
  const { property, limit, order, category, block } = req.query;
  if (!property) {
    return res
      .status(400)
      .json({ error: "Query parameter 'property' is required" });
  }
  const result = rankElementsByProperty(property, {
    limit: parseIntParam(limit, 10),
    order: order || "desc",
    category,
    block,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/elements/categories", asyncHandler(
  () => getElementCategories(),
  "Element categories",
  500,
));

router.get("/elements/:symbol", (req, res) => {
  const result = getElementBySymbol(req.params.symbol);
  if (!result) {
    return res
      .status(404)
      .json({ error: `Element not found: ${req.params.symbol}` });
  }
  res.json(result);
});

// ─── World Bank Indicators (in-memory) ─────────────────────────────

router.get("/indicators/country/:code", (req, res) => {
  const result = getCountryIndicators(req.params.code);
  if (!result) {
    return res
      .status(404)
      .json({ error: `Country not found: ${req.params.code}` });
  }
  res.json(result);
});

router.get("/indicators/rank", (req, res) => {
  const { indicator, limit, order } = req.query;
  if (!indicator) {
    return res
      .status(400)
      .json({ error: "Query parameter 'indicator' is required" });
  }
  const result = rankCountriesByIndicator(indicator, {
    limit: parseIntParam(limit, 10),
    order: order || "desc",
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/indicators/compare", (req, res) => {
  const { countries, indicator } = req.query;
  if (!countries) {
    return res.status(400).json({
      error:
        "Query parameter 'countries' is required (comma-separated ISO alpha-3 codes)",
    });
  }
  const codes = countries
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.length < 2) {
    return res
      .status(400)
      .json({ error: "At least 2 country codes required for comparison" });
  }
  const result = compareCountries(codes, indicator || null);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/indicators/list", asyncHandler(
  () => getAvailableIndicators(),
  "Indicator list",
  500,
));

// ─── Exoplanets ────────────────────────────────────────────────────

router.get("/exoplanets/search", (req, res) => {
  const { q, limit, method } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchExoplanets(q, {
    limit: parseIntParam(limit, 10),
    method,
  }));
});

router.get("/exoplanets/lookup/:name", (req, res) => {
  const result = getExoplanetByName(req.params.name);
  if (!result) {
    return res.status(404).json({ error: `Exoplanet not found: ${req.params.name}` });
  }
  res.json(result);
});

router.get("/exoplanets/rank", (req, res) => {
  const { field, limit, order } = req.query;
  if (!field) {
    return res.status(400).json({ error: "Query parameter 'field' is required" });
  }
  res.json(rankExoplanets(field, {
    limit: parseIntParam(limit, 10),
    order: order || "desc",
  }));
});

router.get("/exoplanets/stats", asyncHandler(
  () => getDiscoveryStats(),
  "Exoplanet stats",
  500,
));

router.get("/exoplanets/habitable", asyncHandler(
  (req) => getHabitableZonePlanets({
    limit: parseIntParam(req.query.limit, 20),
  }),
  "Habitable zone query",
  500,
));

// ─── YouTube ───────────────────────────────────────────────────────

router.get("/youtube/video", async (req, res) => {
  const { url, lang, transcript, timestamps } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (YouTube URL or video ID)" });
  }
  const result = await getYouTubeVideoInfo(url, {
    lang,
    includeTranscript: transcript !== "false",
    includeTimestamps: timestamps !== "false",
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── GitHub ────────────────────────────────────────────────────────

router.get("/github/repo", async (req, res) => {
  const { url, readme, languages } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (GitHub URL or owner/repo)" });
  }
  const result = await getGitHubRepo(url, {
    includeReadme: readme !== "false",
    includeLanguages: languages !== "false",
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Reddit ────────────────────────────────────────────────────────

router.get("/reddit/thread", async (req, res) => {
  const { url, commentLimit } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (Reddit URL)" });
  }
  const result = await getRedditThread(url, {
    commentLimit: commentLimit ? parseIntParam(commentLimit, 20) : undefined,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── NPM ───────────────────────────────────────────────────────────

router.get("/npm/package", async (req, res) => {
  const { name, readme } = req.query;
  if (!name) {
    return res.status(400).json({ error: "Query parameter 'name' is required (NPM package name)" });
  }
  const result = await getNpmPackage(name, {
    includeReadme: readme !== "false",
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── PyPI ──────────────────────────────────────────────────────────

router.get("/pypi/package", asyncHandler(
  (req) => getPyPiPackage(req.query.name),
  "PyPI lookup",
));

// ─── PDF ───────────────────────────────────────────────────────────

router.get("/pdf/read", async (req, res) => {
  const { url, maxPages } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (URL to a PDF file)" });
  }
  const result = await readPdfUrl(url, { maxPages });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── RSS ───────────────────────────────────────────────────────────

router.get("/rss/feed", async (req, res) => {
  const { url, limit } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (RSS/Atom feed URL)" });
  }
  const result = await readRssFeed(url, {
    limit: limit ? parseIntParam(limit, 20) : undefined,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Twitter/X ─────────────────────────────────────────────────────

router.get("/twitter/post", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (Twitter/X URL or tweet ID)" });
  }
  const result = await getTwitterPost(url);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Hacker News ───────────────────────────────────────────────────

router.get("/hackernews/thread", async (req, res) => {
  const { url, commentLimit } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (HN URL or item ID)" });
  }
  const result = await getHackerNewsThread(url, {
    commentLimit: commentLimit ? parseIntParam(commentLimit, 25) : undefined,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Stack Overflow ────────────────────────────────────────────────

router.get("/stackoverflow/question", async (req, res) => {
  const { url, answerLimit } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required (Stack Overflow URL or question ID)" });
  }
  const result = await getStackOverflowQuestion(url, {
    answerLimit: answerLimit ? parseIntParam(answerLimit, 5) : undefined,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Unified: Web Content (YouTube/Reddit/Twitter/HN/SO/GitHub) ───

router.get("/web/content", async (req, res) => {
  const { url, commentLimit, answerLimit, transcript, lang, readme, languages } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Query parameter 'url' is required" });
  }
  const result = await getWebContent(url, {
    commentLimit, answerLimit, transcript, lang, readme, languages,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Unified: Package Info (NPM/PyPI) ─────────────────────────────

router.get("/package/info", async (req, res) => {
  const { name, registry, readme } = req.query;
  if (!name) {
    return res.status(400).json({ error: "Query parameter 'name' is required" });
  }
  if (!registry) {
    return res.status(400).json({ error: "Query parameter 'registry' is required ('npm' or 'pypi')" });
  }
  const result = await getPackageInfo(name, registry, { readme });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Health ────────────────────────────────────────────────────────

export function getKnowledgeHealth() {
  return {
    dictionary: "on-demand",
    openLibrary: "on-demand",
    restCountries: "on-demand",
    arxiv: "on-demand",
    wikipediaSummary: "on-demand",
    jikan: "on-demand",
    tmdbMovies: "on-demand",
    tmdbTvShows: "on-demand",
    periodicTable: "on-demand (in-memory, 119 elements)",
    worldBankIndicators: "on-demand (in-memory, 217 countries)",
    nasaExoplanets: "on-demand (in-memory, ~6,153 planets)",
    youtube: "on-demand (oEmbed + youtube-transcript)",
    github: "on-demand (GitHub REST API v3)",
    reddit: "on-demand (.json API)",
    npm: "on-demand (NPM Registry)",
    pypi: "on-demand (PyPI JSON API)",
    pdf: "on-demand (pdf-parse)",
    rss: "on-demand (xml2js)",
    twitter: "on-demand (fxtwitter + oembed)",
    hackerNews: "on-demand (Firebase API)",
    stackOverflow: "on-demand (Stack Exchange API v2.3)",
    webContent: "unified (YouTube/Reddit/Twitter/HN/SO/GitHub)",
    packageInfo: "unified (NPM/PyPI)",
  };
}

export default router;
