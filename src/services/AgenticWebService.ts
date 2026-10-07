// ─── URL Fetching & Web Search ──────────────────────────────

import * as cheerio from "cheerio";
type AnyNode = ReturnType<cheerio.CheerioAPI> extends cheerio.Cheerio<infer U> ? U : never;
type CheerioAPI = cheerio.CheerioAPI;
type Cheerio<T> = cheerio.Cheerio<T>;

import CONFIG from "../config.ts";
import logger from "../logger.ts";
import rateLimiter from "./RateLimiterService.ts";
import { errorMessage } from "../utilities.ts";
import { fetchPublicOrOwnUrl } from "../fetchers/web/SsrfGuard.ts";

interface BraveSearchItem {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  extra_snippets?: string[];
}

interface GoogleCseItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
}

interface DuckDuckGoSearchResult {
  title: string;
  url: string;
  snippet: string;
  displayUrl: string;
}

interface BraveNewsItem {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  thumbnail?: { src?: string };
  meta_url?: { hostname?: string };
  extra_snippets?: string[];
}

interface BraveImageItem {
  title?: string;
  url?: string;
  source?: string;
  page_age?: string;
  page_fetched?: string;
  thumbnail?: { src?: string; width?: number; height?: number };
  properties?: { url?: string; width?: number; height?: number; format?: string };
  meta_url?: { hostname?: string };
}

interface BraveVideoItem {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  thumbnail?: { src?: string };
  video?: { duration?: string; views?: number; creator?: string; publisher?: string };
  meta_url?: { hostname?: string };
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000; // 15 second timeout
const MAX_OUTPUT_CHARS = 100_000; // Truncate final markdown output

const USER_AGENT =
  "Mozilla/5.0 (compatible; SunTools/1.0; +https://github.com/sun)";

// Google Custom Search JSON API
const GOOGLE_CSE_BASE = "https://www.googleapis.com/customsearch/v1";

const DUCKDUCKGO_HTML_BASE = "https://html.duckduckgo.com/html/";

const DUCKDUCKGO_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SEARCH_PROVIDER = {
  BRAVE: "brave",
  BRAVE_NEWS: "brave_news",
  DUCKDUCKGO: "duckduckgo",
  GOOGLE_CSE: "google_cse",
} as const;

const SEARCH_RATE_LIMIT_KEY = {
  DUCKDUCKGO: "DUCKDUCKGO",
} as const;

// ────────────────────────────────────────────────────────────
// URL Fetching
// ────────────────────────────────────────────────────────────

/**
 * Fetch a URL and convert its HTML content to clean markdown.
 */
export async function agenticFetchUrl(
  url: string,
  { selector }: { selector?: string } = {},
) {
  if (!url || typeof url !== "string") {
    return { error: "'url' is required and must be a string" };
  }

  // Validate URL format
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `Invalid URL: ${url}` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      error: `Only http and https protocols are supported. Got: ${parsed.protocol}`,
    };
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // A model's URL: public, or one of our own services, on every hop
    const response = await fetchPublicOrOwnUrl(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,text/plain,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return {
        error: `HTTP ${response.status}: ${response.statusText}`,
        url,
        status: response.status,
      };
    }

    const contentType = response.headers.get("content-type") || "";

    // JSON — return directly
    if (contentType.includes("application/json")) {
      const json = await response.json();
      const text = JSON.stringify(json, null, 2);
      return {
        url,
        contentType: "application/json",
        content:
          text.length > MAX_OUTPUT_CHARS
            ? text.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [truncated]"
            : text,
        charCount: text.length,
        truncated: text.length > MAX_OUTPUT_CHARS,
      };
    }

    // Plain text
    if (contentType.includes("text/plain")) {
      const text = await response.text();
      return {
        url,
        contentType: "text/plain",
        content:
          text.length > MAX_OUTPUT_CHARS
            ? text.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [truncated]"
            : text,
        charCount: text.length,
        truncated: text.length > MAX_OUTPUT_CHARS,
      };
    }

