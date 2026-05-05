import CONFIG from "./config.js";
import crypto from "node:crypto";
import { USER_AGENTS, EPHEMERAL_TTL_MS, EPHEMERAL_MAX_SIZE } from "./constants.js";

// ─── Shared Utilities ──────────────────────────────────────────────

/**
 * Pick a random user-agent string.
 */
export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

// ─── Ephemeral Store ──────────────────────────────────────────

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
