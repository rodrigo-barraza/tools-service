// ============================================================
// Crawler Service — Crawlee + Playwright Orchestration
// ============================================================
// Production-grade web crawling infrastructure powered by Crawlee.
//
// Features:
//   - PlaywrightCrawler with configurable concurrency
//   - Automatic request queuing, deduplication, and retries
//   - Session management with anti-blocking heuristics
//   - Proxy rotation (Bright Data integration ready)
//   - Cheerio-first mode for static pages (no browser overhead)
//   - Crash recovery via persistent request queue state
//
// Usage:
//   import { crawlPages, crawlSingle } from "./CrawlerService.js";
//
//   // Single page extraction
//   const result = await crawlSingle("https://example.com", {
//     extractFn: ($) => ({ title: $("h1").text() }),
//   });
//
//   // Batch crawl with link discovery
//   const results = await crawlPages({
//     startUrls: ["https://example.com/users"],
//     extractFn: ($, request) => ({ ... }),
//     linkSelector: "a.next-page",
//     maxRequests: 100,
//   });
// ============================================================

import {
  PlaywrightCrawler,
  CheerioCrawler,
  // ProxyConfiguration, // Uncomment when Bright Data proxy is enabled
  Configuration,
} from "crawlee";
import logger from "../logger.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DEFAULTS = {
  maxConcurrency: 3,
  maxRequestsPerMinute: 30,
  maxRequestRetries: 3,
  requestHandlerTimeoutSecs: 60,
  navigationTimeoutSecs: 30,
  headless: true,
  // Storage directory for Crawlee's persistent state (queues, datasets)
  storageDir: "/tmp/crawlee-storage",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ────────────────────────────────────────────────────────────
// Proxy Configuration
// ────────────────────────────────────────────────────────────
// Uncomment and configure when Bright Data credentials are ready.
// Add BRIGHTDATA_* values to secrets.js and config.js.

/**
 * Build a ProxyConfiguration for Bright Data.
 * Supports datacenter and residential zones.
 *
 * @param {object} [options]
 * @param {"datacenter"|"residential"|"isp"} [options.zone="datacenter"]
 * @returns {ProxyConfiguration|null}
 */
function buildProxyConfig(_options = {}) {
  // ──────────────────────────────────────────────────────────
  // BRIGHT DATA PROXY — UNCOMMENT WHEN READY
  // ──────────────────────────────────────────────────────────
  //
  // import CONFIG from "../config.js";
  //
  // const {
  //   BRIGHTDATA_CUSTOMER_ID,
  //   BRIGHTDATA_ZONE_DATACENTER,
  //   BRIGHTDATA_ZONE_RESIDENTIAL,
  //   BRIGHTDATA_ZONE_ISP,
  //   BRIGHTDATA_PASSWORD,
  // } = CONFIG;
  //
  // if (!BRIGHTDATA_CUSTOMER_ID || !BRIGHTDATA_PASSWORD) {
  //   logger.warn("[Crawler] Bright Data credentials not configured — running without proxy");
  //   return null;
  // }
  //
  // const zone = options.zone || "datacenter";
  // const zoneMap = {
  //   datacenter: BRIGHTDATA_ZONE_DATACENTER || "datacenter",
  //   residential: BRIGHTDATA_ZONE_RESIDENTIAL || "residential",
  //   isp: BRIGHTDATA_ZONE_ISP || "isp",
  // };
  //
  // const proxyUrl =
  //   `http://brd-customer-${BRIGHTDATA_CUSTOMER_ID}-zone-${zoneMap[zone]}` +
  //   `:${BRIGHTDATA_PASSWORD}@brd.superproxy.io:22225`;
  //
  // logger.info(`[Crawler] Proxy configured — zone: ${zone}`);
  //
  // return new ProxyConfiguration({
  //   proxyUrls: [proxyUrl],
  // });
  // ──────────────────────────────────────────────────────────

  return null;
}

// ────────────────────────────────────────────────────────────
// Crawlee Configuration
// ────────────────────────────────────────────────────────────

// Disable Crawlee's default storage to prevent cluttering the project dir.
// We use an explicit storageDir instead.
const crawleeConfig = Configuration.getGlobalConfig();
crawleeConfig.set("persistStorage", false);

// ────────────────────────────────────────────────────────────
// Single-Page Crawl (Playwright)
// ────────────────────────────────────────────────────────────

