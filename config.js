// ============================================================
// Tools API — Configuration
// ============================================================
// Typed accessor layer over process.env. The Vault service is
// the single source of truth — boot.js hydrates process.env
// from the Vault before any module imports run.
//
// This file contains NO defaults and NO secrets.
// ============================================================

/**
 * Parse a comma-separated env var into an array of strings.
 * Returns empty array if not set.
 */
function parseCommaSeparated(envKey) {
  const raw = process.env[envKey];
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}


// ── Workspace / Agentic ────────────────────────────────────────────
// Exported individually for AgenticFileService, AgenticGitService, etc.
export const WORKSPACE_ROOTS = parseCommaSeparated("WORKSPACE_ROOTS");
export const WORKTREE_DIR = process.env.WORKTREE_DIR;


const CONFIG = {
  // ─── Server ──────────────────────────────────────────────────────
  TOOLS_SERVICE_PORT: process.env.TOOLS_SERVICE_PORT,
  MONGODB_URI: process.env.MONGO_URI,

  // ─── Location (populated dynamically by LocationService.initLocation()) ───
  // Defaults act as fallbacks if initLocation() hasn't run yet.
  LATITUDE: 0,
  LONGITUDE: 0,
  RADIUS_MILES: 50,
  TIMEZONE: "UTC",
  TIDE_STATION_ID: null,

  // ─── Event ───────────────────────────────────────────────────────
  TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY,
  SEATGEEK_CLIENT_ID: process.env.SEATGEEK_CLIENT_ID,
  TMDB_API_KEY: process.env.TMDB_API_KEY,
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,

  // ─── Finance (Finnhub) ────────────────────────────────────────────
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,

  // ─── Finance (FRED) ──────────────────────────────────────────────
  FRED_API_KEY: process.env.FRED_API_KEY,

  // ─── Product ─────────────────────────────────────────────────────
  BESTBUY_API_KEY: process.env.BESTBUY_API_KEY,
  PRODUCTHUNT_API_KEY: process.env.PRODUCTHUNT_API_KEY,
  PRODUCTHUNT_API_SECRET: process.env.PRODUCTHUNT_API_SECRET,
  EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
  ETSY_API_KEY: process.env.ETSY_API_KEY,
  ETSY_SHARED_SECRET: process.env.ETSY_SHARED_SECRET,

  // ─── Trend ───────────────────────────────────────────────────────
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,

  // ─── Weather ─────────────────────────────────────────────────────
  TOMORROWIO_API_KEY: process.env.TOMORROWIO_API_KEY,
  NASA_API_KEY: process.env.NASA_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_CSE_CX: process.env.GOOGLE_CSE_CX,

  // ─── Web Search ───────────────────────────────────────────────────
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,

  // ─── Transit ─────────────────────────────────────────────────────
  TRANSLINK_API_KEY: process.env.TRANSLINK_API_KEY,

  // ─── Utility ─────────────────────────────────────────────────────
  IPINFO_TOKEN: process.env.IPINFO_TOKEN,

  // ─── Maritime ────────────────────────────────────────────────────
  AIS_STREAM_API_KEY: process.env.AIS_STREAM_API_KEY,

  // ─── Energy ──────────────────────────────────────────────────────
  EIA_API_KEY: process.env.EIA_API_KEY,

  // ─── Communication (Twilio) ─────────────────────────────────────
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,

  // ─── Prism (LLM Gateway) ────────────────────────────────────────
  PRISM_SERVICE_URL: process.env.PRISM_SERVICE_URL,

  // ─── Default AI Models (vault-backed) ───────────────────────────
  TOOLS_IMAGE_MODEL: process.env.TOOLS_IMAGE_MODEL,
  TOOLS_VISION_MODEL: process.env.TOOLS_VISION_MODEL,

  // ─── Smart Home (Lights) ────────────────────────────────────────
  LIGHTS_SERVICE_URL: process.env.LIGHTS_SERVICE_URL,

  // ─── MinIO (S3-compatible object storage) ───────────────────────
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
};

/**
 * Apply resolved location data onto the CONFIG singleton.
 * Called by server.js after LocationService.initLocation() completes.
 * @param {object} loc - Output from initLocation()
 */
export function applyLocation(loc) {
  CONFIG.LATITUDE = loc.latitude;
  CONFIG.LONGITUDE = loc.longitude;
  CONFIG.RADIUS_MILES = loc.radiusMiles;
  CONFIG.TIMEZONE = loc.timezone;
  CONFIG.TIDE_STATION_ID = loc.tideStationId;
}

export default CONFIG;