    // HTML — convert to markdown
    const html = await response.text();
    const markdown = htmlToMarkdown(html, { selector });

    return {
      url,
      contentType: contentType.split(";")[0].trim(),
      content:
        markdown.length > MAX_OUTPUT_CHARS
          ? markdown.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [truncated]"
          : markdown,
      charCount: markdown.length,
      truncated: markdown.length > MAX_OUTPUT_CHARS,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: `Request timed out after ${FETCH_TIMEOUT_MS}ms`, url };
    }
    return { error: `Fetch failed: ${errorMessage(error)}`, url };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

// ────────────────────────────────────────────────────────────
// Web Search — Multi-Provider (priority-configurable)
// Default: Brave → DuckDuckGo → Google CSE (deprecated)
// Set SEARCH_PROVIDER_PRIORITY=duckduckgo to flip primary
// ────────────────────────────────────────────────────────────

const BRAVE_SEARCH_BASE = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_NEWS_SEARCH_BASE = "https://api.search.brave.com/res/v1/news/search";
const BRAVE_IMAGE_SEARCH_BASE = "https://api.search.brave.com/res/v1/images/search";
const BRAVE_VIDEO_SEARCH_BASE = "https://api.search.brave.com/res/v1/videos/search";

function _buildBraveRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
  };
  if (CONFIG.BRAVE_SEARCH_API_KEY) {
    headers["X-Subscription-Token"] = CONFIG.BRAVE_SEARCH_API_KEY;
  }
  return headers;
}

type SearchProvider = typeof SEARCH_PROVIDER.BRAVE | typeof SEARCH_PROVIDER.DUCKDUCKGO;

export async function agenticWebSearch(
  query: string,
  {
    limit = 5,
    dateRestrict,
    siteSearch,
    provider,
  }: {
    limit?: number;
    dateRestrict?: string;
    siteSearch?: string;
    provider?: SearchProvider;
  } = {},
) {
  if (!query || typeof query !== "string") {
    return { error: "'query' is required and must be a non-empty string" };
  }

  // siteSearch is prepended as site: operator for providers that use query strings
  const effectiveQuery = siteSearch ? `site:${siteSearch} ${query}` : query;
  const clampedLimit = Math.min(Number(limit), 20);

  // Build ordered provider chain based on config priority + optional override
  const providerChain = _buildProviderChain(provider);

  logger.info(
    `[AgenticWebService] Search provider chain: ${providerChain.join(" → ")}`,
  );

  for (const currentProvider of providerChain) {
    const result = await _tryProvider(currentProvider, effectiveQuery, {
      limit: clampedLimit,
      dateRestrict,
      siteSearch,
      query,
    });
    if (result) return result;
  }

  return {
    query,
    limit,
    results: [],
    message:
      "All search providers failed. Brave API key not set, DuckDuckGo scrape failed, and Google CSE not configured.",
    provider: null,
  };
}

function _buildProviderChain(
  forcedProvider?: SearchProvider,
): string[] {
  // If a specific provider is forced, use only that provider
  if (forcedProvider) {
    return [forcedProvider];
  }

  const priority = CONFIG.SEARCH_PROVIDER_PRIORITY;
  const chain: string[] = [];

  if (priority === SEARCH_PROVIDER.DUCKDUCKGO) {
    chain.push(SEARCH_PROVIDER.DUCKDUCKGO);
    if (CONFIG.BRAVE_SEARCH_API_KEY) chain.push(SEARCH_PROVIDER.BRAVE);
  } else {
    if (CONFIG.BRAVE_SEARCH_API_KEY) chain.push(SEARCH_PROVIDER.BRAVE);
    chain.push(SEARCH_PROVIDER.DUCKDUCKGO);
  }

  // Google CSE always last (deprecated)
  if (CONFIG.GOOGLE_CLOUD_API_KEY && CONFIG.GOOGLE_CSE_CX) {
    chain.push(SEARCH_PROVIDER.GOOGLE_CSE);
  }

  return chain;
}

