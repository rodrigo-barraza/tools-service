import { stripHtml } from "@rodrigo-barraza/utilities";
import { ARXIV_BASE_URL } from "../../constants.js";
import { extractXmlTag, extractXmlItems } from "../../utilities.js";
/**
 * arXiv API fetcher.
 * https://info.arxiv.org/help/api/ — no auth, fully open.
 * Returns academic papers with abstracts, authors, categories.
 * Uses Atom XML responses — parsed with lightweight XML utilities.
 */
// ─── Helpers ───────────────────────────────────────────────────────
function parseEntry(entryXml) {
  const id = extractXmlTag(entryXml, "id");
  const title = extractXmlTag(entryXml, "title")?.replace(/\s+/g, " ").trim();
  const summary = extractXmlTag(entryXml, "summary")
    ?.replace(/\s+/g, " ")
    .trim();
  const published = extractXmlTag(entryXml, "published");
  const updated = extractXmlTag(entryXml, "updated");
  // Extract authors
  const authorBlocks = extractXmlItems(entryXml, "author");
  const authors = authorBlocks
    .map((a) => extractXmlTag(a, "name"))
    .filter(Boolean)
    .slice(0, 10);
  // Extract categories from <category term="..." />
  const categoryMatches = [...entryXml.matchAll(/category\s+term="([^"]+)"/g)];
  const categories = categoryMatches.map((m) => m[1]);
  const primaryCategory = categories[0] || null;
  // Extract PDF link
  const pdfMatch = entryXml.match(/link[^>]+title="pdf"[^>]+href="([^"]+)"/);
  const pdfUrl = pdfMatch ? pdfMatch[1] : null;
  // Extract DOI
  const doi = extractXmlTag(entryXml, "arxiv:doi");
  // Extract comment (page count, conference, etc.)
  const comment = extractXmlTag(entryXml, "arxiv:comment");
  return {
    arxivId: id?.replace("http://arxiv.org/abs/", "") || null,
    title,
    abstract: summary ? stripHtml(summary) : null,
    authors,
    published: published || null,
    updated: updated || null,
    primaryCategory,
    categories: categories.slice(0, 5),
    pdfUrl,
    abstractUrl: id || null,
    doi: doi || null,
    comment: comment || null,
  };
}
// ─── Search Papers ─────────────────────────────────────────────────
/**
 * Search arXiv for papers matching a query.
 * @param {string} query - Search terms
 * @param {object} options
 * @param {string} [options.category] - arXiv category (e.g. "cs.AI")
 * @param {number} [options.limit=10] - Max results
 * @param {string} [options.sortBy="relevance"] - "relevance", "lastUpdatedDate", "submittedDate"
 * @returns {Promise<object>}
 */
export async function searchPapers(
  query,
  { category, limit = 10, sortBy = "relevance" } = {},
) {
  // Build the search query
  let searchQuery = `all:${query}`;
  if (category) {
    searchQuery = `cat:${category}+AND+all:${query}`;
  }
  const sortMap = {
    relevance: "relevance",
    lastUpdatedDate: "lastUpdatedDate",
    submittedDate: "submittedDate",
  };
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(Math.min(limit, 30)),
    sortBy: sortMap[sortBy] || "relevance",
    sortOrder: "descending",
  });
  const url = `${ARXIV_BASE_URL}?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`arXiv API → ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  // Parse total results from feed
  const totalResults =
    parseInt(extractXmlTag(xml, "opensearch:totalResults"), 10) || 0;
  // Parse entries
  const entries = extractXmlItems(xml, "entry");
  const papers = entries.map(parseEntry);
  return {
    totalResults,
    count: papers.length,
    papers,
  };
}
