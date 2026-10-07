# Tools Service

Consolidated data aggregation and agentic tool execution hub. Continuously collects data from 70+ external sources across 11 domains — events, finance, market, products, trends, weather, knowledge, health, transit, and utility. Also serves as the tool execution backend for the Prism agentic loop (file ops, git, browser, shell, code interpreters, web search).

**Port:** `5590` · **Runtime:** Node.js (TypeScript) · **Framework:** Express 5 · **DB:** MongoDB

## Quick Start

```bash
cp secrets.example.ts secrets.ts   # API keys
npm install
npm run dev
```

## Data Flow

```
External APIs / Scrapers → Fetchers (70+) → Collectors (scheduled) → Caches (23) → Routes (19)
                                                    ↓
                                               MongoDB (persist)
```

## API Domains

| Domain | Route | Description |
|---|---|---|
| **Event** | `/event` | Ticketmaster, SeatGeek, Craigslist, UBC, SFU, NHL, TMDB |
| **Finance** | `/finance` | Stocks, earnings, analyst recs (Finnhub), macro indicators (FRED) |
| **Market** | `/market` | Commodities — energy, metals, agriculture, crypto, forex (Yahoo Finance) |
| **Product** | `/product` | Best Buy, Product Hunt, eBay, Etsy, Amazon, Costco |
| **Trend** | `/trend` | Reddit, HackerNews, Google Trends/News, X, Bluesky, Mastodon, GitHub |
| **Weather** | `/weather` | Weather, air quality, pollen, earthquakes, NEOs, space weather, ISS, wildfires |
| **Knowledge** | `/knowledge` | Dictionary, books, countries, arXiv, Wikipedia, anime, movies, periodic table |
| **Health** | `/health` | USDA nutrition, FDA drug labels, adverse events, recalls |
| **Transit** | `/transit` | Real-time TransLink bus arrivals and stops |
| **Utility** | `/utility` | Currency, timezone, IP geolocation, Google Places, airports |
| **Agentic** | `/agentic` | File, git, browser, shell, search, LSP, notebook, scheduler |
| **Compute** | `/compute` | JS/Python exec, charts, QR codes, LaTeX, regex, color tools |
| **Creative** | `/creative` | Image generation + TTS via Prism proxy |
| **Admin** | `/admin` | Tool schemas for LLM function calling, request analytics |

All endpoints support sparse fieldsets via `?fields=name,venue.city`.

## Authentication

tools-service is publicly routed. Every route that runs code or commands, reads or writes files or workspaces, changes configuration, or acts on the owner's accounts, devices or money answers only a caller sending `x-api-secret: $TOOLS_SERVICE_API_SECRET` — prism-service, and prism-client's server proxy for its signed-in user. Without it the answer is 401; while the secret is unset, 503. The whole policy is `GATED_ROUTES` in `src/middleware/ToolsSecretMiddleware.ts`, and `tests/ToolsSecretGuard.test.ts` holds every route to it.

- **Gated:** `/agentic`, `/filesystem`, `/agents`, `/admin`, `/mcp`, `/communication`, `/torrent`, `/infrastructure`, `/analytics`, `/lights`; `/compute/js`, `/compute/shell` and the compute routes that read local paths (`image/process`, `image/ascii`, `barcode/scan`, `video/gif`); `/utility/python/{execute,stream,info}`, `/utility/calendar`, `/utility/ports`, `/utility/ping`; `/knowledge/video`; the creative routes that call Prism or read local audio; Spotify `get`, `control`, `auth/login` and `auth/status`; every write to `/discord` and `/product`.
- **Open:** read-only data (weather, finance, knowledge, Discord archive reads, …), the embed and render URLs browsers and Discord load (`buildLocalUrl`), Spotify's OAuth callback, and `/health`. The open routes that fetch a caller's URL — page metadata, HTTP headers, TLS certificates, feeds, web content — reach only public addresses: `src/fetchers/web/SsrfGuard.ts` checks every hop as it connects.
- **URLs a model supplies** (image, video and audio inputs, speech-to-text, the `/agentic/web` readers, Python input files, video downloads, an animation's images and soundtrack) reach public addresses, plus this fleet's own services at the exact origins configured for them (`TOOLS_SERVICE_URL`, `TOOLS_SERVICE_PUBLIC_URL`, `PRISM_SERVICE_URL`, `PRISM_SERVICE_PUBLIC_URL`, `MINIO_ENDPOINT`, `MINIO_PUBLIC_URL`), so one tool's hosted media can feed the next; a redirect from one of ours to a private address is refused. yt-dlp fetches by itself, so a video download's every connection — its redirects, a manifest's segments, the ffmpeg it drives — leaves through an egress proxy on 127.0.0.1 (`src/fetchers/web/EgressProxy.ts`) that resolves the destination once, refuses it with 403 under the same rule, and connects to the address it checked. Webhooks reach public addresses only. An audio file path is read only where every read tool may read (a workspace root, or this service's own temp root), else 400.
- **The agentic browser** may browse the LAN, but never link-local space or a cloud metadata endpoint (169.254/16, fe80::/10, `100.100.100.200`, `fd00:ec2::254`), in any spelling: every request of a session — a navigation, a redirect, a page's own fetches and sockets — leaves through its own egress proxy, which checks the address it connects to.
- An LM Studio `ephemeral_mcp` integration sends the secret in its `headers`.
- Calls to prism-service carry one credential: while serving a request that brought prism-service's `x-prism-user-token` (a signed-in user's turn), that token as `Authorization: Bearer`; otherwise `x-api-secret: $PRISM_SERVICE_API_SECRET`. The token is taken off the request as it arrives, is logged nowhere, and goes only to prism-service (and back into this service when the MCP adapter runs a tool for the same turn).
- The bridge's WebSockets (`/ws/agent`, `/ws/workspace`) answer only the agent secret (prism `settings.workspace.agentSecret`) in `x-api-secret` — never in the URL: 401 without it, 503 for everyone while it is unset. A secret shorter than 24 characters draws a warning.

## Agentic Services

| Service | Purpose |
|---|---|
| **AgenticFileService** | File ops — read, write, search, glob, tree with safety guards |
| **AgenticGitService** | Git ops — status, diff, commit, branch, merge |
| **AgenticBrowserService** | Playwright browser pool — navigate, click, screenshot |
| **AgenticCommandService** | Shell execution with timeout + output streaming |
| **AgenticLspService** | LSP code intelligence — go-to-def, references, hover |
| **AgenticNotebookService** | Jupyter .ipynb CRUD and cell execution |
| **AgenticWebService** | Web search (Google/DDG) + URL extraction |
| **ToolSchemaService** | 150+ tool schemas for LLM function calling |

## Scripts

```bash
npm start              # Start server
npm run dev            # Start with auto-reload (nodemon)
npm run lint           # Run oxlint (.oxlintrc.json)
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Prettier
npm run format:check   # Check formatting
npm test               # Run tests (Vitest)
npm run test:watch     # Run tests in watch mode
npm run deploy         # Deploy to production
npm run deploy:dry     # Validate deployment without deploying
```

