# Tools API — Unified Data Aggregator

A consolidated Node.js API that continuously collects and serves data from multiple domains — events, finance, market, products, trends, weather, knowledge, health, transit, and utility — through a single unified service. All ingested data is cached in-memory, persisted to MongoDB, and exposed through an aggregated REST API designed for LLM function calling and cross-app synchronization within the Sun ecosystem.

## ✨ Features

| Domain        | Route        | Description                                                                         |
| ------------- | ------------ | ----------------------------------------------------------------------------------- |
| **Event**     | `/event`     | Local events from Ticketmaster, SeatGeek, Craigslist, UBC, SFU, City of Vancouver, NHL, Whitecaps, BC Lions, TMDB |
| **Finance**   | `/finance`   | Stock quotes, company profiles, earnings, analyst recommendations, financials via Finnhub; macroeconomic indicators via FRED |
| **Market**    | `/market`    | Commodity prices (energy, metals, agriculture, crypto, forex, indices, bonds) via Yahoo Finance |
| **Product**   | `/product`   | Product listings from Best Buy, Product Hunt, eBay, Etsy, Amazon, Costco; Best Buy CA stock availability tracker |
| **Trend**     | `/trend`     | Trending topics from Reddit, Hacker News, Google Trends/News, X, Bluesky, Mastodon, GitHub, Product Hunt, TVMaze, Wikipedia |
| **Weather**   | `/weather`   | Weather, air quality, pollen, earthquakes, NEOs, space weather, ISS tracking, Kp index, wildfires, tides, solar wind, launches, twilight, avalanche, Environment Canada warnings |
| **Knowledge** | `/knowledge` | Dictionary, books, countries, arXiv papers, Wikipedia summaries, anime, movies, TV shows, periodic table, World Bank indicators, exoplanets |
| **Health**    | `/health`    | USDA nutrition database (~1,346 foods from 8 international sources), FDA drug labels, adverse events, recalls, NDC drug database (~26,000 products) |
| **Transit**   | `/transit`   | Real-time TransLink bus arrivals, stop info, nearby stops, route info |
| **Utility**   | `/utility`   | Currency conversion, timezone lookup, IP geolocation, Google Places search, interactive map embeds, airport database (~4,555 airports) |
| **Admin**     | `/admin`     | Tool schemas for LLM function calling, request log analytics |

## ⚙️ Prerequisites

- **Node.js** v20+ (ES Modules)
- **MongoDB** — single `tools` database for all domain collections

## 🛠️ Tech Stack

| Package          | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `express`        | HTTP framework (v5)                       |
| `mongodb`        | MongoDB native driver                     |
| `yahoo-finance2` | Real-time market & commodity data         |
| `cheerio`        | HTML scraping (Craigslist, Costco, etc.)  |
| `xml2js`         | XML parsing (RSS feeds, Environment Canada) |

## 🚀 Setup

### 1️⃣ Install dependencies

```bash
npm install
```

### 2️⃣ Configure secrets

```bash
cp secrets.example.js secrets.js
```

Edit `secrets.js` and fill in your API keys:

