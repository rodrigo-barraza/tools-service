// ============================================================
// Agentic Web Service — URL Fetching & Web Search
// ============================================================
// Provides web interaction primitives for AI agentic loops.
//
// - fetch_url: Fetch a web page and convert HTML to clean
//   markdown. Uses cheerio (already a dependency) for parsing.
// - web_search: Google Custom Search JSON API (100 queries/day
//   free, $5/1000 after that).
// ============================================================

import * as cheerio from "cheerio";
import CONFIG from "../config.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const MAX_FETCH_BYTES = 2_097_152;     // 2 MB max download
const FETCH_TIMEOUT_MS = 15_000;       // 15 second timeout
const MAX_OUTPUT_CHARS = 100_000;      // Truncate final markdown output

const USER_AGENT = "Mozilla/5.0 (compatible; SunTools/1.0; +https://github.com/sun)";

// Domains that block automated access — skip gracefully
const BLOCKED_DOMAINS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "169.254.169.254",  // AWS metadata
  "metadata.google.internal",
]);

// Google Custom Search JSON API
const GOOGLE_CSE_BASE = "https://www.googleapis.com/customsearch/v1";

// ────────────────────────────────────────────────────────────
// URL Fetching
// ────────────────────────────────────────────────────────────

/**
 * Fetch a URL and convert its HTML content to clean markdown.
 *
 * @param {string} url - URL to fetch
 * @param {object} [options]
 * @param {string} [options.selector] - CSS selector to extract specific content
 * @returns {Promise<object>}
 */
export async function agenticFetchUrl(url, { selector } = {}) {
  if (!url || typeof url !== "string") {
    return { error: "'url' is required and must be a string" };
  }

  // Validate URL format
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `Invalid URL: ${url}` };
  }

  // Block internal/local URLs
  if (BLOCKED_DOMAINS.has(parsed.hostname)) {
    return { error: `Domain '${parsed.hostname}' is blocked for security reasons.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Only http and https protocols are supported. Got: ${parsed.protocol}` };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        error: `HTTP ${res.status}: ${res.statusText}`,
        url,
        status: res.status,
      };
    }

    const contentType = res.headers.get("content-type") || "";

    // JSON — return directly
    if (contentType.includes("application/json")) {
      const json = await res.json();
      const text = JSON.stringify(json, null, 2);
      return {
        url,
        contentType: "application/json",
        content: text.length > MAX_OUTPUT_CHARS
          ? text.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [truncated]"
          : text,
        charCount: text.length,
        truncated: text.length > MAX_OUTPUT_CHARS,
      };
    }

    // Plain text
    if (contentType.includes("text/plain")) {
      const text = await res.text();
      return {
        url,
        contentType: "text/plain",
        content: text.length > MAX_OUTPUT_CHARS
          ? text.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [truncated]"
          : text,
        charCount: text.length,
        truncated: text.length > MAX_OUTPUT_CHARS,
      };
    }

    // HTML — convert to markdown
    const html = await res.text();
    const markdown = htmlToMarkdown(html, { selector });

    return {
      url,
      contentType: contentType.split(";")[0].trim(),
      content: markdown.length > MAX_OUTPUT_CHARS
        ? markdown.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [truncated]"
        : markdown,
      charCount: markdown.length,
      truncated: markdown.length > MAX_OUTPUT_CHARS,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { error: `Request timed out after ${FETCH_TIMEOUT_MS}ms`, url };
    }
    return { error: `Fetch failed: ${err.message}`, url };
  }
}

// ────────────────────────────────────────────────────────────
// Web Search — Multi-Provider (Brave → Google CSE fallback)
// ────────────────────────────────────────────────────────────

const BRAVE_SEARCH_BASE = "https://api.search.brave.com/res/v1/web/search";

/**
 * Search the web. Provider priority:
 *   1. Brave Search API (whole-web, 2000 queries/month free)
 *   2. Google Custom Search (site-restricted, 100 queries/day free)
 *
 * @param {string} query - Search query
 * @param {object} [options]
 * @param {number} [options.limit=5] - Number of results (max 10)
 * @param {string} [options.dateRestrict] - e.g. "d7" (past 7 days), "m1" (past month)
 * @param {string} [options.siteSearch] - Restrict to a specific site domain
 * @returns {Promise<object>}
 */
