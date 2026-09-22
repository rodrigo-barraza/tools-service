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