| Secret                     | Domain   | Required | Description                                 |
| -------------------------- | -------- | -------- | ------------------------------------------- |
| `TOOLS_PORT`               | Server   | No       | Default `5590`                              |
| `MONGO_URI`                | Server   | No       | Default `mongodb://192.168.86.2:27017/tools` |
| `LATITUDE` / `LONGITUDE`   | Shared   | No       | Default Vancouver (49.28, -123.12)          |
| `RADIUS_MILES`             | Shared   | No       | Default `50`                                |
| `TIMEZONE`                 | Shared   | No       | Default `America/Vancouver`                 |
| `TIDE_STATION_ID`          | Weather  | No       | Default `9449880` (Point Atkinson)          |
| `TICKETMASTER_API_KEY`     | Event    | Yes      | Ticketmaster Discovery API                  |
| `SEATGEEK_CLIENT_ID`       | Event    | Yes      | SeatGeek Platform API                       |
| `TMDB_API_KEY`             | Event    | Yes      | TMDB movie data                             |
| `GOOGLE_PLACES_API_KEY`    | Event    | Yes      | Google Places for venue enrichment          |
| `FINNHUB_API_KEY`          | Finance  | Yes      | Finnhub stock data API                      |
| `FRED_API_KEY`             | Finance  | Yes      | FRED macroeconomic indicators               |
| `BESTBUY_API_KEY`          | Product  | Yes      | Best Buy Products API                       |
| `PRODUCTHUNT_API_KEY`      | Product  | Yes      | Product Hunt API                            |
| `PRODUCTHUNT_API_SECRET`   | Product  | Yes      | Product Hunt API secret                     |
| `EBAY_CLIENT_ID`           | Product  | Yes      | eBay Browse API                             |
| `EBAY_CLIENT_SECRET`       | Product  | Yes      | eBay Browse API secret                      |
| `ETSY_API_KEY`             | Product  | Yes      | Etsy Open API                               |
| `ETSY_SHARED_SECRET`       | Product  | Yes      | Etsy Open API secret                        |
| `REDDIT_CLIENT_ID`         | Trend    | Yes      | Reddit API (OAuth)                          |
| `REDDIT_CLIENT_SECRET`     | Trend    | Yes      | Reddit API (OAuth)                          |
| `X_BEARER_TOKEN`           | Trend    | Yes      | X (Twitter) API v2                          |
| `TOMORROWIO_API_KEY`       | Weather  | Yes      | Tomorrow.io weather data                    |
| `NASA_API_KEY`             | Weather  | No       | Default `DEMO_KEY`                          |
| `GOOGLE_API_KEY`           | Weather  | Yes      | Google Air Quality & Pollen APIs            |
| `TRANSLINK_API_KEY`        | Transit  | Yes      | TransLink RTTI API                          |
| `IPINFO_TOKEN`             | Utility  | Yes      | IPinfo geolocation (50K req/mo free)        |

### 3️⃣ Run

```bash
# Development (hot-reload)
npm run dev

# Production
npm start
```

Default port: **5590**

---

## 📡 API Endpoints

### 🎟️ Event — `/event`

| Method | Endpoint               | Description                     |
| ------ | ---------------------- | ------------------------------- |
| GET    | `/today`               | Events happening today          |
| GET    | `/upcoming?days&limit` | Upcoming events (default 30d)   |
| GET    | `/past?days&limit`     | Past events                     |
| GET    | `/search?q&category&city&source&limit` | Search events  |
| GET    | `/summary`             | Source/category breakdown       |
| GET    | `/cached`              | In-memory cached events         |
| GET    | `/:source/:id`         | Single event by source + ID     |

### 💸 Finance — `/finance`

| Method | Endpoint                              | Description                          |
| ------ | ------------------------------------- | ------------------------------------ |
| GET    | `/quote/:symbol`                      | Stock quote (1-min TTL cache)        |
| GET    | `/profile/:symbol`                    | Company profile (24h TTL cache)      |
| GET    | `/news?symbol`                        | Market news or company-specific news |
| GET    | `/earnings`                           | Earnings calendar                    |
| GET    | `/recommendation/:symbol`             | Analyst recommendations (1h TTL)     |
| GET    | `/financials/:symbol`                 | Basic financials (1h TTL)            |
| GET    | `/macro/indicators`                   | Key FRED indicators                  |
| GET    | `/macro/search?q&limit&orderBy`       | Search FRED series                   |
| GET    | `/macro/series/:seriesId`             | FRED series metadata                 |
| GET    | `/macro/series/:seriesId/observations` | FRED series data points             |

### 📈 Market — `/market`

| Method | Endpoint                           | Description                         |
| ------ | ---------------------------------- | ----------------------------------- |
| GET    | `/commodities`                     | All commodities (80+ tickers)       |
| GET    | `/commodities/summary`             | Aggregate summary                   |
| GET    | `/commodities/categories`          | Available categories                |
| GET    | `/commodities/category/:category`  | Filter by category                  |
| GET    | `/commodities/ticker/:ticker`      | Single commodity by ticker          |
| GET    | `/commodities/history/:ticker?hours` | Price history from MongoDB        |

### 🛒 Product — `/product`

| Method | Endpoint                                | Description                          |
| ------ | --------------------------------------- | ------------------------------------ |
| GET    | `/products`                             | All cached products                  |
| GET    | `/products/trending?limit`              | Trending products (composite score)  |
| GET    | `/products/categories`                  | Unified categories                   |
| GET    | `/products/category/:category`          | Filter by category                   |
| GET    | `/products/source/:source`              | Filter by source                     |
| GET    | `/products/search?q`                    | Search cached products               |
| GET    | `/products/recent?hours&category&source&limit` | Recent from MongoDB           |
| GET    | `/products/db/search?q&limit`           | Full-text MongoDB search             |
| GET    | `/products/availability`                | Best Buy CA stock status             |
| GET    | `/products/availability/in-stock`       | In-stock items only                  |
| GET    | `/products/availability/out-of-stock`   | Out-of-stock items only              |
| GET    | `/products/availability/sku/:sku`       | Single SKU status                    |
| GET    | `/products/availability/check?skus`     | On-demand check (comma-separated)    |
| GET    | `/products/availability/watchlist`      | Current watchlist                    |
| POST   | `/products/availability/watchlist`      | Add SKUs to watchlist                |
| DELETE | `/products/availability/watchlist/:sku` | Remove SKU from watchlist            |