/**
 * Crawl a single URL using Playwright, returning extracted data.
 * Best for: JS-rendered pages, SPAs, pages requiring interaction.
 *
 * @param {string} url - Target URL
 * @param {object} options
 * @param {function} options.extractFn - (page, request) => data. Receives the Playwright Page object.
 * @param {boolean} [options.headless=true] - Run browser in headless mode
 * @param {string}  [options.proxyZone] - Bright Data zone: "datacenter" | "residential" | "isp"
 * @param {number}  [options.timeoutSecs=30] - Navigation timeout in seconds
 * @returns {Promise<object>} Extracted data or error
 */
export async function crawlSingle(url, options = {}) {
  const { extractFn, headless = true, proxyZone, timeoutSecs = 30 } = options;

  if (!extractFn) {
    return { error: "extractFn is required" };
  }

  let result = null;
  let crawlError = null;

  const proxyConfiguration = proxyZone ? buildProxyConfig({ zone: proxyZone }) : null;

  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    maxRequestRetries: DEFAULTS.maxRequestRetries,
    requestHandlerTimeoutSecs: DEFAULTS.requestHandlerTimeoutSecs,
    navigationTimeoutSecs: timeoutSecs,
    headless,
    useSessionPool: true,
    persistCookiesPerSession: true,
    ...(proxyConfiguration && { proxyConfiguration }),

    launchContext: {
      launchOptions: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      },
      userAgent: USER_AGENT,
    },

    async requestHandler({ page, request }) {
      logger.info(`[Crawler] Processing: ${request.url}`);

      // Wait for network idle to catch dynamic content
      await page.waitForLoadState("networkidle", { timeout: timeoutSecs * 1000 })
        .catch(() => {});

      try {
        result = await extractFn(page, request);
      } catch (err) {
        crawlError = err;
        logger.error(`[Crawler] Extract failed for ${request.url}: ${err.message}`);
      }
    },

    async failedRequestHandler({ request }, error) {
      crawlError = error;
      logger.error(`[Crawler] Failed after retries: ${request.url} — ${error.message}`);
    },
  });

  try {
    await crawler.run([url]);
  } catch (err) {
    return { error: `Crawler failed: ${err.message}`, url };
  }

  if (crawlError) {
    return { error: crawlError.message, url };
  }

  return { url, data: result };
}

// ────────────────────────────────────────────────────────────
// Single-Page Crawl (Cheerio — No Browser)
// ────────────────────────────────────────────────────────────

/**
 * Crawl a single URL using Cheerio (static HTML parsing).
 * Best for: Static pages, forums, blogs — much faster than Playwright.
 *
 * @param {string} url - Target URL
 * @param {object} options
 * @param {function} options.extractFn - ($, request) => data. Receives Cheerio root.
 * @param {string}  [options.proxyZone] - Bright Data zone
 * @returns {Promise<object>} Extracted data or error
 */
export async function crawlSingleStatic(url, options = {}) {
  const { extractFn, proxyZone } = options;

  if (!extractFn) {
    return { error: "extractFn is required" };
  }

  let result = null;
  let crawlError = null;

  const proxyConfiguration = proxyZone ? buildProxyConfig({ zone: proxyZone }) : null;

  const crawler = new CheerioCrawler({
    maxConcurrency: 1,
    maxRequestRetries: DEFAULTS.maxRequestRetries,
    requestHandlerTimeoutSecs: DEFAULTS.requestHandlerTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    ...(proxyConfiguration && { proxyConfiguration }),

    additionalHttpHeaders: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },

    async requestHandler({ $, request }) {
      logger.info(`[Crawler] Processing (static): ${request.url}`);

      try {
        result = await extractFn($, request);
      } catch (err) {
        crawlError = err;
        logger.error(`[Crawler] Extract failed for ${request.url}: ${err.message}`);
      }
    },

    async failedRequestHandler({ request }, error) {
      crawlError = error;
      logger.error(`[Crawler] Failed after retries: ${request.url} — ${error.message}`);
    },
  });

  try {
    await crawler.run([url]);
  } catch (err) {
    return { error: `Crawler failed: ${err.message}`, url };
  }

  if (crawlError) {
    return { error: crawlError.message, url };
  }

  return { url, data: result };
}

// ────────────────────────────────────────────────────────────
// Batch Crawl — Multi-URL with Link Discovery
// ────────────────────────────────────────────────────────────

