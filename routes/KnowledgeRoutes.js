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
import { parseIntParam } from "../utilities.js";

const router = Router();

// ─── Dictionary ────────────────────────────────────────────────────

router.get("/dictionary/:word", async (req, res) => {
  try {
    const result = await fetchDefinition(req.params.word);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Dictionary lookup failed: ${err.message}` });
  }
});

// ─── Books ─────────────────────────────────────────────────────────

router.get("/books/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = await searchBooks(q, parseIntParam(limit, 10));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Book search failed: ${err.message}` });
  }
});

router.get("/books/work/:workKey", async (req, res) => {
  try {
    const result = await getBookDetails(req.params.workKey);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Book details failed: ${err.message}` });
  }
});

router.get("/books/author/:authorKey", async (req, res) => {
  try {
    const result = await getAuthorInfo(req.params.authorKey);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Author info failed: ${err.message}` });
  }
});

// ─── Countries ─────────────────────────────────────────────────────

router.get("/countries/search/:name", async (req, res) => {
  try {
    const result = await searchCountries(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Country search failed: ${err.message}` });
  }
});

router.get("/countries/code/:code", async (req, res) => {
  try {
    const result = await getCountryByCode(req.params.code);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Country lookup failed: ${err.message}` });
  }
});

// ─── Papers (arXiv) ────────────────────────────────────────────────

router.get("/papers/search", async (req, res) => {
  const { q, category, limit, sortBy } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = await searchPapers(q, {
      category,
      limit: parseIntParam(limit, 10),
      sortBy: sortBy || "relevance",
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Paper search failed: ${err.message}` });
  }
});

// ─── Wikipedia Summaries ───────────────────────────────────────────

router.get("/wikipedia/summary/:title", async (req, res) => {
  try {
    const result = await getArticleSummary(req.params.title);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Wikipedia summary failed: ${err.message}` });
  }
});

router.get("/wikipedia/onthisday", async (req, res) => {
  const { type, month, day } = req.query;
  try {
    const result = await getOnThisDay(
      type || "selected",
      month ? parseInt(month, 10) : undefined,
      day ? parseInt(day, 10) : undefined,
    );
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `On This Day failed: ${err.message}` });
  }
});

// ─── Health ────────────────────────────────────────────────────────

export function getKnowledgeHealth() {
  return {
    dictionary: "on-demand",
    openLibrary: "on-demand",
    restCountries: "on-demand",
    arxiv: "on-demand",
    wikipediaSummary: "on-demand",
  };
}

export default router;