### 🚀 Trend — `/trend`

| Method | Endpoint                              | Description                         |
| ------ | ------------------------------------- | ----------------------------------- |
| GET    | `/trends`                             | All cached trends                   |
| GET    | `/trends/hot`                         | Cross-source correlated trends      |
| GET    | `/trends/source/:source`              | Filter by source                    |
| GET    | `/trends/category/:category`          | Filter by category                  |
| GET    | `/trends/search?q`                    | Search cached trends                |
| GET    | `/trends/recent?hours&category&source&limit` | Recent from MongoDB          |
| GET    | `/trends/top?hours&limit`             | Top trends by engagement            |
| GET    | `/trends/db/search?q&limit`           | Full-text MongoDB search            |

### ⛅ Weather — `/weather`

| Method | Endpoint                             | Description                          |
| ------ | ------------------------------------ | ------------------------------------ |
| GET    | `/weather`                           | Full weather snapshot                |
| GET    | `/weather/current`                   | Current conditions                   |
| GET    | `/weather/forecast`                  | Forecast data                        |
| GET    | `/weather/air`                       | Tomorrow.io air quality              |
| GET    | `/weather/daylight`                  | Sunrise/sunset data                  |
| GET    | `/earthquakes`                       | Cached earthquake list               |
| GET    | `/earthquakes/summary`               | Earthquake summary stats             |
| GET    | `/earthquakes/recent?hours&minMag&limit` | Recent from MongoDB              |
| GET    | `/earthquakes/:id`                   | Single earthquake by ID              |
| GET    | `/neo`                               | Near-Earth objects                    |
| GET    | `/neo/summary`                       | NEO summary stats                    |
| GET    | `/neo/recent?days&hazardousOnly&limit` | Recent NEOs from MongoDB           |
| GET    | `/space-weather`                     | All space weather                    |
| GET    | `/space-weather/flares`              | Solar flares                         |
| GET    | `/space-weather/flares/recent?days&limit` | Recent flares from MongoDB      |
| GET    | `/space-weather/cmes`                | Coronal mass ejections               |
| GET    | `/space-weather/cmes/recent?days&earthDirected&limit` | Recent CMEs         |
| GET    | `/space-weather/storms`              | Geomagnetic storms                   |
| GET    | `/space-weather/storms/recent?days&limit` | Recent storms from MongoDB      |
| GET    | `/space-weather/summary`             | Space weather summary                |
| GET    | `/iss`                               | ISS position & crew                  |
| GET    | `/iss/trajectory`                    | ISS orbital trajectory               |
| GET    | `/kp`                                | Kp index history                     |
| GET    | `/kp/current`                        | Current Kp index                     |
| GET    | `/wildfires`                         | Active wildfires                     |
| GET    | `/wildfires/summary`                 | Wildfire summary                     |
| GET    | `/tides`                             | Tide predictions                     |
| GET    | `/tides/next`                        | Next high/low tide                   |
| GET    | `/solar-wind`                        | Solar wind data                      |
| GET    | `/solar-wind/latest`                 | Latest solar wind reading            |
| GET    | `/airquality/google`                 | Google Air Quality                   |
| GET    | `/pollen`                            | Pollen forecasts                     |
| GET    | `/pollen/today`                      | Today's pollen                       |
| GET    | `/apod`                              | Astronomy Picture of the Day         |
| GET    | `/launches`                          | Upcoming rocket launches             |
| GET    | `/launches/next`                     | Next launch                          |
| GET    | `/launches/summary`                  | Launch summary                       |
| GET    | `/twilight`                          | Twilight times                        |
| GET    | `/warnings`                          | Environment Canada warnings          |
| GET    | `/warnings/count`                    | Warning count                        |
| GET    | `/avalanche`                         | Avalanche conditions                 |

### 🧠 Knowledge — `/knowledge`