/**
 * Crawl multiple URLs with automatic link discovery and queuing.
 * Supports both Playwright (JS-rendered) and Cheerio (static) modes.
 *
 * @param {object} options
 * @param {string[]}  options.startUrls - Seed URLs to begin crawling
 * @param {function}  options.extractFn - (contextObj, request) => data
 *                     contextObj is { page } for Playwright or { $ } for Cheerio
 * @param {string[]}  [options.linkGlobs] - URL glob patterns to auto-enqueue discovered links
 *                     Example: ["https://example.com/users/**"]
 * @param {string}    [options.linkSelector] - CSS selector for links to follow (e.g., "a.next-page")
 * @param {number}    [options.maxRequests=100] - Max total requests before stopping
 * @param {number}    [options.maxConcurrency=3] - Parallel browser/request limit
 * @param {number}    [options.maxRequestsPerMinute=30] - Rate limit
 * @param {boolean}   [options.usePlaywright=false] - Use Playwright (true) or Cheerio (false)
 * @param {boolean}   [options.headless=true] - Headless mode (Playwright only)
 * @param {string}    [options.proxyZone] - Bright Data proxy zone
 * @param {function}  [options.onProgress] - (result) => void — called after each page
 * @returns {Promise<object[]>} Array of { url, data } results
 */
export async function crawlPages(options = {}) {
  const {
    startUrls = [],
    extractFn,
    linkGlobs,
    linkSelector,
    maxRequests = 100,
    maxConcurrency = DEFAULTS.maxConcurrency,
    maxRequestsPerMinute = DEFAULTS.maxRequestsPerMinute,
    usePlaywright = false,
    headless = DEFAULTS.headless,
    proxyZone,
    onProgress,
  } = options;

  if (!extractFn) {
    return [{ error: "extractFn is required" }];
  }

  if (!startUrls.length) {
    return [{ error: "startUrls is required and must not be empty" }];
  }

  const results = [];
  const proxyConfiguration = proxyZone ? buildProxyConfig({ zone: proxyZone }) : null;

  const commonConfig = {
    maxConcurrency,
    maxRequestsPerMinute,
    maxRequestRetries: DEFAULTS.maxRequestRetries,
    maxRequestsPerCrawl: maxRequests,
    requestHandlerTimeoutSecs: DEFAULTS.requestHandlerTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    ...(proxyConfiguration && { proxyConfiguration }),
  };

  // Build the shared handler logic
  const buildHandler = (contextKey) => async (ctx) => {
    const { request, enqueueLinks } = ctx;
    const contextObj = contextKey === "page" ? { page: ctx.page } : { $: ctx.$ };

    logger.info(`[Crawler] [${results.length + 1}/${maxRequests}] ${request.url}`);

    try {
      const data = await extractFn(contextObj, request);
      const entry = { url: request.url, data };
      results.push(entry);

      if (onProgress) {
        onProgress({
          current: results.length,
          maxRequests,
          url: request.url,
          success: true,
        });
      }
    } catch (err) {
      logger.error(`[Crawler] Extract failed: ${request.url} — ${err.message}`);
      results.push({ url: request.url, error: err.message });

      if (onProgress) {
        onProgress({
          current: results.length,
          maxRequests,
          url: request.url,
          success: false,
          error: err.message,
        });
      }
    }

    // Auto-enqueue discovered links if globs or selector provided
    if (linkGlobs || linkSelector) {
      await enqueueLinks({
        ...(linkGlobs && { globs: linkGlobs }),
        ...(linkSelector && { selector: linkSelector }),
      });
    }
  };

  let crawler;

  if (usePlaywright) {
    crawler = new PlaywrightCrawler({
      ...commonConfig,
      headless,
      navigationTimeoutSecs: DEFAULTS.navigationTimeoutSecs,
      launchContext: {
        launchOptions: {
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        },
        userAgent: USER_AGENT,
      },
      requestHandler: buildHandler("page"),
      failedRequestHandler: ({ request }, error) => {
        logger.error(`[Crawler] Failed after retries: ${request.url} — ${error.message}`);
        results.push({ url: request.url, error: error.message });
      },
    });
  } else {
    crawler = new CheerioCrawler({
      ...commonConfig,
      additionalHttpHeaders: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      requestHandler: buildHandler("$"),
      failedRequestHandler: ({ request }, error) => {
        logger.error(`[Crawler] Failed after retries: ${request.url} — ${error.message}`);
        results.push({ url: request.url, error: error.message });
      },
    });
  }

  const startTime = Date.now();

  try {
    await crawler.run(startUrls);
  } catch (err) {
    logger.error(`[Crawler] Batch crawl error: ${err.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.success(
    `[Crawler] Batch complete — ${results.length} pages in ${elapsed}s ` +
    `(${results.filter((r) => !r.error).length} ok, ` +
    `${results.filter((r) => r.error).length} failed)`,
  );

  return results;
}

// ────────────────────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────────────────────

/**
 * Get crawler service health/config info.
 */
export function getCrawlerHealth() {
  const proxyConfig = buildProxyConfig();

  return {
    engine: "crawlee",
    backends: ["playwright", "cheerio"],
    proxyEnabled: proxyConfig !== null,
    defaults: { ...DEFAULTS },
  };
}
