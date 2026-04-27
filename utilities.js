import CONFIG from "./config.js";
import { USER_AGENTS } from "./constants.js";

// ─── Shared Utilities ──────────────────────────────────────────────

/**
 * Async sleep for rate-limiting.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pick a random user-agent string.
 */
export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Safely parse a price string like "$29.99" or "29.99" into a number.
 */
export function parsePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = String(priceStr).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Text Utilities ────────────────────────────────────────────────

/**
 * Normalize a name/title for deduplication and matching.
 * Strips non-alphanumeric chars, lowercases, collapses whitespace.
 * @param {string} str
 * @returns {string}
 */
export function normalizeName(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Strip HTML tags from a string and decode common HTML entities.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── XML Utilities ─────────────────────────────────────────────────

/**
 * Extract the text content of an XML tag (supports CDATA, namespaced tags).
 * @param {string} xml - XML string to search
 * @param {string} tag - Tag name (e.g. "title", "ht:approx_traffic")
 * @returns {string|null} Tag content or null
 */
export function extractXmlTag(xml, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<${escapedTag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escapedTag}>|<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`,
  );
  const match = xml.match(regex);
  if (!match) return null;
  return (match[1] || match[2] || "").trim();
}

/**
 * Extract all occurrences of an XML element from a string.
 * @param {string} xml - Full XML body
 * @param {string} tag - Element tag name (e.g. "item")
 * @returns {string[]} Array of raw element blocks
 */
export function extractXmlItems(xml, tag) {
  const items = [];
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let cursor = 0;

  while (true) {
    const start = xml.indexOf(openTag, cursor);
    if (start === -1) break;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    items.push(xml.slice(start, end + closeTag.length));
    cursor = end + closeTag.length;
  }

  return items;
}

// ─── Array Utilities ───────────────────────────────────────────────

/**
 * Batch an array into chunks of a given size.
 * @param {Array} array
 * @param {number} size
 * @returns {Array[]}
 */
export function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ─── Route Utilities ───────────────────────────────────────────────

/**
 * Parse an integer query param with a default fallback and optional max clamp.
 * Replaces the repeated `Math.min(parseInt(req.query.X) || default, max)` pattern.
 * @param {string|undefined} value - Raw query string value
 * @param {number} defaultValue
 * @param {number} [max] - Optional upper bound (clamped via Math.min)
 * @returns {number}
 */
export function parseIntParam(value, defaultValue, max) {
  if (value == null) return defaultValue;
  const parsed = parseInt(value, 10);
  const result = isNaN(parsed) ? defaultValue : parsed;
  return max != null ? Math.min(result, max) : result;
}

// ─── Scraping Utilities ────────────────────────────────────────────

/**
 * Build browser-like headers for web scraping requests.
 * @param {string} [referer] - Optional Referer header
 * @returns {object}
 */
export function buildScraperHeaders(referer) {
  const headers = {
    "User-Agent": randomUserAgent(),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
  };
  if (referer) headers.Referer = referer;
  return headers;
}

// ─── OAuth Token Manager ───────────────────────────────────────────

/**
 * Reusable OAuth2 client-credentials token manager with caching.
 * Handles token expiry and automatic refresh.
 */
export class TokenManager {
  #token = null;
  #expiry = 0;
  #fetchFn;

  /**
   * @param {Function} fetchFn - Async function that returns { token, expiresInMs }
   */
  constructor(fetchFn) {
    this.#fetchFn = fetchFn;
  }

  /**
   * Get a valid token, refreshing if expired.
   * @returns {Promise<string>}
   */
  async getToken() {
    if (this.#token && Date.now() < this.#expiry) return this.#token;
    const { token, expiresInMs } = await this.#fetchFn();
    this.#token = token;
    this.#expiry = Date.now() + expiresInMs;
    return this.#token;
  }

  /** Invalidate the cached token (e.g. on 401). */
  invalidate() {
    this.#token = null;
    this.#expiry = 0;
  }
}

// ─── Event Utilities ───────────────────────────────────────────────

/**
 * Build a Google Static Maps API URL for a given lat/lng.
 */
export function buildStaticMapUrl(
  latitude,
  longitude,
  {
    zoom = 14,
    size = "400x300",
    maptype = "roadmap",
    markerColor = "red",
  } = {},
) {
  if (!CONFIG.GOOGLE_PLACES_API_KEY || !latitude || !longitude) return null;

  const params = new URLSearchParams({
    center: `${latitude},${longitude}`,
    zoom: zoom.toString(),
    size,
    maptype,
    markers: `color:${markerColor}|${latitude},${longitude}`,
    key: CONFIG.GOOGLE_PLACES_API_KEY,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}

/**
 * Enrich an event with a static map URL if it has coordinates.
 */
export function enrichEventWithMapUrl(event) {
  if (!event?.venue?.latitude || !event?.venue?.longitude) return event;

  event.mapImageUrl = buildStaticMapUrl(
    event.venue.latitude,
    event.venue.longitude,
  );

  return event;
}

// ─── Product Utilities ─────────────────────────────────────────────

/**
 * Map a source-specific category string to a unified category.
 */
export function normalizeCategory(sourceCategory, categoryMappings) {
  if (!sourceCategory) return "other";
  const lower = sourceCategory.toLowerCase();
  const match = categoryMappings.find(
    (m) =>
      m.name.toLowerCase() === lower ||
      m.slug?.toLowerCase() === lower ||
      m.id?.toLowerCase() === lower,
  );
  return match?.unified || "other";
}

/**
 * Compute a composite trending score for cross-source ranking.
 */
export function computeTrendingScore(product) {
  const rankScore = product.rank ? Math.max(0, 100 - product.rank) : 50;
  const ratingScore = (product.rating || 0) * 4;
  const reviewScore = product.reviewCount
    ? Math.min(20, Math.log10(product.reviewCount + 1) * 5)
    : 0;
  const ageHours = product.fetchedAt
    ? (Date.now() - new Date(product.fetchedAt).getTime()) / 3_600_000
    : 24;
  const recencyScore = Math.max(0, 10 - ageHours * 0.5);

  return (
    Math.round((rankScore + ratingScore + reviewScore + recencyScore) * 10) / 10
  );
}

// ─── Route Handler Wrapper ────────────────────────────────────────

/**
 * Wrap an async route handler with standard error catching.
 * The wrapped function should return the JSON payload (or call res directly for non-standard flows).
 *
 * @param {Function} fn - (req, res) => Promise<any> — return value is sent as JSON
 * @param {string} label - Error context label (e.g. "Dictionary lookup")
 * @param {number|object} [errorStatusOrOpts=502] - HTTP status on error, or options object
 * @param {number} [errorStatusOrOpts.errorStatus=502] - HTTP status on error
 * @param {HealthTracker} [errorStatusOrOpts.health] - Optional HealthTracker to update
 * @returns {Function} Express middleware
 */
export function asyncHandler(fn, label, errorStatusOrOpts = 502) {
  const errorStatus = typeof errorStatusOrOpts === "number" ? errorStatusOrOpts : (errorStatusOrOpts.errorStatus || 502);
  const health = typeof errorStatusOrOpts === "object" ? errorStatusOrOpts.health : undefined;
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      if (health) health.markSuccess();
      if (result !== undefined) res.json(result);
    } catch (err) {
      if (health) health.markError(err);
      res.status(errorStatus).json({ error: `${label} failed: ${err.message}` });
    }
  };
}

// ─── SSE Streaming Helper ─────────────────────────────────────────

/**
 * Set up a Server-Sent Events response with proper headers.
 * Returns a `send(event)` function that serializes objects as SSE data lines.
 * @param {import("express").Response} res
 * @returns {(event: object) => void}
 */
export function setupStreamingSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  return send;
}

// ─── Ephemeral Store ──────────────────────────────────────────────

import crypto from "node:crypto";
import { EPHEMERAL_TTL_MS, EPHEMERAL_MAX_SIZE } from "./constants.js";

/**
 * Generic in-memory ephemeral store backed by a Map with automatic
 * TTL expiry and lazy cleanup. Replaces the duplicated
 * Map + TTL + cleanup pattern used across CSV, QR, LaTeX, Diagram,
 * Map, and Chart stores.
 */
export class EphemeralStore {
  #map = new Map();
  #ttlMs;
  #maxSize;

  /**
   * @param {number} [ttlMs=EPHEMERAL_TTL_MS] - Entry time-to-live in milliseconds
   * @param {number} [maxSize=EPHEMERAL_MAX_SIZE] - Max entries before lazy cleanup
   */
  constructor(ttlMs = EPHEMERAL_TTL_MS, maxSize = EPHEMERAL_MAX_SIZE) {
    this.#ttlMs = ttlMs;
    this.#maxSize = maxSize;
  }

  /**
   * Store a value and return its generated ID.
   * @param {*} value - The data to store
   * @returns {string} A 12-character UUID prefix
   */
  set(value) {
    const id = crypto.randomUUID().slice(0, 12);
    this.#map.set(id, { value, createdAt: Date.now() });
    this.#cleanup();
    return id;
  }

  /**
   * Retrieve a stored value by ID. Returns null if expired or not found.
   * @param {string} id
   * @returns {*|null}
   */
  get(id) {
    const entry = this.#map.get(id);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.#ttlMs) {
      this.#map.delete(id);
      return null;
    }
    return entry.value;
  }

  /** Lazy cleanup — only runs when size exceeds the threshold. */
  #cleanup() {
    if (this.#map.size <= this.#maxSize) return;
    const now = Date.now();
    for (const [k, v] of this.#map) {
      if (now - v.createdAt > this.#ttlMs) this.#map.delete(k);
    }
  }
}

// ─── Date Utilities ───────────────────────────────────────────────

/**
 * Format a Date as an ISO date string (YYYY-MM-DD).
 * Replaces the repeated `date.toISOString().slice(0, 10)` pattern.
 * @param {Date} [date=new Date()] - The date to format
 * @returns {string}
 */
export function toISODate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// ─── Local URL Builder ────────────────────────────────────────

/**
 * Build a full local URL for this server (embed/download endpoints).
 * Replaces the repeated `http://localhost:${CONFIG.TOOLS_SERVICE_PORT}/...` pattern.
 * @param {string} routePath - Path after the port, e.g. "compute/csv/download"
 * @param {object} [params] - Query parameters as key-value pairs
 * @returns {string}
 */
export function buildLocalUrl(routePath, params) {
  const base = `http://localhost:${CONFIG.TOOLS_SERVICE_PORT}/${routePath}`;
  if (!params || Object.keys(params).length === 0) return base;
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
}

// ─── Agentic Route Handler ────────────────────────────────────

/**
 * Wrap an agentic service call with standard error-status mapping.
 * Agentic services return `{ error }` objects (not throw). This wrapper
 * maps "outside allowed"/"blocked" errors to 403, other errors to 400,
 * and sends the result as JSON on success.
 *
 * @param {(req: import("express").Request) => Promise<object>} fn
 * @returns {Function} Express middleware
 */
export function agenticHandler(fn) {
  return async (req, res) => {
    const result = await fn(req);
    if (result.error) {
      const isForbidden =
        result.error.includes("outside allowed") ||
        result.error.includes("blocked");
      return res.status(isForbidden ? 403 : 400).json(result);
    }
    res.json(result);
  };
}

// ─── Input Length Validation ──────────────────────────────────

/**
 * Validate that a string value does not exceed a maximum length.
 * Returns an error message string if exceeded, or null if valid.
 * @param {string} value - The string to validate
 * @param {number} maxLength - Maximum allowed length
 * @param {string} label - Human-readable label (e.g. "Code", "Command")
 * @returns {string|null} Error message or null
 */
export function validateMaxLength(value, maxLength, label) {
  if (value && value.length > maxLength) {
    return `${label} exceeds maximum length of ${maxLength.toLocaleString()} characters`;
  }
  return null;
}

// ─── HTML Embed Shell ─────────────────────────────────────────

/**
 * Build a standard HTML embed page shell. Used by LaTeX, Mermaid,
 * and future embed renderers to avoid duplicating the HTML boilerplate.
 * @param {object} options
 * @param {string} [options.headExtra] - Extra tags for <head> (stylesheets, etc.)
 * @param {string} options.styles - CSS to inject into a <style> block
 * @param {string} options.bodyContent - Inner HTML for <body>
 * @param {string} options.scripts - Script tags or inline scripts
 * @returns {string} Complete HTML document
 */
export function buildEmbedHtml({ headExtra = "", styles, bodyContent, scripts }) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${headExtra}<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:#0f172a;
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
    padding:24px;
  }
${styles}
</style>
</head><body>
${bodyContent}
${scripts}
<script>
  // Report rendered content dimensions to parent for iframe auto-resize
  function reportSize() {
    var el = document.body;
    var w = el.scrollWidth;
    var h = el.scrollHeight;
    if (w && h) {
      window.parent.postMessage({ type: "embed-resize", width: w, height: h }, "*");
    }
  }
  // Report after initial render, fonts, and any async rendering (KaTeX, Mermaid)
  requestAnimationFrame(function() { setTimeout(reportSize, 200); });
  window.addEventListener("load", function() { setTimeout(reportSize, 300); });
</${"script"}>
</body></html>`;
}

// ─── Health Tracker ───────────────────────────────────────────

/**
 * Reusable health-state tracker for route domains.
 * Replaces the duplicated `const state = { lastChecked, error }` +
 * `getXxxHealth()` + `state.lastChecked = new Date()` pattern
 * found in ClockCrew, Lights, Newgrounds, and Discord routes.
 */
export class HealthTracker {
  #state = { lastChecked: null, error: null };

  /** Return a snapshot of the current health state. */
  getHealth() {
    return { ...this.#state };
  }

  /** Mark a successful operation. */
  markSuccess() {
    this.#state.lastChecked = new Date();
    this.#state.error = null;
  }

  /** Mark a failed operation. */
  markError(err) {
    this.#state.error = typeof err === "string" ? err : err.message;
  }
}

// ─── Caller Context Extraction ────────────────────────────────

/**
 * Extract caller identity context from request headers.
 * Replaces the duplicated 5-line header extraction block in
 * CreativeRoutes (4 occurrences) and AgenticRoutes.
 * @param {import("express").Request} req
 * @returns {{ project: string, username: string, agent: string|null, traceId: string|null, agentSessionId: string|null }}
 */
export function extractCallerContext(req) {
  return {
    project: req.headers["x-project"] || "tools-api",
    username: req.headers["x-username"] || "system",
    agent: req.headers["x-agent"] || null,
    traceId: req.headers["x-trace-id"] || null,
    agentSessionId: req.headers["x-agent-session-id"] || null,
  };
}

// ─── Lazy Import Factory ──────────────────────────────────────

/**
 * Create a lazy-loading async getter for an ES module.
 * Replaces the duplicated `let mod; async function getMod() { ... }` pattern
 * used 6 times in ComputeRoutes.
 *
 * @param {string} specifier - The import specifier (e.g. "qrcode")
 * @param {(m: any) => any} [extract=m => m.default] - Extractor for the module export
 * @returns {() => Promise<any>}
 */
export function lazyImport(specifier, extract = (m) => m.default) {
  let cached;
  return async () => {
    if (!cached) cached = extract(await import(specifier));
    return cached;
  };
}