| Method | Endpoint                                | Description                           |
| ------ | --------------------------------------- | ------------------------------------- |
| GET    | `/dictionary/:word`                     | Word definition                       |
| GET    | `/books/search?q&limit`                 | Search books (Open Library)           |
| GET    | `/books/work/:workKey`                  | Book details                          |
| GET    | `/books/author/:authorKey`              | Author info                           |
| GET    | `/countries/search/:name`               | Search countries                      |
| GET    | `/countries/code/:code`                 | Country by ISO code                   |
| GET    | `/papers/search?q&category&limit&sortBy` | Search arXiv papers                  |
| GET    | `/wikipedia/summary/:title`             | Wikipedia article summary             |
| GET    | `/wikipedia/onthisday?type&month&day`   | On This Day in history                |
| GET    | `/anime/search?q&limit`                 | Search anime (Jikan/MAL)             |
| GET    | `/anime/top?limit`                      | Top-rated anime                       |
| GET    | `/anime/season/now?limit`               | Current season anime                  |
| GET    | `/anime/:id`                            | Anime details by ID                   |
| GET    | `/movies/search?q&page&year`            | Search movies (TMDb)                  |
| GET    | `/movies/trending?timeWindow&limit`     | Trending movies                       |
| GET    | `/movies/discover?genreId&year&sortBy...` | Discover movies by criteria         |
| GET    | `/movies/genres`                        | Movie genres                          |
| GET    | `/movies/:id`                           | Movie details                         |
| GET    | `/movies/:id/credits`                   | Movie cast & crew                     |
| GET    | `/tv/search?q&page&firstAirDateYear`    | Search TV shows                       |
| GET    | `/tv/trending?timeWindow&limit`         | Trending TV shows                     |
| GET    | `/tv/discover?genreId&sortBy...`        | Discover TV shows by criteria         |
| GET    | `/tv/genres`                            | TV genres                             |
| GET    | `/tv/:id`                               | TV show details                       |
| GET    | `/tv/:id/credits`                       | TV show cast & crew                   |
| GET    | `/tv/:id/season/:seasonNumber`          | Season episode details                |
| GET    | `/elements/search?q&limit&category&block` | Search periodic table (in-memory)   |
| GET    | `/elements/rank?property&limit&order`   | Rank elements by property             |
| GET    | `/elements/categories`                  | Element categories                    |
| GET    | `/elements/:symbol`                     | Element by symbol                     |
| GET    | `/indicators/country/:code`             | Country indicators (World Bank)       |
| GET    | `/indicators/rank?indicator&limit&order` | Rank countries by indicator          |
| GET    | `/indicators/compare?countries&indicator` | Compare country indicators          |
| GET    | `/indicators/list`                      | Available indicators                  |
| GET    | `/exoplanets/search?q&limit&method`     | Search exoplanets (NASA)              |
| GET    | `/exoplanets/lookup/:name`              | Exoplanet by name                     |
| GET    | `/exoplanets/rank?field&limit&order`    | Rank exoplanets by field              |
| GET    | `/exoplanets/stats`                     | Discovery statistics                  |
| GET    | `/exoplanets/habitable?limit`           | Habitable zone planets                |

### 🩺 Health — `/health`

| Method | Endpoint                                     | Description                          |
| ------ | -------------------------------------------- | ------------------------------------ |
| GET    | `/nutrition/search?q&limit&kingdom&foodType&nutrientTypes` | Search foods (in-memory)  |
| GET    | `/nutrition/rank?nutrient&limit&kingdom&foodType` | Rank foods by nutrient          |
| GET    | `/nutrition/compare?foods&nutrientTypes`      | Compare foods side-by-side           |
| GET    | `/nutrition/categories`                       | Food categories                      |
| GET    | `/nutrition/nutrient-types`                   | Nutrient type groups                 |
| GET    | `/nutrition/top?category&nutrient&limit`      | Top foods by nutrient category       |
| GET    | `/nutrition/nutrients/:category`              | List nutrients in a category         |
| GET    | `/nutrition/taxonomy/search?rank&value&limit` | Search by taxonomic classification   |
| GET    | `/nutrition/taxonomy/tree?rank&parentRank&parentValue` | Taxonomy tree             |
| GET    | `/drugs/search?q&limit`                       | Search drug labels (openFDA)         |
| GET    | `/drugs/adverse-events?drug&limit`            | Drug adverse events                  |
| GET    | `/drugs/recalls?q&limit`                      | Drug recalls                         |
| GET    | `/drugs/ndc/search?q&limit&dosageForm&productType` | Search NDC database (in-memory) |
| GET    | `/drugs/ndc/lookup/:ndc`                      | Drug by NDC code                     |
| GET    | `/drugs/ndc/dosage-forms`                     | Available dosage forms               |
| GET    | `/drugs/ndc/ingredient?q&limit`               | Search by active ingredient          |
| GET    | `/drugs/ndc/pharm-class?q&limit`              | Search by pharmacological class      |