export async function agenticWebSearch(query, { limit = 5, dateRestrict, siteSearch } = {}) {
  if (!query || typeof query !== "string") {
    return { error: "'query' is required and must be a non-empty string" };
  }

  // If siteSearch is specified, prepend it to the query for Brave
  const effectiveQuery = siteSearch ? `site:${siteSearch} ${query}` : query;
  const clampedLimit = Math.min(limit, 10);

  // ── Provider 1: Brave Search ───────────────────────────────
  if (CONFIG.BRAVE_SEARCH_API_KEY) {
    try {
      const result = await _searchBrave(effectiveQuery, { limit: clampedLimit, dateRestrict });
      if (!result.error) return result;
      // If Brave fails, fall through to Google CSE
      console.warn(`[AgenticWebService] Brave Search failed, trying Google CSE: ${result.error}`);
    } catch (err) {
      console.warn(`[AgenticWebService] Brave Search exception: ${err.message}`);
    }
  }

  // ── Provider 2: Google Custom Search ───────────────────────
  if (CONFIG.GOOGLE_API_KEY && CONFIG.GOOGLE_CSE_CX) {
    return _searchGoogleCSE(query, { limit: clampedLimit, dateRestrict, siteSearch });
  }

  return {
    query,
    limit,
    results: [],
    message: "No search provider configured. Set BRAVE_SEARCH_API_KEY or GOOGLE_API_KEY + GOOGLE_CSE_CX in secrets.js.",
    provider: null,
  };
}

// ── Brave Search Implementation ──────────────────────────────

async function _searchBrave(query, { limit, dateRestrict }) {
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
  });

  // Brave freshness: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year)
  if (dateRestrict) {
    const freshnessMap = { d1: "pd", d7: "pw", w1: "pw", w2: "pw", m1: "pm", m3: "pm", y1: "py" };
    const freshness = freshnessMap[dateRestrict] || dateRestrict;
    params.set("freshness", freshness);
  }

  const res = await fetch(`${BRAVE_SEARCH_BASE}?${params}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": CONFIG.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      return { error: "Brave Search rate limit exceeded. Falling back to Google CSE.", query, provider: "brave" };
    }
    return { error: `Brave Search API error: HTTP ${res.status} — ${body.slice(0, 500)}`, query, provider: "brave" };
  }

  const data = await res.json();
  const webResults = data.web?.results || [];

  const results = webResults.slice(0, limit).map((item) => ({
    title: item.title || "",
    url: item.url || "",
    snippet: item.description?.replace(/<\/?[^>]+(>|$)/g, "").trim() || "",
    displayUrl: item.url ? new URL(item.url).hostname : "",
    age: item.age || "",
  }));

  return {
    query,
    limit,
    results,
    totalResults: String(webResults.length),
    provider: "brave",
  };
}

// ── Google CSE Implementation ────────────────────────────────

async function _searchGoogleCSE(query, { limit, dateRestrict, siteSearch }) {
  const params = new URLSearchParams({
    key: CONFIG.GOOGLE_API_KEY,
    cx: CONFIG.GOOGLE_CSE_CX,
    q: query,
    num: String(limit),
  });

  if (dateRestrict) params.set("dateRestrict", dateRestrict);
  if (siteSearch) params.set("siteSearch", siteSearch);

  const res = await fetch(`${GOOGLE_CSE_BASE}?${params}`, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      return {
        error: "Google Custom Search daily quota exhausted (100/day free).",
        query,
        provider: "google_cse",
      };
    }
    return {
      error: `Google CSE API error: HTTP ${res.status} — ${body.slice(0, 500)}`,
      query,
      provider: "google_cse",
    };
  }

  const data = await res.json();

  const results = (data.items || []).map((item) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet?.replace(/\n/g, " ").trim() || "",
    displayUrl: item.displayLink || "",
  }));

  return {
    query,
    limit,
    results,
    totalResults: data.searchInformation?.totalResults || "0",
    searchTime: data.searchInformation?.searchTime || 0,
    provider: "google_cse",
  };
}

// ────────────────────────────────────────────────────────────
// HTML → Markdown Converter
// ────────────────────────────────────────────────────────────

/**
 * Convert HTML to clean markdown using cheerio.
 * Strips scripts, styles, nav, and other non-content elements.
 *
 * @param {string} html - Raw HTML
 * @param {object} [options]
 * @param {string} [options.selector] - CSS selector for content extraction
 * @returns {string} Clean markdown
 */
function htmlToMarkdown(html, { selector } = {}) {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, nav, footer, header, noscript, iframe, svg, form, button, input, select, textarea").remove();
  $("[role='navigation'], [role='banner'], [role='complementary'], [aria-hidden='true']").remove();
  $(".cookie-banner, .popup, .modal, .overlay, .sidebar, .ad, .advertisement").remove();

  // If a CSS selector was provided, focus on that
  let root = $("body");
  if (selector) {
    const selected = $(selector);
    if (selected.length > 0) {
      root = selected;
    }
  } else {
    // Try to find main content area
    const mainContent = $("main, article, [role='main'], .content, .post-content, .entry-content, #content");
    if (mainContent.length > 0) {
      root = mainContent.first();
    }
  }

  const lines = [];

  function processNode(el) {
    if (!el || !el.length) return;

    el.contents().each((_, node) => {
      if (node.type === "text") {
        const text = $(node).text().trim();
        if (text) {
          lines.push(text);
        }
        return;
      }

      if (node.type !== "tag") return;

      const $node = $(node);
      const tag = node.tagName?.toLowerCase();

      switch (tag) {
        case "h1":
          lines.push(`\n# ${$node.text().trim()}\n`);
          break;
        case "h2":
          lines.push(`\n## ${$node.text().trim()}\n`);
          break;
        case "h3":
          lines.push(`\n### ${$node.text().trim()}\n`);
          break;
        case "h4":
          lines.push(`\n#### ${$node.text().trim()}\n`);
          break;
        case "h5":
        case "h6":
          lines.push(`\n##### ${$node.text().trim()}\n`);
          break;
        case "p":
          lines.push(`\n${$node.text().trim()}\n`);
          break;
        case "br":
          lines.push("\n");
          break;
        case "hr":
          lines.push("\n---\n");
          break;
        case "a": {
          const href = $node.attr("href");
          const text = $node.text().trim();
          if (href && text) {
            lines.push(`[${text}](${href})`);
          } else if (text) {
            lines.push(text);
          }
          break;
        }
        case "img": {
          const alt = $node.attr("alt") || "";
          const src = $node.attr("src") || "";
          if (src) {
            lines.push(`![${alt}](${src})`);
          }
          break;
        }
        case "code":
          if ($node.parent().is("pre")) {
            // Handled by 'pre' case
          } else {
            lines.push(`\`${$node.text().trim()}\``);
          }
          break;
        case "pre": {
          const codeText = $node.text().trim();
          const lang = $node.find("code").attr("class")?.match(/language-(\w+)/)?.[1] || "";
          lines.push(`\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`);
          break;
        }
        case "blockquote":
          lines.push(`\n> ${$node.text().trim()}\n`);
          break;
        case "ul":
        case "ol":
          $node.children("li").each((i, li) => {
            const bullet = tag === "ol" ? `${i + 1}.` : "-";
            lines.push(`${bullet} ${$(li).text().trim()}`);
          });
          lines.push("");
          break;
        case "table":
          processTable($, $node, lines);
          break;
        case "strong":
        case "b":
          lines.push(`**${$node.text().trim()}**`);
          break;
        case "em":
        case "i":
          lines.push(`*${$node.text().trim()}*`);
          break;
        case "div":
        case "section":
        case "article":
        case "main":
          processNode($node);
          break;
        default:
          processNode($node);
          break;
      }
    });
  }

  processNode(root);

  // Clean up output
  let output = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Get page title if available
  const title = $("title").text().trim();
  if (title) {
    output = `# ${title}\n\n${output}`;
  }

  return output;
}