async function _tryProvider(
  providerName: string,
  effectiveQuery: string,
  {
    limit,
    dateRestrict,
    siteSearch,
    query,
  }: {
    limit: number;
    dateRestrict?: string;
    siteSearch?: string;
    query: string;
  },
): Promise<Record<string, unknown> | null> {
  try {
    switch (providerName) {
      case SEARCH_PROVIDER.BRAVE: {
        if (!CONFIG.BRAVE_SEARCH_API_KEY) return null;
        const braveResult = await _searchBrave(effectiveQuery, {
          limit,
          dateRestrict,
        });
        if (!braveResult.error) return braveResult;
        logger.warn(
          `[AgenticWebService] Brave Search failed: ${braveResult.error}`,
        );
        return null;
      }
      case SEARCH_PROVIDER.DUCKDUCKGO: {
        const duckDuckGoResult = await _searchDuckDuckGo(effectiveQuery, {
          limit,
          dateRestrict,
        });
        if (!duckDuckGoResult.error) return duckDuckGoResult;
        logger.warn(
          `[AgenticWebService] DuckDuckGo scrape failed: ${duckDuckGoResult.error}`,
        );
        return null;
      }
      case SEARCH_PROVIDER.GOOGLE_CSE: {
        logger.warn(
          "[AgenticWebService] Using deprecated Google CSE fallback — this provider is being discontinued.",
        );
        return _searchGoogleCSE(query, { limit, dateRestrict, siteSearch });
      }
      default:
        return null;
    }
  } catch (error: unknown) {
    logger.warn(
      `[AgenticWebService] ${providerName} exception: ${errorMessage(error)}`,
    );
    return null;
  }
}

// ── Brave Search Implementation ──────────────────────────────

async function _searchBrave(
  query: string,
  { limit, dateRestrict }: { limit: number; dateRestrict?: string },
) {
  const params = new URLSearchParams({
    "q": query,
    count: String(limit),
    text_decorations: "false",
    extra_snippets: "true",
    result_filter: "web",
    safesearch: "off",
  });

  // Brave freshness parameters: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year)
  if (dateRestrict) {
    const BraveFreshness = {
      pastDay: "pd",
      pastWeek: "pw",
      pastMonth: "pm",
      pastYear: "py",
    } as const;

    const freshnessMap: Record<string, string> = {
      d1: BraveFreshness.pastDay,
      d7: BraveFreshness.pastWeek,
      w1: BraveFreshness.pastWeek,
      w2: BraveFreshness.pastWeek,
      m1: BraveFreshness.pastMonth,
      m3: BraveFreshness.pastMonth,
      y1: BraveFreshness.pastYear,
    };
    const freshness =
      freshnessMap[dateRestrict as keyof typeof freshnessMap] || dateRestrict;
    params.set("freshness", freshness);
  }

  const headers = _buildBraveRequestHeaders();

  const response = await fetch(`${BRAVE_SEARCH_BASE}?${params}`, {
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      return {
        error: "Brave Search rate limit exceeded.",
        query,
        provider: SEARCH_PROVIDER.BRAVE,
      };
    }
    return {
      error: `Brave Search API error: HTTP ${response.status} — ${body.slice(0, 500)}`,
      query,
      provider: SEARCH_PROVIDER.BRAVE,
    };
  }

  const data = await response.json();
  const webResults = data.web?.results || [];

  const results = webResults.slice(0, limit).map((item: BraveSearchItem) => ({
    title: item.title || "",
    url: item.url || "",
    snippet: item.description?.trim() || "",
    displayUrl: item.url ? new URL(item.url).hostname : "",
    age: item.age || "",
    pageAge: item.page_age || "",
    ...(item.extra_snippets?.length && { extraSnippets: item.extra_snippets }),
  }));

  return {
    query,
    limit,
    results,
    totalResults: String(webResults.length),
    provider: SEARCH_PROVIDER.BRAVE,
  };
}