### 🚌 Transit — `/transit`

| Method | Endpoint                        | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/nextbus/:stopNo?route`        | Next bus arrivals at stop            |
| GET    | `/stops/:stopNo`                | Stop information                     |
| GET    | `/stops/nearby?lat&lng&radius`  | Find nearby stops                    |
| GET    | `/routes/:routeNo`              | Route information                    |

### 🛠️ Utility — `/utility`

| Method | Endpoint                             | Description                          |
| ------ | ------------------------------------ | ------------------------------------ |
| GET    | `/currency/convert?amount&from&to`   | Currency conversion                  |
| GET    | `/currency/list`                     | All currencies                       |
| GET    | `/timezone/:area/:location`          | Time in timezone                     |
| GET    | `/timezone/list?area`                | List timezones                       |
| GET    | `/ip`                                | Caller's IP geolocation              |
| GET    | `/ip/:ip`                            | IP geolocation lookup                |
| GET    | `/ip/batch?ips`                      | Batch IP lookup                      |
| GET    | `/places/nearby?type&latitude&longitude&radius&limit` | Nearby places (Google) |
| GET    | `/places/search?q&latitude&longitude&radius&limit` | Text search places      |
| GET    | `/map?markers&zoom&maptype`          | Map embed URL generator              |
| GET    | `/map/embed?markers&zoom&maptype`    | Interactive HTML map embed           |
| GET    | `/airports/search?q&limit&country`   | Search airports (in-memory)          |
| GET    | `/airports/code/:code`               | Airport by IATA/ICAO code            |
| GET    | `/airports/country/:code`            | Airports by country                  |
| GET    | `/airports/nearest?lat&lng&limit`    | Nearest airports                     |

### 🛡️ Admin — `/admin`

| Method | Endpoint                   | Description                          |
| ------ | -------------------------- | ------------------------------------ |
| GET    | `/tool-schemas`            | Full tool schemas with metadata      |
| GET    | `/tool-schemas/ai`         | Clean schemas for LLM consumption    |
| GET    | `/requests?method&path&status&since&until&limit&skip` | Query request logs |
| GET    | `/requests/stats?since`    | Aggregated request statistics        |

### 🌐 Global

| Method | Endpoint  | Description                                      |
| ------ | --------- | ------------------------------------------------ |
| GET    | `/health` | Unified health check across all domains          |

---

## 🔍 Global Query Parameters

All endpoints support these cross-cutting query parameters:

| Parameter | Example                | Description                                           |
| --------- | ---------------------- | ----------------------------------------------------- |
| `fields`  | `?fields=name,venue.city` | **Sparse fieldsets** — return only specified fields. Supports dot-notation for nested paths. |

---

## 🏗️ Architecture

### 🔄 Data Flow

```
External APIs / Scrapers
        │
        ▼
  ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
  │  Fetchers   │────▶│  Collectors   │────▶│  In-Memory    │
  │  (60+ src)  │     │  (scheduled)  │     │  Caches (23)  │
  └─────────────┘     └──────┬───────┘     └───────┬───────┘
                             │                     │
                             ▼                     ▼
                      ┌──────────────┐     ┌───────────────┐
                      │   MongoDB    │     │   Express     │
                      │  (persist)   │     │   Routes (11) │
                      └──────────────┘     └───────┬───────┘
                                                   │
                                                   ▼
                                           ┌───────────────┐
                                           │  Middleware    │
                                           │  • Field      │
                                           │    Projection  │
                                           │  • Request    │
                                           │    Logger     │
                                           └───────┬───────┘
                                                   │
                                                   ▼
                                              HTTP Client
