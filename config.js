import {
  // Server
  TOOLS_PORT,
  MONGO_URI,

  // Event
  TICKETMASTER_API_KEY,
  SEATGEEK_CLIENT_ID,
  TMDB_API_KEY,
  GOOGLE_PLACES_API_KEY,

  // Finance (Finnhub)
  FINNHUB_API_KEY,

  // Finance (FRED)
  FRED_API_KEY,

  // Product
  BESTBUY_API_KEY,
  PRODUCTHUNT_API_KEY,
  PRODUCTHUNT_API_SECRET,
  EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET,
  ETSY_API_KEY,
  ETSY_SHARED_SECRET,

  // Trend
  REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET,
  REDDIT_USER_AGENT,
  X_BEARER_TOKEN,

  // Weather
  TOMORROWIO_API_KEY,
  NASA_API_KEY,
  GOOGLE_API_KEY,
  GOOGLE_CSE_CX,

  // Web Search
  BRAVE_SEARCH_API_KEY,

  // Transit
  TRANSLINK_API_KEY,

  // Utility
  IPINFO_TOKEN,

  // Maritime
  AIS_STREAM_API_KEY,

  // Energy
  EIA_API_KEY,
} from "./secrets.js";

const CONFIG = {
  // ─── Server ──────────────────────────────────────────────────────
  TOOLS_PORT: TOOLS_PORT || 5590,
  MONGODB_URI: MONGO_URI || "mongodb://192.168.86.2:27017/tools?directConnection=true&replicaSet=rs0",

  // ─── Location (populated dynamically by LocationService.initLocation()) ───
  // Defaults act as fallbacks if initLocation() hasn't run yet.
  LATITUDE: 0,
  LONGITUDE: 0,
  RADIUS_MILES: 50,
  TIMEZONE: "UTC",
  TIDE_STATION_ID: null,

  // ─── Event ───────────────────────────────────────────────────────
  TICKETMASTER_API_KEY,
  SEATGEEK_CLIENT_ID,
  TMDB_API_KEY,
  GOOGLE_PLACES_API_KEY,

  // ─── Finance (Finnhub) ────────────────────────────────────────────
  FINNHUB_API_KEY,

  // ─── Finance (FRED) ──────────────────────────────────────────────
  FRED_API_KEY,

  // ─── Product ─────────────────────────────────────────────────────
  BESTBUY_API_KEY,
  PRODUCTHUNT_API_KEY,
  PRODUCTHUNT_API_SECRET,
  EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET,
  ETSY_API_KEY,
  ETSY_SHARED_SECRET,

  // ─── Trend ───────────────────────────────────────────────────────
  REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET,
  REDDIT_USER_AGENT: REDDIT_USER_AGENT || "sun:tools:v0.1.0",
  X_BEARER_TOKEN,

  // ─── Weather ─────────────────────────────────────────────────────
  TOMORROWIO_API_KEY,
  NASA_API_KEY: NASA_API_KEY || "DEMO_KEY",
  GOOGLE_API_KEY,
  GOOGLE_CSE_CX,

  // ─── Web Search ───────────────────────────────────────────────────
  BRAVE_SEARCH_API_KEY,

  // ─── Transit ─────────────────────────────────────────────────────
  TRANSLINK_API_KEY,

  // ─── Utility ─────────────────────────────────────────────────────
  IPINFO_TOKEN,

  // ─── Maritime ────────────────────────────────────────────────────
  AIS_STREAM_API_KEY,

  // ─── Energy ──────────────────────────────────────────────────────
  EIA_API_KEY,
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
