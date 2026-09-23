// ── Workspace / Agentic ────────────────────────────────────────────
export const WORKTREE_DIR = process.env.WORKTREE_DIR;

// ── Location (mutable — populated dynamically by LocationService) ──
interface LocationData {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  timezone: string;
  tideStationId: string | null;
}

// ── Config Shape ───────────────────────────────────────────────────
interface ToolsServiceConfig {
  // Server
  TOOLS_SERVICE_PORT: string | undefined;
  TOOLS_SERVICE_URL: string | undefined;
  TOOLS_SERVICE_PUBLIC_URL: string | undefined;
  MONGODB_URI: string | undefined;
  MONGODB_DB_NAME: string;
  PRISM_MONGODB_DB_NAME: string;

  // Location (mutable)
  LATITUDE: number;
  LONGITUDE: number;
  RADIUS_MILES: number;
  TIMEZONE: string;
  TIDE_STATION_ID: string | null;

  // Event
  TICKETMASTER_API_KEY: string | undefined;
  SEATGEEK_CLIENT_ID: string | undefined;
  TMDB_API_KEY: string | undefined;
  GOOGLE_CLOUD_API_KEY: string | undefined;

  // Finance
  FINNHUB_API_KEY: string | undefined;
  FRED_API_KEY: string | undefined;

  // Product
  PRODUCTHUNT_API_KEY: string | undefined;
  PRODUCTHUNT_API_SECRET: string | undefined;
  EBAY_CLIENT_ID: string | undefined;
  EBAY_CLIENT_SECRET: string | undefined;
  ETSY_API_KEY: string | undefined;
  ETSY_SHARED_SECRET: string | undefined;

  // Knowledge
  CONTEXT7_API_KEY: string | undefined;

  // Music
  SPOTIFY_CLIENT_ID: string | undefined;
  SPOTIFY_CLIENT_SECRET: string | undefined;
  SPOTIFY_REDIRECT_URI: string | undefined;

  // Trend
  REDDIT_CLIENT_ID: string | undefined;
  REDDIT_CLIENT_SECRET: string | undefined;
  REDDIT_USER_AGENT: string | undefined;
  X_BEARER_TOKEN: string | undefined;

  // Weather / Search
  TOMORROWIO_API_KEY: string | undefined;
  NASA_API_KEY: string | undefined;
  GOOGLE_CSE_CX: string | undefined;
  BRAVE_SEARCH_API_KEY: string | undefined;
  SEARCH_PROVIDER_PRIORITY: "brave" | "duckduckgo";

  // Transit
  TRANSLINK_API_KEY: string | undefined;

  // Utility
  IPINFO_TOKEN: string | undefined;

  // Maritime
  AIS_STREAM_API_KEY: string | undefined;

  // Energy
  EIA_API_KEY: string | undefined;

  // Communication (Twilio)
  TWILIO_ACCOUNT_SID: string | undefined;
  TWILIO_AUTH_TOKEN: string | undefined;

  // Communication (Email — SMTP send / IMAP read)
  SMTP_HOST: string | undefined;
  SMTP_PORT: string | undefined;
  SMTP_USER: string | undefined;
  SMTP_PASS: string | undefined;
  SMTP_FROM: string | undefined;
  IMAP_HOST: string | undefined;
  IMAP_PORT: string | undefined;
  IMAP_USER: string | undefined;
  IMAP_PASS: string | undefined;

  // Prism (LLM Gateway)
  PRISM_SERVICE_URL: string | undefined;

  // Default AI Models
  TOOLS_IMAGE_MODEL: string | undefined;
  TOOLS_VISION_MODEL: string | undefined;

  // Smart Home
  LIGHTS_SERVICE_URL: string | undefined;

  // MinIO
  MINIO_ENDPOINT: string | undefined;
  MINIO_PUBLIC_URL: string | undefined;
  MINIO_ACCESS_KEY: string | undefined;
  MINIO_SECRET_KEY: string | undefined;

  // Workspace Agent
  AGENT_MAX_CONNECTIONS: string;

  // qBittorrent
  QBITTORRENT_URL: string | undefined;
  QBITTORRENT_USERNAME: string;
  QBITTORRENT_PASSWORD: string | undefined;

  // Lupos Bot API URL
  LUPOS_BOT_URL: string | undefined;

  // Security (HIBP)
  HIBP_API_KEY: string | undefined;

  // Calendar (Google)
  GOOGLE_CALENDAR_CREDENTIALS: string | undefined;

  // Notifications (ntfy.sh)
  NTFY_BASE_URL: string | undefined;
  NTFY_TOKEN: string | undefined;

  // Flights (AviationStack)
  AVIATIONSTACK_API_KEY: string | undefined;

  // Portal (Infrastructure Observability)
  PORTAL_SERVICE_URL: string | undefined;

  // Gaming (Steam Web API)
  STEAM_API_KEY: string | undefined;

  // Environment variables needed in services
  FFMPEG_PATH: string | undefined;
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: string | undefined;
  HOME_DIR: string | undefined;
}