/**
 * Convert an HTML table to markdown table syntax.
 */
function processTable($, $table, lines) {
  const rows = [];

  $table.find("tr").each((_, tr) => {
    const cells = [];
    $(tr).find("th, td").each((_, cell) => {
      cells.push($(cell).text().trim().replace(/\|/g, "\\|"));
    });
    rows.push(cells);
  });

  if (rows.length === 0) return;

  // First row as header
  lines.push(`\n| ${rows[0].join(" | ")} |`);
  lines.push(`| ${rows[0].map(() => "---").join(" | ")} |`);

  for (let i = 1; i < rows.length; i++) {
    lines.push(`| ${rows[i].join(" | ")} |`);
  }
  lines.push("");
}

/**
 * Get the web service health info.
 */
export function getAgenticWebHealth() {
  const brave = !!CONFIG.BRAVE_SEARCH_API_KEY;
  const googleCse = !!(CONFIG.GOOGLE_API_KEY && CONFIG.GOOGLE_CSE_CX);
  const providers = [brave && "brave", googleCse && "google_cse"].filter(Boolean);
  return {
    fetchUrl: "on-demand (cheerio HTML→markdown)",
    webSearch: providers.length ? `${providers.join(" → ")} (active)` : "not configured",
    maxFetchBytes: MAX_FETCH_BYTES,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
  };
}
