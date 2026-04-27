// ============================================================
// Tools API — Secrets Template
// ============================================================
// Secrets are resolved from (in priority order):
//   1. process.env (manual env vars, Docker --env)
//   2. Vault service (via boot.js → VAULT_SERVICE_URL + VAULT_SERVICE_TOKEN)
//   3. Fallback .env file (../vault-service/.env)
//
// See vault-service/.env.example for the full list of variables.
// ============================================================

// TOOLS_SERVICE_PORT=5590
// PRISM_SERVICE_URL=http://localhost:7777
// LIGHTS_SERVICE_URL=http://localhost:4444
// WORKSPACE_ROOTS=/home/youruser/projects/sun,/home/youruser/other-repo
// WORKTREE_DIR=
// MONGO_URI=mongodb://user:password@<host>:27017/tools?directConnection=true&replicaSet=rs0&authSource=admin
// TICKETMASTER_API_KEY=
// SEATGEEK_CLIENT_ID=
// TMDB_API_KEY=
// GOOGLE_PLACES_API_KEY=
// FINNHUB_API_KEY=
// FRED_API_KEY=
// BESTBUY_API_KEY=
// PRODUCTHUNT_API_KEY=
// PRODUCTHUNT_API_SECRET=
// EBAY_CLIENT_ID=
// EBAY_CLIENT_SECRET=
// ETSY_API_KEY=
// ETSY_SHARED_SECRET=
// REDDIT_CLIENT_ID=
// REDDIT_CLIENT_SECRET=
// REDDIT_USER_AGENT=sun:tools:v0.1.0 (by /u/YOUR_USERNAME)
// X_BEARER_TOKEN=
// TOMORROWIO_API_KEY=
// NASA_API_KEY=DEMO_KEY
// GOOGLE_API_KEY=
// GOOGLE_CSE_CX=
// BRAVE_SEARCH_API_KEY=
// TRANSLINK_API_KEY=
// IPINFO_TOKEN=
// AIS_STREAM_API_KEY=
// EIA_API_KEY=
// TWILIO_ACCOUNT_SID=
// TWILIO_AUTH_TOKEN=
