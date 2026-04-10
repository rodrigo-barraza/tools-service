// ============================================================
// Generic Page Fetcher — Lightweight Article Extraction
// ============================================================
// Fetches any URL via HTTP and extracts readable content using
// Cheerio (no Puppeteer / no headless browser overhead).
//
// Extracts:
//   - Title, description, keywords, og:image (meta tags)
//   - Main article text (readability heuristics)
//   - Author, publish date, site name
//   - Canonical URL
//
// For JS-rendered SPAs this will get limited content, but for
// the vast majority of news articles, blogs, and static pages
// it's vastly superior to Puppeteer in speed and reliability.
// ============================================================

import * as cheerio from "cheerio";

const MAX_BODY_CHARS = 15_000;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ─── Noise Removal ──────────────────────────────────────────────────
// Selectors for elements that clutter extracted text.

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  ".sidebar",
  ".nav",
  ".menu",
  ".footer",
  ".header",
  ".cookie-banner",
  ".cookie-consent",
  ".ad",
  ".ads",
  ".advertisement",
  ".social-share",
  ".share-buttons",
  ".comments",
  ".comment-section",
  "#comments",
  ".related-posts",
  ".related-articles",
  ".newsletter",
  ".popup",
  ".modal",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[aria-hidden='true']",
];

// ─── Content Extraction ─────────────────────────────────────────────

/**
 * Score a container element for "article-ness" based on text density.
 * Higher score = more likely to be the main content.
 */
function scoreElement($, el) {
  const text = $(el).text().trim();
  const wordCount = text.split(/\s+/).length;
  const linkDensity = ($(el).find("a").text().length || 0) / (text.length || 1);

  let score = wordCount;

  // Bonus for article-like tags and classes
  const tagName = (el.tagName || el.name || "").toLowerCase();
  if (tagName === "article") score *= 2;
  if (tagName === "main") score *= 1.8;

  const classId = `${$(el).attr("class") || ""} ${$(el).attr("id") || ""}`.toLowerCase();
  if (/article|post|content|entry|story|body/i.test(classId)) score *= 1.5;
  if (/sidebar|nav|menu|footer|header|comment/i.test(classId)) score *= 0.1;

  // Penalize link-heavy containers (navigation, link lists)
  if (linkDensity > 0.5) score *= 0.2;

  // Minimum word threshold
  if (wordCount < 25) score *= 0.1;

  return score;
}

/**
 * Extract the main readable text from HTML.
 */
function extractMainContent($) {
  // Remove noise elements first
  $(NOISE_SELECTORS.join(", ")).remove();

  // Try explicit article/main tags first
  const articleEl = $("article, [role='main'], main").first();
  if (articleEl.length && articleEl.text().trim().split(/\s+/).length > 50) {
    return extractText($, articleEl);
  }

  // Score all block-level containers
  const candidates = [];
  $("div, section, article, main").each((_, el) => {
    const score = scoreElement($, el);
    if (score > 25) {
      candidates.push({ el, score });
    }
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    return extractText($, $(candidates[0].el));
  }

  // Last resort: body text
  return extractText($, $("body"));
}

/**
 * Extract clean text from a Cheerio element, preserving paragraph breaks.
 */
function extractText($, container) {
  const paragraphs = [];

  container.find("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 10) {
      const tagName = (el.tagName || el.name || "").toLowerCase();
      if (tagName.startsWith("h")) {
        paragraphs.push(`## ${text}`);
      } else if (tagName === "blockquote") {
        paragraphs.push(`> ${text}`);
      } else if (tagName === "li") {
        paragraphs.push(`- ${text}`);
      } else {
        paragraphs.push(text);
      }
    }
  });

  // If the structured extraction yielded very little, fall back to raw text
  if (paragraphs.join("\n").length < 100) {
    const raw = container.text().trim().replace(/\s+/g, " ");
    return raw;
  }

  return paragraphs.join("\n\n");
}

// ─── Metadata Extraction ────────────────────────────────────────────

function extractMetadata($, url) {
  const meta = {};

  // Title: og:title > twitter:title > <title>
  meta.title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("title").first().text().trim() ||
    null;

  // Description: og:description > meta description > twitter:description
  meta.description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    $('meta[name="twitter:description"]').attr("content") ||
    null;

  // Image
  meta.image =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    null;

  // Author
  meta.author =
    $('meta[name="author"]').attr("content") ||
    $('meta[property="article:author"]').attr("content") ||
    $('[rel="author"]').first().text().trim() ||
    null;

  // Published date
  meta.publishedDate =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="date"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    null;

  // Site name
  meta.siteName =
    $('meta[property="og:site_name"]').attr("content") ||
    null;

  // Keywords
  const keywords = $('meta[name="keywords"]').attr("content");
  meta.keywords = keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : null;

  // Canonical URL
  meta.canonicalUrl =
    $('link[rel="canonical"]').attr("href") ||
    $('meta[property="og:url"]').attr("content") ||
    url;

  // Type
  meta.type =
    $('meta[property="og:type"]').attr("content") || null;

  // Strip null values
  for (const key of Object.keys(meta)) {
    if (meta[key] === null || meta[key] === "") delete meta[key];
  }

  return meta;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Fetch and extract readable content from any URL.
 * No Puppeteer — uses fetch + Cheerio.
 *
 * @param {string} url - Any HTTP(S) URL
 * @param {object} [options]
 * @param {number} [options.maxChars=15000] - Max characters of body text
 * @returns {Promise<object>}
 */
export async function fetchGenericPage(url, options = {}) {
  const maxChars = options.maxChars ? parseInt(options.maxChars, 10) : MAX_BODY_CHARS;

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (error) {
    if (error.name === "AbortError") {
      return { error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}` };
    }
    return { error: `Fetch failed: ${error.message}` };
  }

  if (!response.ok) {
    return { error: `HTTP ${response.status}: ${url}` };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return {
      error: `Non-HTML content type: ${contentType}`,
      url,
      contentType,
    };
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract metadata
  const metadata = extractMetadata($, url);

  // Extract main content
  let text = extractMainContent($);

  // Truncate if needed
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n\n... [truncated]";
    truncated = true;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    platform: "generic",
    url: metadata.canonicalUrl || url,
    ...metadata,
    text,
    wordCount,
    truncated,
  };
}