// ── Brave News Search Implementation ─────────────────────────

async function _searchBraveNews(
  query: string,
  { limit, dateRestrict }: { limit: number; dateRestrict?: string },
) {
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
    text_decorations: "false",
    extra_snippets: "true",
    safesearch: "off",
  });

  if (dateRestrict) {
    const freshnessMap: Record<string, string> = {
      d1: "pd", d7: "pw", w1: "pw", w2: "pw",
      m1: "pm", m3: "pm", y1: "py",
    };
    const freshness = freshnessMap[dateRestrict] || dateRestrict;
    params.set("freshness", freshness);
  }

  const response = await fetch(`${BRAVE_NEWS_SEARCH_BASE}?${params}`, {
    headers: _buildBraveRequestHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      return null;
    }
    logger.warn(
      `[AgenticWebService] Brave News API error: HTTP ${response.status} — ${body.slice(0, 200)}`,
    );
    return null;
  }

  const data = await response.json();
  const newsResults = data.results || [];

  if (newsResults.length === 0) return null;

  return {
    results: newsResults.slice(0, limit).map((item: BraveNewsItem) => ({
      title: item.title || "",
      url: item.url || "",
      source: item.meta_url?.hostname || "",
      snippet: item.description?.trim() || "",
      publishedAt: item.age || "",
      publishedAtIso: item.page_age || "",
      ...(item.thumbnail?.src && { thumbnail: item.thumbnail.src }),
      ...(item.extra_snippets?.length && { extraSnippets: item.extra_snippets }),
    })),
    totalResults: newsResults.length,
    provider: SEARCH_PROVIDER.BRAVE_NEWS,
  };
}

// ── DuckDuckGo HTML Scrape Implementation ────────────────────

