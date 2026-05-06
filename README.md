# Tools — Unified Data Aggregator + Agentic Tool Hub

Consolidated data aggregation service and agentic tool execution hub. Continuously collects data from 70+ external sources across 11 domains — events, finance, market, products, trends, weather, knowledge, health, transit, and utility — through a single unified API. Also serves as the tool execution backend for the Prism agentic loop, providing file ops, git, browser automation, shell execution, code interpreters, and web search.

**Port:** `5590` · **Runtime:** Node.js (ES Modules) · **Framework:** Express 5 · **DB:** MongoDB · **Tests:** Node.js test runner

## Architecture

### Directory Structure

```
tools-service/
├── routes/                 # Express routers per domain (19 route files)
├── services/               # Business logic services (25+)
│   └── lsp/                # Language Server Protocol integration
├── collectors/             # Scheduled data-collection orchestrators (6)
├── fetchers/               # Per-source HTTP fetchers (70+ modules)
│   ├── event/              # Ticketmaster, SeatGeek, Craigslist, UBC/SFU, Sports, etc.
│   ├── finance/            # Finnhub, FRED
│   ├── health/             # Nutrition, FDA drugs
│   │   └── data/           # CSV digests (USDA, UK, India, Australia, Japan, Canada, FAO, FDA)
│   ├── knowledge/          # arXiv, Wikipedia, TMDB, Books, Anime, Elements, etc.
│   │   └── data/           # CSV digests (elements, exoplanets, world indicators)
│   ├── maritime/           # AIS vessel tracking
│   ├── market/             # Yahoo Finance commodities
│   ├── newgrounds/         # Newgrounds community data
│   ├── product/            # Amazon, Best Buy, Costco, eBay, Etsy, Product Hunt
│   ├── transit/            # TransLink
│   ├── trend/              # Reddit, GitHub, Google, HackerNews, X, Bluesky, etc.
│   ├── utility/            # Airports, Currency, IP, Places, Webcams
│   │   └── webcams/        # 30+ city-specific webcam source modules
│   ├── web/                # Generic web extraction (GitHub, Reddit, RSS, PDF, etc.)
│   └── weather/            # USGS, NASA, NOAA, OpenMeteo, Environment Canada, etc.
├── caches/                 # In-memory caches with TTL (23 modules)
├── models/                 # MongoDB document schemas
├── middleware/             # Field projection, request logging, tool call logging
├── scripts/                # Scraping + migration scripts
├── tests/                  # Integration tests (15 test suites)
└── package.json
```

### Data Flow

```
External APIs / Scrapers
        │
        ▼
  ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
  │  Fetchers   │────▶│  Collectors   │────▶│  In-Memory    │
  │  (70+ src)  │     │  (scheduled)  │     │  Caches (23)  │
  └─────────────┘     └──────┬───────┘     └───────┬───────┘
                             │                     │
                             ▼                     ▼
                      ┌──────────────┐     ┌───────────────┐
                      │   MongoDB    │     │   Express     │
                      │  (persist)   │     │   Routes (19) │
                      └──────────────┘     └───────────────┘
```

### Agentic Services

| Service | Purpose |
|---|---|
| **AgenticFileService** | File ops — read, write, search, glob, tree with safety guards |
| **AgenticGitService** | Git ops — status, diff, commit, branch, merge |
| **AgenticBrowserService** | Playwright browser pool — navigate, click, screenshot |
| **AgenticCommandService** | Shell execution with timeout + output streaming |
| **AgenticLspService** | LSP code intelligence — go-to-def, references, hover |
| **AgenticNotebookService** | Jupyter .ipynb CRUD and cell execution |
| **AgenticWebService** | Web search (Google/DDG) + URL extraction |
| **AgenticSchedulerService** | Persistent task scheduler with cron |
| **ToolSchemaService** | Single source of truth — 150+ tool schemas for LLM function calling |

### In-Memory Static Datasets

Several domains load curated CSV digests at startup for zero-latency queries:

| Dataset | Source | Records |
|---|---|---|
| **Periodic Table** | PubChem / NIST | 119 |
| **World Bank** | World Bank Open Data | 217 |
| **NASA Exoplanets** | NASA Exoplanet Archive | ~6,153 |
| **FDA Drug NDC** | openFDA NDC Directory | ~26,000 |
| **Airport Codes** | OurAirports | ~4,555 |
| **Nutrition** | USDA + 7 international sources | ~1,346+ |

## API Domains

| Domain | Route | Description |
|---|---|---|
| **Event** | `/event` | Local events from Ticketmaster, SeatGeek, Craigslist, UBC, SFU, City of Vancouver, NHL, TMDB |
| **Finance** | `/finance` | Stocks, company profiles, earnings, analyst recommendations via Finnhub; macroeconomic indicators via FRED |
| **Market** | `/market` | Commodity prices (energy, metals, agriculture, crypto, forex, indices, bonds) via Yahoo Finance |
| **Product** | `/product` | Products from Best Buy, Product Hunt, eBay, Etsy, Amazon, Costco; Best Buy CA stock tracker |
| **Trend** | `/trend` | Trending topics from Reddit, HackerNews, Google Trends/News, X, Bluesky, Mastodon, GitHub |
| **Weather** | `/weather` | Weather, air quality, pollen, earthquakes, NEOs, space weather, ISS, wildfires, tides, launches |
| **Knowledge** | `/knowledge` | Dictionary, books, countries, arXiv, Wikipedia, anime, movies, TV, periodic table, exoplanets |
| **Health** | `/health` | USDA nutrition database, FDA drug labels, adverse events, recalls, NDC drug database |
| **Transit** | `/transit` | Real-time TransLink bus arrivals, stop info, nearby stops |
| **Utility** | `/utility` | Currency conversion, timezone, IP geolocation, Google Places, airports, maps |
| **Agentic** | `/agentic` | File, git, browser, shell, search, LSP, notebook, scheduler tools |
| **Compute** | `/compute` | JS/Python code execution, charts, QR codes, LaTeX, regex, color tools |
| **Creative** | `/creative` | Image generation + TTS via Prism proxy |
| **Admin** | `/admin` | Tool schemas for LLM function calling, request log analytics |

### Global Query Parameters

All endpoints support sparse fieldsets via `?fields=name,venue.city` — dot-notation supported.

## Prerequisites

- **Node.js** v20+ (ES Modules)
- **MongoDB** — single `tools` database for all domain collections

## Tech Stack

| Package | Purpose |
|---|---|
| Express 5 | HTTP framework |
| MongoDB | Native database driver |
| yahoo-finance2 | Real-time market & commodity data |
| Cheerio | HTML scraping |
| Playwright | Browser automation for agentic tools |
| xml2js | XML/RSS parsing |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure secrets
cp secrets.example.js secrets.js
# Edit secrets.js with your API keys

# 3. Start the server
npm run dev        # Development (hot-reload with nodemon)
npm start          # Production
```

## Scripts

```bash
npm start              # Start server
npm run dev            # Start with nodemon (hot-reload)
npm test               # Run all integration tests
npm run test:weather   # Run weather endpoint tests
npm run test:events    # Run event endpoint tests
npm run test:finance   # Run finance endpoint tests
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Prettier
npm run format:check   # Check formatting
```