```

### 💾 In-Memory Static Datasets

Several domains load curated CSV digests at startup for zero-latency queries:

| Dataset               | Source                    | Records     | Digest File                   |
| --------------------- | ------------------------- | ----------- | ----------------------------- |
| **Periodic Table**    | PubChem / NIST            | 119         | `digest_elements.csv`         |
| **World Bank**        | World Bank Open Data      | 217         | `digest_world_indicators.csv` |
| **NASA Exoplanets**   | NASA Exoplanet Archive    | ~6,153      | `digest_exoplanets.csv`       |
| **FDA Drug NDC**      | openFDA NDC Directory     | ~26,000     | `digest_fda_drugs.csv`        |
| **Airport Codes**     | OurAirports               | ~4,555      | `digest_airports.csv`         |
| **Nutrition (USDA)**  | USDA FoodData Central     | ~1,346      | `digest_food.csv`             |
| **Nutrition (UK)**    | UK CoFID                  | varies      | `digest_food_uk.csv`          |
| **Nutrition (India)** | India IFCT                | varies      | `digest_food_india.csv`       |
| **Nutrition (Aus)**   | Australia AFCD            | varies      | `digest_food_australia.csv`   |
| **Nutrition (Japan)** | Japan MEXT                | varies      | `digest_food_japan.csv`       |
| **Nutrition (Canada)**| Canadian Nutrient File    | varies      | `digest_food_canada.csv`      |
| **Nutrition (FAO)**   | FAO BioFoodComp           | varies      | `digest_food_fao.csv`         |

---

## 🗂️ Project Structure

```
tools-api/
├── server.js                          # Express app, collector scheduling, route mounting
├── config.js                          # Unified config (imports from secrets.js)
├── constants.js                       # All enums, intervals, categories, tickers, source lists
├── utilities.js                       # Shared helpers (parsing, scraping, OAuth, async handler)
├── logger.js                          # Timestamped colored console logger
├── db.js                              # MongoDB connection
│
├── routes/                            # Express routers per domain
│   ├── AdminRoutes.js                 #   Tool schemas, request log analytics
│   ├── AgenticRoutes.js               #   Agentic tool endpoints (file, git, browser, shell, etc.)
│   ├── ClockCrewRoutes.js             #   Clock Crew community data
│   ├── CommunicationRoutes.js         #   SMS/messaging via Twilio
│   ├── ComputeRoutes.js               #   JS/Python code execution endpoints
│   ├── CreativeRoutes.js              #   Creative/generative tool endpoints
│   ├── EnergyRoutes.js                #   Energy data endpoints
│   ├── EventRoutes.js                 #   Events domain
│   ├── FinanceRoutes.js               #   Finnhub + FRED macro domain
│   ├── HealthRoutes.js                #   Nutrition + FDA drugs domain
│   ├── KnowledgeRoutes.js             #   Reference data domain (books, anime, movies, elements, etc.)
│   ├── MaritimeRoutes.js              #   Maritime AIS vessel tracking
│   ├── MarketRoutes.js                #   Commodities domain
│   ├── NewgroundsRoutes.js            #   Newgrounds community data
│   ├── ProductRoutes.js               #   Products + Best Buy CA availability domain
│   ├── TransitRoutes.js               #   TransLink transit domain
│   ├── TrendRoutes.js                 #   Social trends domain
│   ├── UtilityRoutes.js               #   Currency, timezone, IP, places, maps, airports, webcams
│   └── WeatherRoutes.js               #   Weather, seismic, space weather, etc.
│
├── collectors/                        # Scheduled data-collection orchestrators
│   ├── EventCollector.js
│   ├── FinanceCollector.js
│   ├── MarketCollector.js
│   ├── ProductCollector.js
│   ├── TrendCollector.js
│   └── WeatherCollector.js
│
├── fetchers/                          # Per-source HTTP fetchers (70+ modules)
│   ├── event/                         #   Ticketmaster, SeatGeek, Craigslist, UBC/SFU, City of Van, Sports, Movies, Google Places
│   ├── finance/                       #   FinnhubFetcher, FredFetcher
│   ├── health/                        #   NutritionFetcher, FdaDrugFetcher, OpenFdaFetcher
│   │   └── data/                      #   CSV digests (USDA, UK, India, Australia, Japan, Canada, FAO, FDA)
│   ├── knowledge/                     #   Arxiv, Dictionary, Exoplanet, Jikan, OpenLibrary, PeriodicTable, RestCountries, TMDb, Wikipedia, WorldBank, YouTube
│   │   └── data/                      #   CSV digests (elements, exoplanets, world indicators)
│   ├── maritime/                      #   AisStreamFetcher (live AIS vessel tracking)
│   ├── market/                        #   CommodityFetcher (Yahoo Finance)
│   ├── newgrounds/                    #   NewgroundsFetcher (community profiles and content)
│   ├── product/                       #   Amazon, BestBuy, BestBuyCA, Costco, eBay, Etsy, ProductHunt
│   ├── transit/                       #   TransLinkFetcher
│   ├── trend/                         #   Bluesky, GitHub, Google News/Trends, HackerNews, Mastodon, ProductHunt, Reddit, TVMaze, Wikipedia, X
│   ├── utility/                       #   AirportFetcher, CurrencyFetcher, IpInfoFetcher, PlacesFetcher, TimezoneFetcher, WebcamFetcher
│   │   ├── data/                      #   CSV digest (airports)
│   │   └── webcams/                   #   WebcamRegistry + 30+ city-specific webcam source modules
│   ├── web/                           #   GenericPage, GitHub, HackerNews, Npm, Package, Pdf, PyPi, Reddit, Rss, StackOverflow, Twitter, WebContent
│   └── weather/                       #   AirQuality, APOD, Avalanche, DONKI, Earthquake, EnvCanada, Google AQ/Pollen, ISS, Kp, Launch, LiveWeather, NEO, OpenMeteo, SolarWind, Tide, TomorrowIO, Twilight, Wildfire
│
├── caches/                            # In-memory caches (23 modules)
│   ├── createSimpleCache.js           #   Generic cache factory
│   ├── ApodCache.js                   #   Astronomy Picture of the Day
│   ├── AvalancheCache.js              #   Avalanche conditions
│   ├── BestBuyCAAvailabilityCache.js  #   Best Buy CA stock tracker + watchlist
│   ├── CommodityCache.js              #   Commodity prices
│   ├── EarthquakeCache.js             #   USGS earthquake data
│   ├── EnvironmentCanadaCache.js      #   Weather warnings
│   ├── EventCache.js                  #   Events across all sources
│   ├── FinnhubCache.js                #   Stock quotes, profiles, news, earnings
│   ├── GoogleAirQualityCache.js       #   Google Air Quality
│   ├── IssCache.js                    #   ISS position & crew
│   ├── KpIndexCache.js                #   Geomagnetic activity
│   ├── LaunchCache.js                 #   Rocket launches
│   ├── NeoCache.js                    #   Near-Earth objects
│   ├── PollenCache.js                 #   Pollen forecasts
│   ├── ProductCache.js                #   Products across all sources
│   ├── SolarWindCache.js              #   Solar wind data
│   ├── SpaceWeatherCache.js           #   Solar flares, CMEs, geomagnetic storms
│   ├── TideCache.js                   #   Tide predictions
│   ├── TrendCache.js                  #   Trends across all sources
│   ├── TwilightCache.js               #   Civil/nautical/astronomical twilight
│   ├── WeatherCache.js                #   Weather conditions & forecasts
│   └── WildfireCache.js               #   Active wildfire data
│
├── models/                            # MongoDB document schemas
│   ├── ClockCrewPost.js               #   Clock Crew community posts
│   ├── Cme.js                         #   Coronal Mass Ejection
│   ├── CollectorSnapshot.js           #   Collector run tracking
│   ├── CommoditySnapshot.js           #   Commodity price history
│   ├── Earthquake.js                  #   Earthquake events
│   ├── Event.js                       #   Community events
│   ├── GeomagneticStorm.js            #   Geomagnetic storm events
│   ├── Neo.js                         #   Near-Earth objects
│   ├── NewgroundsProfile.js           #   Newgrounds user profiles
│   ├── Product.js                     #   Product listings
│   ├── SolarFlare.js                  #   Solar flare events
│   ├── Trend.js                       #   Social media trends
│   ├── WeatherSnapshot.js             #   Weather snapshots
│   └── Webcam.js                      #   Webcam metadata and snapshots
│
├── middleware/                        # Express middleware
│   ├── FieldProjectionMiddleware.js   #   Sparse fieldsets (?fields=a,b.c)
│   ├── RequestLoggerMiddleware.js     #   Console + MongoDB request logging
│   └── ToolCallLoggerMiddleware.js    #   Tool call tracking middleware
│
├── services/                          # Business logic services
│   ├── FreshnessService.js            #   Data freshness tracking
│   ├── RateLimiterService.js          #   Per-source rate limiting
│   ├── ToolSchemaService.js           #   LLM function-calling tool definitions
│   ├── LocationService.js             #   Geocoding and location utilities
│   ├── ChartService.js                #   Chart.js server-side image generation
│   ├── CrawlerService.js              #   Crawlee-based web crawling
│   ├── PrismService.js                #   Prism AI gateway client
│   ├── TwilioService.js               #   SMS/messaging via Twilio
│   ├── McpAdapter.js                  #   Model Context Protocol adapter
│   ├── JavaScriptInterpreterService.js #  Sandboxed JS code execution
│   ├── PythonInterpreterService.js    #   Python code execution via subprocess
│   ├── ShellExecutorService.js        #   Shell command execution service
│   ├── AgenticFileService.js          #   File system operations for agents
│   ├── AgenticGitService.js           #   Git operations for agents
│   ├── AgenticBrowserService.js       #   Browser automation for agents
│   ├── AgenticCommandService.js       #   Command execution for agents
│   ├── AgenticProjectService.js       #   Project scaffolding for agents
│   ├── AgenticTaskService.js          #   Task tracking for agents
│   ├── AgenticWebService.js           #   Web interaction for agents
│   ├── AgenticLspService.js           #   LSP integration for agents
│   ├── AgenticToolTestService.js      #   Tool testing for agents
│   └── lsp/                           #   Language Server Protocol integration
│       ├── LspClient.js               #   LSP JSON-RPC client
│       ├── LspServerInstance.js        #   Individual LSP server process
│       ├── LspServerManager.js        #   LSP server lifecycle manager
│       └── lspConfig.js               #   LSP server configuration
│
├── tests/                             # Integration tests (Node.js test runner)
│   ├── EventEndpoints.test.js
│   ├── FieldProjectionMiddleware.test.js
│   ├── FinanceEndpoints.test.js
│   ├── HealthDrugEndpoints.test.js
│   ├── KnowledgeEndpoints.test.js
│   ├── MarketEndpoints.test.js
│   ├── NutritionEndpoints.test.js
│   ├── NutritionFetcher.test.js
│   ├── ProductEndpoints.test.js
│   ├── StaticDatasetEndpoints.test.js
│   ├── TransitAndHealthEndpoints.test.js
│   ├── TrendEndpoints.test.js
│   ├── UtilityEndpoints.test.js
│   ├── WeatherEndpoints.test.js
│   └── WebExtractionEndpoints.test.js
│
├── scripts/                           # Utility and migration scripts
│   ├── dump-unprocessed.js            #   Export unprocessed data
│   ├── fetch-exercises.js             #   Fetch exercise data
│   ├── fetch-wger.js                  #   Fetch wger exercise database
│   ├── generate-user-summaries.js     #   Generate Newgrounds user summaries
│   ├── get-next-user.js               #   Get next user for processing
│   ├── match-clockcrew-newgrounds.js  #   Match Clock Crew to Newgrounds profiles
│   ├── migrate-clockcrew-db.js        #   Clock Crew DB migration
│   ├── migrate-newgrounds-db.js       #   Newgrounds DB migration
│   ├── save-md-to-db.js              #   Save markdown files to MongoDB
│   ├── scrape-clockcrew.js            #   Clock Crew web scraper
│   └── scrape-newgrounds.js           #   Newgrounds web scraper
│
├── user_summaries/                    # Generated Newgrounds user profile summaries
├── secrets.example.js                 # Template for secrets.js
├── eslint.config.js                   # ESLint flat config
├── .prettierrc                        # Prettier config
└── .vscode/                           # VS Code settings (format on save)
```

## 📜 Scripts

| Script                 | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm start`            | Start the server                         |
| `npm run dev`          | Start with nodemon (hot-reload)          |
| `npm test`             | Run all integration tests                |
| `npm run test:weather` | Run weather endpoint tests               |
| `npm run test:events`  | Run event endpoint tests                 |
| `npm run test:finance` | Run finance endpoint tests               |
| `npm run test:market`  | Run market endpoint tests                |
| `npm run test:products`| Run product endpoint tests               |
| `npm run test:trends`  | Run trend endpoint tests                 |
| `npm run test:knowledge` | Run knowledge endpoint tests           |
| `npm run test:drugs`   | Run drug endpoint tests                  |
| `npm run test:utility` | Run utility endpoint tests               |
| `npm run test:transit` | Run transit endpoint tests               |
| `npm run test:nutrition` | Run nutrition endpoint tests           |
| `npm run test:projection` | Run field projection middleware tests |
| `npm run test:static`  | Run static dataset validation tests      |
| `npm run test:endpoints` | Run nutrition endpoint tests           |
| `npm run lint`         | Run ESLint                               |
| `npm run lint:fix`     | Run ESLint with auto-fix                 |
| `npm run format`       | Format all files with Prettier           |
| `npm run format:check` | Check formatting                         |

## ☀️ Part of [Sun](https://github.com/rodrigo-barraza)

Tools API is one service in the Sun ecosystem — a collection of composable backend services and frontends designed to be mixed and matched.