async function _searchDuckDuckGo(
  query: string,
  { limit, dateRestrict }: { limit: number; dateRestrict?: string },
) {
  const formParameters = new URLSearchParams({ "q": query });

  // DDG date restrict: d = past day, w = past week, m = past month
  if (dateRestrict) {
    const duckDuckGoDateRestrictMap: Record<string, string> = {
      d1: "d",
      d7: "w",
      w1: "w",
      w2: "m",
      m1: "m",
      m3: "m",
      y1: "y",
    };
    const mappedDateRestrict = duckDuckGoDateRestrictMap[dateRestrict];
    if (mappedDateRestrict) {
      formParameters.set("df", mappedDateRestrict);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    await rateLimiter.wait(SEARCH_RATE_LIMIT_KEY.DUCKDUCKGO);

    const response = await fetch(DUCKDUCKGO_HTML_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DUCKDUCKGO_BROWSER_USER_AGENT,
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: formParameters.toString(),
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        error: `DuckDuckGo HTML error: HTTP ${response.status}`,
        query,
        provider: SEARCH_PROVIDER.DUCKDUCKGO,
      };
    }

    const html = await response.text();
    const CHEERIOAPI = cheerio.load(html);

    const results: DuckDuckGoSearchResult[] = [];

    CHEERIOAPI(".result").each((_index: number, element: AnyNode) => {
      if (results.length >= limit) return false;

      const $result = CHEERIOAPI(element);
      const $titleAnchor = $result.find(".result__a").first();
      const rawTitle = $titleAnchor.text().trim();
      const rawHref = $titleAnchor.attr("href") || "";
      const rawSnippet = $result.find(".result__snippet").first().text().trim();
      const rawDisplayUrl = $result.find(".result__url").first().text().trim();

      // DDG wraps URLs in a redirect — extract the actual destination
      const resolvedUrl = _decodeDuckDuckGoRedirectUrl(rawHref);

      if (rawTitle && resolvedUrl) {
        results.push({
          title: rawTitle,
          url: resolvedUrl,
          snippet: rawSnippet,
          displayUrl: rawDisplayUrl || _extractHostname(resolvedUrl),
        });
      }
    });

    if (results.length === 0) {
      return {
        error: "DuckDuckGo returned no parseable results (possible rate-limit or CAPTCHA).",
        query,
        provider: SEARCH_PROVIDER.DUCKDUCKGO,
      };
    }

    return {
      query,
      limit,
      results,
      totalResults: String(results.length),
      provider: SEARCH_PROVIDER.DUCKDUCKGO,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function _decodeDuckDuckGoRedirectUrl(rawHref: string): string {
  try {
    // DDG redirect format: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
    const normalizedHref = rawHref.startsWith("//")
      ? `https:${rawHref}`
      : rawHref;
    const parsed = new URL(normalizedHref);
    const encodedDestination = parsed.searchParams.get("uddg");
    if (encodedDestination) {
      return decodeURIComponent(encodedDestination);
    }
  } catch {
    // Not a redirect URL — fall through
  }
  // If it's already a direct URL or parsing failed, return as-is
  if (rawHref.startsWith("http")) return rawHref;
  return "";
}

function _extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ── Google CSE Implementation (deprecated) ───────────────────

async function _searchGoogleCSE(
  query: string,
  {
    limit,
    dateRestrict,
    siteSearch,
  }: { limit: number; dateRestrict?: string; siteSearch?: string },
) {
  const params = new URLSearchParams({
    key: CONFIG.GOOGLE_CLOUD_API_KEY as string,
    cx: CONFIG.GOOGLE_CSE_CX as string,
    "q": query,
    "num": String(limit),
  });

  if (dateRestrict) params.set("dateRestrict", dateRestrict);
  if (siteSearch) params.set("siteSearch", siteSearch);

  const response = await fetch(`${GOOGLE_CSE_BASE}?${params}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      return {
        error: "Google Custom Search daily quota exhausted (100/day free).",
        query,
        provider: SEARCH_PROVIDER.GOOGLE_CSE,
      };
    }
    return {
      error: `Google CSE API error: HTTP ${response.status} — ${body.slice(0, 500)}`,
      query,
      provider: SEARCH_PROVIDER.GOOGLE_CSE,
    };
  }

  const data = await response.json();

  const results = (data.items || []).map((item: GoogleCseItem) => ({
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
    provider: SEARCH_PROVIDER.GOOGLE_CSE,
  };
}

// ────────────────────────────────────────────────────────────
// HTML → Markdown Converter
// ────────────────────────────────────────────────────────────

/**
 * Convert HTML to clean markdown using cheerio.
 * Strips scripts, styles, nav, and other non-content elements.
 */
function htmlToMarkdown(
  html: string,
  { selector }: { selector?: string } = {},
) {
  const CHEERIOAPI = cheerio.load(html);

  // Remove non-content elements
  CHEERIOAPI(
    "script, style, nav, footer, header, noscript, iframe, svg, form, button, input, select, textarea",
  ).remove();
  CHEERIOAPI(
    "[role='navigation'], [role='banner'], [role='complementary'], [aria-hidden='true']",
  ).remove();
  CHEERIOAPI(
    ".cookie-banner, .popup, .modal, .overlay, .sidebar, .ad, .advertisement",
  ).remove();

  // If a CSS selector was provided, focus on that
  let root: Cheerio<AnyNode> = CHEERIOAPI("body");
  if (selector) {
    const selected = CHEERIOAPI(selector);
    if (selected.length > 0) {
      root = selected;
    }
  } else {
    // Try to find main content area
    const mainContent = CHEERIOAPI(
      "main, article, [role='main'], .content, .post-content, .entry-content, #content",
    );
    if (mainContent.length > 0) {
      root = mainContent.first();
    }
  }

  const lines: string[] = [];

  function processNode(element: Cheerio<AnyNode>) {
    if (!element || !element.length) return;

    element.contents().each((_: number, node: AnyNode) => {
      if (node.type === "text") {
        const text = CHEERIOAPI(node).text().trim();
        if (text) {
          lines.push(text);
        }
        return;
      }

      if (node.type !== "tag") return;

      const $node = CHEERIOAPI(node);
      const tag = (
        node as unknown as { tagName?: string }
      ).tagName?.toLowerCase();

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
          const sourceAttribute = $node.attr("src") || "";
          if (sourceAttribute) {
            lines.push(`![${alt}](${sourceAttribute})`);
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
          const lang =
            $node
              .find("code")
              .attr("class")
              ?.match(/language-(\w+)/)?.[1] || "";
          lines.push(`\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`);
          break;
        }
        case "blockquote":
          lines.push(`\n> ${$node.text().trim()}\n`);
          break;
        case "ul":
        case "ol":
          $node.children("li").each((i: number, li: AnyNode) => {
            const bullet = tag === "ol" ? `${i + 1}.` : "-";
            lines.push(`${bullet} ${CHEERIOAPI(li).text().trim()}`);
          });
          lines.push("");
          break;
        case "table":
          processTable(CHEERIOAPI, $node, lines);
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
  const title = CHEERIOAPI("title").text().trim();
  if (title) {
    output = `# ${title}\n\n${output}`;
  }

  return output;
}

/**
 * Convert an HTML table to markdown table syntax.
 */
function processTable(
  CHEERIOAPI: CheerioAPI,
  $table: Cheerio<AnyNode>,
  lines: string[],
) {
  const rows: string[][] = [];

  $table.find("tr").each((_: number, tr: AnyNode) => {
    const cells: string[] = [];
    CHEERIOAPI(tr)
      .find("th, td")
      .each((_: number, cell: AnyNode) => {
        cells.push(CHEERIOAPI(cell).text().trim().replace(/\|/g, "\\|"));
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

// ────────────────────────────────────────────────────────────
// Google News RSS Feed
// ────────────────────────────────────────────────────────────

const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss";

/**
 * Pre-defined Google News topic IDs.
 * These are stable, locale-independent tokens used in the RSS URL path.
 */
const GOOGLE_NEWS_TOPIC_ID: Record<string, string> = {
  top: "",
  world: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB",
  nation: "CAAqIggKIhxDQkFTRHdvSkwyMHZNRGxqTjNjd0VnSmxiaWdBUAE",
  business: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB",
  technology: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB",
  entertainment: "CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB",
  sports: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB",
  science: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB",
  health: "CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ",
};

interface GoogleNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  publishedAtIso: string;
}

interface AgenticNewsSearchOptions {
  topic?: string;
  limit?: number;
  locale?: string;
  countryEdition?: string;
}

export async function agenticNewsSearch(
  query?: string,
  {
    topic,
    limit = 10,
    locale = "en-US",
    countryEdition = "US",
  }: AgenticNewsSearchOptions = {},
) {
  // At least one of query or topic must be provided
  if (!query && !topic) {
    return {
      error:
        "'query' or 'topic' is required. Provide a search query string, a topic name (top, world, nation, business, technology, entertainment, sports, science, health), or both.",
    };
  }

  const clampedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const [languageCode, regionCode] = locale.split("-");
  const hostLanguage = `${languageCode}-${regionCode || countryEdition}`;
  const ceid = `${countryEdition}:${languageCode}`;

  // Build RSS URL
  let rssUrl: string;

  if (query) {
    // Try Brave News first for query-based searches (better relevance ranking)
    if (CONFIG.BRAVE_SEARCH_API_KEY) {
      try {
        const braveResult = await _searchBraveNews(query, {
          limit: clampedLimit,
          dateRestrict: undefined,
        });
        if (braveResult) {
          return {
            query,
            topic: topic || null,
            locale,
            countryEdition,
            limit: clampedLimit,
            ...braveResult,
          };
        }
      } catch (error: unknown) {
        logger.warn(
          `[AgenticWebService] Brave News failed, falling back to Google RSS: ${errorMessage(error)}`,
        );
      }
    }

    // Fallback to Google News RSS for query searches
    const searchParameters = new URLSearchParams({
      q: query,
      hl: hostLanguage,
      gl: countryEdition,
      ceid,
    });
    rssUrl = `${GOOGLE_NEWS_RSS_BASE}/search?${searchParameters}`;
  } else if (topic) {
    const normalizedTopic = topic.toLowerCase().trim();
    const topicId = GOOGLE_NEWS_TOPIC_ID[normalizedTopic];

    if (topicId === undefined) {
      return {
        error: `Unknown topic '${topic}'. Available topics: ${Object.keys(GOOGLE_NEWS_TOPIC_ID).join(", ")}`,
      };
    }

    if (normalizedTopic === "top" || topicId === "") {
      // Top stories — no topic path segment
      const topParameters = new URLSearchParams({
        hl: hostLanguage,
        gl: countryEdition,
        ceid,
      });
      rssUrl = `${GOOGLE_NEWS_RSS_BASE}?${topParameters}`;
    } else {
      const topicParameters = new URLSearchParams({
        hl: hostLanguage,
        gl: countryEdition,
        ceid,
      });
      rssUrl = `${GOOGLE_NEWS_RSS_BASE}/topics/${topicId}?${topicParameters}`;
    }
  } else {
    // Unreachable due to the guard above, but TypeScript needs it
    return { error: "'query' or 'topic' is required." };
  }

  let fetchTimeout: NodeJS.Timeout | undefined;
  try {
    const controller = new AbortController();
    fetchTimeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    logger.info(
      `[AgenticWebService] News RSS fetch: ${rssUrl}`,
    );

    const response = await fetch(rssUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": locale,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        error: `Google News RSS error: HTTP ${response.status} — ${response.statusText}`,
        url: rssUrl,
      };
    }

    const xmlContent = await response.text();
    const parsedFeed = cheerio.load(xmlContent, { xml: true });

    const articles: GoogleNewsArticle[] = [];

    parsedFeed("item").each((_index: number, element: AnyNode) => {
      if (articles.length >= clampedLimit) return false;

      const $item = parsedFeed(element);
      const rawTitle = $item.find("title").first().text().trim();
      const rawLink = $item.find("link").first().text().trim();
      const rawSource = $item.find("source").first().text().trim();
      const rawPubDate = $item.find("pubDate").first().text().trim();

      if (rawTitle && rawLink) {
        const parsedDate = rawPubDate ? new Date(rawPubDate) : null;
        articles.push({
          title: rawTitle,
          url: rawLink,
          source: rawSource || "Unknown",
          publishedAt: rawPubDate,
          publishedAtIso: parsedDate && !isNaN(parsedDate.getTime())
            ? parsedDate.toISOString()
            : "",
        });
      }
    });

    return {
      query: query || null,
      topic: topic || null,
      locale,
      countryEdition,
      limit: clampedLimit,
      results: articles,
      totalResults: articles.length,
      provider: "google_news_rss",
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        error: `Google News RSS request timed out after ${FETCH_TIMEOUT_MS}ms`,
        url: rssUrl,
      };
    }
    return {
      error: `Google News RSS fetch failed: ${errorMessage(error)}`,
      url: rssUrl,
    };
  } finally {
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }
  }
}

// ────────────────────────────────────────────────────────────
// Image Search (Brave)
// ────────────────────────────────────────────────────────────

export async function agenticImageSearch(
  query: string,
  {
    limit = 20,
    safesearch = "off",
  }: {
    limit?: number;
    safesearch?: string;
  } = {},
) {
  if (!query || typeof query !== "string") {
    return { error: "'query' is required and must be a non-empty string" };
  }

  if (!CONFIG.BRAVE_SEARCH_API_KEY) {
    return { error: "Image search requires a Brave Search API key" };
  }

  const clampedLimit = Math.min(Math.max(Number(limit) || 20, 1), 150);

  const params = new URLSearchParams({
    q: query,
    count: String(clampedLimit),
    safesearch,
  });

  try {
    const response = await fetch(`${BRAVE_IMAGE_SEARCH_BASE}?${params}`, {
      headers: _buildBraveRequestHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 429) {
        return {
          error: "Brave Image Search rate limit exceeded.",
          query,
        };
      }
      return {
        error: `Brave Image Search API error: HTTP ${response.status} — ${body.slice(0, 500)}`,
        query,
      };
    }

    const data = await response.json();
    const imageResults = data.results || [];

    const results = imageResults.slice(0, clampedLimit).map((item: BraveImageItem) => ({
      title: item.title || "",
      sourceUrl: item.url || "",
      imageUrl: item.properties?.url || "",
      thumbnailUrl: item.thumbnail?.src || "",
      source: item.meta_url?.hostname || item.source || "",
      width: item.properties?.width || null,
      height: item.properties?.height || null,
      format: item.properties?.format || "",
      pageFetched: item.page_fetched || "",
    }));

    return {
      query,
      limit: clampedLimit,
      results,
      totalResults: imageResults.length,
      provider: SEARCH_PROVIDER.BRAVE,
    };
  } catch (error: unknown) {
    return {
      error: `Image search failed: ${errorMessage(error)}`,
      query,
    };
  }
}

// ────────────────────────────────────────────────────────────
// Video Search (Brave)
// ────────────────────────────────────────────────────────────

export async function agenticVideoSearch(
  query: string,
  {
    limit = 20,
    dateRestrict,
    safesearch = "off",
  }: {
    limit?: number;
    dateRestrict?: string;
    safesearch?: string;
  } = {},
) {
  if (!query || typeof query !== "string") {
    return { error: "'query' is required and must be a non-empty string" };
  }

  if (!CONFIG.BRAVE_SEARCH_API_KEY) {
    return { error: "Video search requires a Brave Search API key" };
  }

  const clampedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const params = new URLSearchParams({
    q: query,
    count: String(clampedLimit),
    text_decorations: "false",
    safesearch,
  });

  if (dateRestrict) {
    const freshnessMap: Record<string, string> = {
      d1: "pd", d7: "pw", w1: "pw", w2: "pw",
      m1: "pm", m3: "pm", y1: "py",
    };
    const freshness = freshnessMap[dateRestrict] || dateRestrict;
    params.set("freshness", freshness);
  }

  try {
    const response = await fetch(`${BRAVE_VIDEO_SEARCH_BASE}?${params}`, {
      headers: _buildBraveRequestHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 429) {
        return {
          error: "Brave Video Search rate limit exceeded.",
          query,
        };
      }
      return {
        error: `Brave Video Search API error: HTTP ${response.status} — ${body.slice(0, 500)}`,
        query,
      };
    }

    const data = await response.json();
    const videoResults = data.results || [];

    const results = videoResults.slice(0, clampedLimit).map((item: BraveVideoItem) => ({
      title: item.title || "",
      url: item.url || "",
      snippet: item.description?.trim() || "",
      source: item.meta_url?.hostname || "",
      age: item.age || "",
      pageAge: item.page_age || "",
      thumbnailUrl: item.thumbnail?.src || "",
      duration: item.video?.duration || "",
      views: item.video?.views || null,
      creator: item.video?.creator || item.video?.publisher || "",
    }));

    return {
      query,
      limit: clampedLimit,
      results,
      totalResults: videoResults.length,
      provider: SEARCH_PROVIDER.BRAVE,
    };
  } catch (error: unknown) {
    return {
      error: `Video search failed: ${errorMessage(error)}`,
      query,
    };
  }
}