const CONFIG: ToolsServiceConfig = {
  // ─── Server ──────────────────────────────────────────────────────
  TOOLS_SERVICE_PORT: process.env.TOOLS_SERVICE_PORT,
  TOOLS_SERVICE_URL: process.env.TOOLS_SERVICE_URL,
  TOOLS_SERVICE_PUBLIC_URL: process.env.TOOLS_SERVICE_PUBLIC_URL,
  MONGODB_URI: process.env.MONGO_URI,
  MONGODB_DB_NAME: process.env.TOOLS_SERVICE_MONGO_DB_NAME || "tools",
  // prism-service's database, where the global settings live (the workspace
  // agent secret, allowEnvFiles). A live test that boots both services on
  // test databases names prism's here too, or this reads production's.
  PRISM_MONGODB_DB_NAME: process.env.PRISM_SERVICE_MONGO_DB_NAME || "prism",

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
  GOOGLE_CLOUD_API_KEY: process.env.GOOGLE_CLOUD_API_KEY,

  // ─── Finance (Finnhub) ────────────────────────────────────────────
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,

  // ─── Finance (FRED) ──────────────────────────────────────────────
  FRED_API_KEY: process.env.FRED_API_KEY,

  // ─── Product ─────────────────────────────────────────────────────
  PRODUCTHUNT_API_KEY: process.env.PRODUCTHUNT_API_KEY,
  PRODUCTHUNT_API_SECRET: process.env.PRODUCTHUNT_API_SECRET,
  EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
  ETSY_API_KEY: process.env.ETSY_API_KEY,
  ETSY_SHARED_SECRET: process.env.ETSY_SHARED_SECRET,

  // ─── Knowledge ───────────────────────────────────────────────────
  CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY,

  // ─── Music ───────────────────────────────────────────────────────
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,

  // ─── Trend ───────────────────────────────────────────────────────
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,

  // ─── Weather ─────────────────────────────────────────────────────
  TOMORROWIO_API_KEY: process.env.TOMORROWIO_API_KEY,
  NASA_API_KEY: process.env.NASA_API_KEY,
  GOOGLE_CSE_CX: process.env.GOOGLE_CSE_CX,

  // ─── Web Search ───────────────────────────────────────────────────
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  SEARCH_PROVIDER_PRIORITY:
    (process.env.SEARCH_PROVIDER_PRIORITY as "brave" | "duckduckgo") || "brave",

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
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  IMAP_HOST: process.env.IMAP_HOST,
  IMAP_PORT: process.env.IMAP_PORT,
  IMAP_USER: process.env.IMAP_USER,
  IMAP_PASS: process.env.IMAP_PASS,

  // ─── Prism (LLM Gateway) ────────────────────────────────────────
  PRISM_SERVICE_URL: process.env.PRISM_SERVICE_URL,

  // ─── Default AI Models (vault-backed) ───────────────────────────
  TOOLS_IMAGE_MODEL: process.env.TOOLS_IMAGE_MODEL,
  TOOLS_VISION_MODEL: process.env.TOOLS_VISION_MODEL,

  // ─── Smart Home (Lights) ────────────────────────────────────────
  LIGHTS_SERVICE_URL: process.env.LIGHTS_SERVICE_URL,

  // ─── MinIO (S3-compatible object storage) ───────────────────────
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,

  // ─── Workspace Agent ────────────────────────────────────────────
  AGENT_MAX_CONNECTIONS: process.env.AGENT_MAX_CONNECTIONS || "5",

  // ─── qBittorrent (Torrent Search & Download) ────────────────────
  QBITTORRENT_URL: process.env.QBITTORRENT_URL,
  QBITTORRENT_USERNAME: process.env.QBITTORRENT_USERNAME || "admin",
  QBITTORRENT_PASSWORD: process.env.QBITTORRENT_PASSWORD,

  // ─── Lupos Bot API ──────────────────────────────────────────────
  LUPOS_BOT_URL: process.env.LUPOS_BOT_URL || "http://localhost:1337",

  // ─── Security (HIBP Breach Check) ───────────────────────────────
  HIBP_API_KEY: process.env.HIBP_API_KEY,

  // ─── Calendar (Google Calendar API) ─────────────────────────────
  GOOGLE_CALENDAR_CREDENTIALS: process.env.GOOGLE_CALENDAR_CREDENTIALS,

  // ─── Notifications (ntfy.sh) ────────────────────────────────────
  NTFY_BASE_URL: process.env.NTFY_BASE_URL,
  NTFY_TOKEN: process.env.NTFY_TOKEN,

  // ─── Flights (AviationStack) ────────────────────────────────────
  AVIATIONSTACK_API_KEY: process.env.AVIATIONSTACK_API_KEY,

  // ─── Portal (Infrastructure Observability) ──────────────────────
  PORTAL_SERVICE_URL: process.env.PORTAL_SERVICE_URL,

  // ─── Gaming (Steam Web API) ─────────────────────────────────
  STEAM_API_KEY: process.env.STEAM_API_KEY,

  // Environment variables needed in services
  FFMPEG_PATH: process.env.FFMPEG_PATH,
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  HOME_DIR: process.env.HOME,
};

/**
 * Apply resolved location data onto the CONFIG singleton.
 * Called by server.ts after LocationService.initLocation() completes.
 */
export function applyLocation(loc: LocationData): void {
  CONFIG.LATITUDE = loc.latitude;
  CONFIG.LONGITUDE = loc.longitude;
  CONFIG.RADIUS_MILES = loc.radiusMiles;
  CONFIG.TIMEZONE = loc.timezone;
  CONFIG.TIDE_STATION_ID = loc.tideStationId;
}

export type { ToolsServiceConfig, LocationData };
export default CONFIG;
