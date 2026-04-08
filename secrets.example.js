// ============================================================
// Tools API — Secrets Template
// ============================================================
// Copy this file to secrets.js and fill in your real values.
//   cp secrets.example.js secrets.js
// ============================================================

// ─── Server ────────────────────────────────────────────────────────

export const TOOLS_PORT = 5590;

// ─── Workspace Roots ───────────────────────────────────────────────
// REQUIRED — comma-separated absolute paths the agentic tools are allowed to access.
// tools-api will refuse to start if this is empty.
// Example: '/home/youruser/projects/sun,/home/youruser/other-repo'
export const WORKSPACE_ROOT = '';

// ─── MongoDB ───────────────────────────────────────────────────────

export const MONGO_URI = "mongodb://192.168.86.2:27017/tools?directConnection=true&replicaSet=rs0";

// ─── Location ──────────────────────────────────────────────────────
// Resolved dynamically from server IP geolocation + NOAA.
// Cached in MongoDB `location_config` collection (24h TTL).
// See: services/LocationService.js

// ─── Event Domain ──────────────────────────────────────────────────

export const TICKETMASTER_API_KEY = "";
export const SEATGEEK_CLIENT_ID = "";
export const TMDB_API_KEY = "";
export const GOOGLE_PLACES_API_KEY = "";

// ─── Market Domain ─────────────────────────────────────────────────

// (Uses yahoo-finance2 — no API key needed)

// ─── Finance Domain (Finnhub) ──────────────────────────────────────

export const FINNHUB_API_KEY = "";

// ─── Finance Domain (FRED — Federal Reserve Economic Data) ─────────
//    Register at https://fred.stlouisfed.org/docs/api/api_key.html
//    Free — 120 requests/minute.

export const FRED_API_KEY = "";

// ─── Product Domain ────────────────────────────────────────────────

export const BESTBUY_API_KEY = "";
export const PRODUCTHUNT_API_KEY = "";
export const PRODUCTHUNT_API_SECRET = "";
export const EBAY_CLIENT_ID = "";
export const EBAY_CLIENT_SECRET = "";
export const ETSY_API_KEY = "";
export const ETSY_SHARED_SECRET = "";

// ─── Trend Domain ──────────────────────────────────────────────────

export const REDDIT_CLIENT_ID = "";
export const REDDIT_CLIENT_SECRET = "";
export const REDDIT_USER_AGENT = "sun:tools:v0.1.0 (by /u/YOUR_USERNAME)";
export const X_BEARER_TOKEN = "";

// ─── Weather Domain ────────────────────────────────────────────────

export const TOMORROWIO_API_KEY = "";
export const NASA_API_KEY = "DEMO_KEY";
export const GOOGLE_API_KEY = "";
export const GOOGLE_CSE_CX = "";

// ─── Web Search Domain ─────────────────────────────────────────────
//    Brave Search API — 2,000 queries/month free.
//    Register at https://api.search.brave.com

export const BRAVE_SEARCH_API_KEY = "";

// ─── Transit Domain ───────────────────────────────────────────────
//    Register at https://developer.translink.ca/ for a free key.

export const TRANSLINK_API_KEY = "";

// ─── Utility Domain (IPinfo) ──────────────────────────────────────
//    Register at https://ipinfo.io/signup for a free token.
//    Free tier: 50,000 requests/month.

export const IPINFO_TOKEN = "";

// ─── Maritime Domain (AIS Stream) ─────────────────────────────────
//    Register at https://aisstream.io/authenticate (GitHub login).
//    Free — WebSocket-based. 1 subscription update/second.

export const AIS_STREAM_API_KEY = "";

// ─── Energy Domain (EIA) ──────────────────────────────────────────
//    Register at https://www.eia.gov/opendata/ for a free key.
//    Free — undocumented rate limit; key auto-suspended if exceeded.

export const EIA_API_KEY = "";

// ─── Communication Domain (Twilio) ────────────────────────────────
//    Twilio — Programmable SMS, Voice, Lookup.
//    Register at https://www.twilio.com/console
//    Free trial includes a phone number + $15 credit.

export const TWILIO_ACCOUNT_SID = "";
export const TWILIO_AUTH_TOKEN = "";
