import {
  // Server
  TOOLS_PORT,
  MONGODB_URI,

  // Location
  LATITUDE,
  LONGITUDE,
  RADIUS_MILES,
  TIMEZONE,
  TIDE_STATION_ID,

  // Event
  TICKETMASTER_API_KEY,
  SEATGEEK_CLIENT_ID,
  TMDB_API_KEY,
  GOOGLE_PLACES_API_KEY,

  // Finance (Finnhub)
  FINNHUB_API_KEY,

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

  // Transit
  TRANSLINK_API_KEY,
} from "./secrets.js";

const CONFIG = {
  // ─── Server ──────────────────────────────────────────────────────
  TOOLS_PORT: TOOLS_PORT || 5590,
  MONGODB_URI: MONGODB_URI || "mongodb://localhost:27017/tools",

  // ─── Location ────────────────────────────────────────────────────
  LATITUDE: LATITUDE || 49.2827,
  LONGITUDE: LONGITUDE || -123.1207,
  RADIUS_MILES: RADIUS_MILES || 50,
  TIMEZONE: TIMEZONE || "America/Vancouver",
  TIDE_STATION_ID: TIDE_STATION_ID || "9449880",

  // ─── Event ───────────────────────────────────────────────────────
  TICKETMASTER_API_KEY,
  SEATGEEK_CLIENT_ID,
  TMDB_API_KEY,
  GOOGLE_PLACES_API_KEY,

  // ─── Finance (Finnhub) ────────────────────────────────────────────
  FINNHUB_API_KEY,

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

  // ─── Transit ─────────────────────────────────────────────────────
  TRANSLINK_API_KEY,
};

export default CONFIG;
