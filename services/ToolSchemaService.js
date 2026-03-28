// ============================================================
// Tool Schema Service — Single Source of Truth
// ============================================================
// Defines all AI-callable tool schemas for the Sun ecosystem.
// Each tool includes:
//   - name, description, parameters (JSON Schema for LLM)
//   - endpoint metadata (path, pathParams, queryParams)
//     so clients can build executors dynamically.
//
// Consumed by:
//   - tools-api: GET /admin/tool-schemas
//   - retina: fetches schemas and builds a generic executor
// ============================================================

// ────────────────────────────────────────────────────────────
// Available Fields — per-tool field enums
// ────────────────────────────────────────────────────────────

const FIELDS = {
  // Weather current: from WeatherCache.getCurrent()
  WEATHER_CURRENT: [
    "temperature",
    "apparentTemperature",
    "humidity",
    "weatherCode",
    "weatherDescription",
    "cloudCover",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "windSpeed",
    "windDirection",
    "windGust",
    "pressure",
    "isDay",
    "uvIndex",
    "sunrise",
    "sunset",
    "daylightDuration",
    "usAqi",
    "europeanAqi",
    "pm25",
    "pm10",
    "ozone",
    "carbonMonoxide",
    "nitrogenDioxide",
    "dust",
  ],

  // Weather forecast: arrays of hourly/daily forecast objects
  WEATHER_FORECAST: [
    "time",
    "temperature",
    "temperatureMax",
    "temperatureMin",
    "apparentTemperature",
    "humidity",
    "precipitationProbability",
    "precipitation",
    "weatherCode",
    "cloudCover",
    "windSpeed10m",
    "windGusts10m",
    "uvIndex",
    "sunrise",
    "sunset",
  ],

  // Air quality: from WeatherCache.getAirQuality()
  AIR_QUALITY: [
    "usAqi",
    "europeanAqi",
    "pm25",
    "pm10",
    "ozone",
    "carbonMonoxide",
    "nitrogenDioxide",
    "dust",
  ],

  // Earthquakes: from EarthquakeFetcher normalized shape
  EARTHQUAKES: [
    "usgsId",
    "magnitude",
    "magnitudeType",
    "magnitudeClass",
    "place",
    "time",
    "url",
    "felt",
    "alert",
    "tsunami",
    "significance",
    "title",
    "latitude",
    "longitude",
    "depth",
  ],

  // Space weather summary: from SpaceWeatherCache.getSpaceWeatherSummary()
  SOLAR_ACTIVITY: [
    "flareCount",
    "cmeCount",
    "stormCount",
    "strongestFlare.flrId",
    "strongestFlare.beginTime",
    "strongestFlare.peakTime",
    "strongestFlare.classType",
    "strongestFlare.sourceLocation",
    "fastestCme.activityId",
    "fastestCme.startTime",
    "fastestCme.speed",
    "fastestCme.type",
    "fastestCme.isEarthDirected",
    "fastestCme.estimatedArrival",
    "earthDirectedCmes",
    "lastFetch",
  ],

  // Aurora/Kp index: from KpIndexCache.getCurrentKp()
  AURORA: [
    "current",
    "classification",
    "peak24h",
    "peakClassification",
    "lastFetch",
  ],

  // Twilight: from TwilightFetcher
  TWILIGHT: [
    "sunrise",
    "sunset",
    "solarNoon",
    "dayLength",
    "civilTwilightBegin",
    "civilTwilightEnd",
    "nauticalTwilightBegin",
    "nauticalTwilightEnd",
    "astronomicalTwilightBegin",
    "astronomicalTwilightEnd",
  ],

  // Tides: from TideCache.getTides()
  TIDES: ["time", "height", "type", "stationId"],

  // Wildfires: from WildfireFetcher
  WILDFIRES: [
    "eonetId",
    "title",
    "description",
    "status",
    "coordinates.lat",
    "coordinates.lng",
    "magnitudeValue",
    "magnitudeUnit",
    "date",
    "sourceUrl",
  ],

  // ISS: from IssCache.getIssData()
  ISS: [
    "position.latitude",
    "position.longitude",
    "position.timestamp",
    "astronauts.total",
    "astronauts.people",
    "lastPositionFetch",
    "lastAstrosFetch",
  ],

  // NEO: from NeoCache.getNeoSummary()
  NEO: [
    "total",
    "hazardousCount",
    "closest.name",
    "closest.missDistanceKm",
    "closest.missDistanceLunar",
    "closest.isPotentiallyHazardous",
    "closest.estimatedDiameterMaxKm",
    "closest.relativeVelocityKmPerSec",
    "largest.name",
    "largest.estimatedDiameterMaxKm",
    "lastFetch",
  ],

  // Solar Wind: from SolarWindCache.getSolarWindLatest()
  SOLAR_WIND: [
    "time",
    "speed",
    "density",
    "temperature",
    "bz",
    "bt",
    "bx",
    "by",
    "lastFetch",
  ],

  // Pollen: from PollenCache.getPollenToday()
  POLLEN: [
    "date",
    "grass.displayName",
    "grass.indexInfo.value",
    "grass.indexInfo.category",
    "grass.inSeason",
    "tree.displayName",
    "tree.indexInfo.value",
    "tree.indexInfo.category",
    "tree.inSeason",
    "weed.displayName",
    "weed.indexInfo.value",
    "weed.indexInfo.category",
    "weed.inSeason",
    "regionCode",
    "lastFetch",
  ],

  // APOD: from ApodCache.getApod()
  APOD: [
    "title",
    "explanation",
    "date",
    "url",
    "hdUrl",
    "mediaType",
    "copyright",
    "lastFetch",
  ],

  // Launches: from LaunchCache.getLaunchSummary()
  LAUNCHES: [
    "count",
    "upcomingCount",
    "next.name",
    "next.status",
    "next.net",
    "next.provider",
    "next.rocket",
    "next.mission",
    "next.missionType",
    "next.missionDescription",
    "next.padName",
    "next.padLocation",
    "next.imageUrl",
    "providers",
    "lastFetch",
  ],

  // Weather Warnings: from EnvironmentCanadaCache.getWarnings()
  WEATHER_WARNINGS: ["count", "warnings", "lastFetch"],

  // Avalanche: from AvalancheCache.getAvalanche()
  AVALANCHE: ["count", "forecasts", "lastFetch"],

  // Google Air Quality: from GoogleAirQualityCache.getGoogleAirQuality()
  GOOGLE_AIR_QUALITY: [
    "universalAqi",
    "universalAqiCategory",
    "universalAqiDominantPollutant",
    "usEpaAqi",
    "usEpaCategory",
    "usEpaDominantPollutant",
    "pollutants",
    "healthRecommendations",
    "regionCode",
    "lastFetch",
  ],

  // Events: from TicketmasterFetcher normalized schema
  EVENTS: [
    "name",
    "description",
    "source",
    "category",
    "startDate",
    "endDate",
    "url",
    "imageUrl",
    "status",
    "genres",
    "priceRange.min",
    "priceRange.max",
    "priceRange.currency",
    "venue.name",
    "venue.address",
    "venue.city",
    "venue.state",
    "venue.country",
    "venue.latitude",
    "venue.longitude",
    "mapImageUrl",
  ],

  // Event Summary: from EventCache.getEventSummary()
  EVENT_SUMMARY: [
    "total",
    "today",
    "upcoming",
    "byCategory",
    "bySource",
    "lastFetch",
  ],

  // Commodities summary: from CommodityCache.getCommoditySummary()
  COMMODITIES_SUMMARY: [
    "total",
    "gainers",
    "losers",
    "byCategory",
    "lastFetch",
  ],

  // Commodity items: individual commodity data
  COMMODITY: [
    "ticker",
    "name",
    "price",
    "change",
    "changePercent",
    "category",
    "unit",
    "dayHigh",
    "dayLow",
    "previousClose",
    "volume",
  ],

  // Commodity History: from CommoditySnapshot model
  COMMODITY_HISTORY: ["ticker", "hours", "count", "snapshots"],

  // Trends: from GoogleTrendsFetcher normalized schema
  TRENDS: [
    "name",
    "normalizedName",
    "source",
    "volume",
    "url",
    "context.subreddit",
    "context.author",
    "context.commentCount",
    "context.upvoteRatio",
    "context.flair",
    "context.created",
    "context.description",
    "context.views",
    "context.stars",
    "context.forks",
    "context.language",
    "context.publisher",
    "context.publishedAt",
    "category",
    "timestamp",
  ],

  // Products: from BestBuyFetcher normalized schema
  PRODUCTS: [
    "name",
    "source",
    "category",
    "price",
    "currency",
    "rating",
    "reviewCount",
    "imageUrl",
    "productUrl",
    "description",
    "trendingScore",
    "rank",
  ],

  // Product Availability: from BestBuyCAAvailabilityCache
  PRODUCT_AVAILABILITY: ["count", "lastCheck", "inStockCount", "results"],

  // Finnhub quote: from FinnhubFetcher.fetchStockQuote()
  STOCK_QUOTE: ["symbol", "c", "d", "dp", "h", "l", "o", "pc", "t", "cached"],

  // Finnhub company profile: from Finnhub API /stock/profile2
  COMPANY_PROFILE: [
    "country",
    "currency",
    "exchange",
    "finnhubIndustry",
    "ipo",
    "logo",
    "marketCapitalization",
    "name",
    "phone",
    "shareOutstanding",
    "ticker",
    "weburl",
  ],

  // Market news articles: from Finnhub /news
  MARKET_NEWS: [
    "category",
    "datetime",
    "headline",
    "id",
    "image",
    "related",
    "source",
    "summary",
    "url",
  ],

  // Earnings calendar: from Finnhub /calendar/earnings
  EARNINGS: [
    "date",
    "epsActual",
    "epsEstimate",
    "hour",
    "quarter",
    "revenueActual",
    "revenueEstimate",
    "symbol",
    "year",
  ],

  // Analyst recommendations: from Finnhub /stock/recommendation
  RECOMMENDATION: [
    "buy",
    "hold",
    "period",
    "sell",
    "strongBuy",
    "strongSell",
    "symbol",
  ],

  // Basic financials: from Finnhub /stock/metric
  FINANCIALS: [
    "symbol",
    "metric.52WeekHigh",
    "metric.52WeekLow",
    "metric.beta",
    "metric.peAnnual",
    "metric.peNTM",
    "metric.epsAnnual",
    "metric.epsGrowthTTMYoy",
    "metric.dividendYieldIndicatedAnnual",
    "metric.marketCapitalization",
    "metric.revenuePerShareAnnual",
    "metric.roaRfy",
    "metric.roeRfy",
    "metric.currentRatioAnnual",
    "metric.debtEquityAnnual",
    "metric.10DayAverageTradingVolume",
    "metric.3MonthAverageTradingVolume",
  ],

  // ── Knowledge Domain ──────────────────────────────────────────

  // Dictionary: from DictionaryFetcher.fetchDefinition()
  DICTIONARY: [
    "word",
    "found",
    "phonetic",
    "phonetics",
    "meanings",
    "sourceUrls",
  ],

  // Books: from OpenLibraryFetcher.searchBooks()
  BOOKS: [
    "key",
    "title",
    "authors",
    "firstPublishYear",
    "coverUrl",
    "subjects",
    "editionCount",
    "rating",
    "ratingCount",
    "isbn",
  ],

  // Book Details: from OpenLibraryFetcher.getBookDetails()
  BOOK_DETAILS: [
    "key",
    "title",
    "description",
    "subjects",
    "coverUrl",
    "firstPublishDate",
    "links",
  ],

  // Author: from OpenLibraryFetcher.getAuthorInfo()
  AUTHOR: [
    "key",
    "name",
    "bio",
    "birthDate",
    "deathDate",
    "photoUrl",
    "wikipedia",
    "alternateNames",
  ],

  // Countries: from RestCountriesFetcher
  COUNTRIES: [
    "name",
    "officialName",
    "cca2",
    "cca3",
    "capital",
    "region",
    "subregion",
    "population",
    "area",
    "languages",
    "currencies",
    "timezones",
    "borders",
    "flag",
    "flagPng",
    "continent",
    "callingCodes",
    "independent",
    "landlocked",
  ],

  // Papers: from ArxivFetcher.searchPapers()
  PAPERS: [
    "arxivId",
    "title",
    "abstract",
    "authors",
    "published",
    "updated",
    "primaryCategory",
    "categories",
    "pdfUrl",
    "abstractUrl",
    "doi",
    "comment",
  ],

  // Wikipedia Summary: from WikipediaSummaryFetcher
  WIKIPEDIA_SUMMARY: [
    "found",
    "title",
    "displayTitle",
    "extract",
    "description",
    "thumbnail",
    "originalImage",
    "pageUrl",
    "lastModified",
  ],

  // On This Day: from WikipediaSummaryFetcher.getOnThisDay()
  ON_THIS_DAY: [
    "date",
    "type",
    "count",
    "events",
  ],

  // ── Health Domain ─────────────────────────────────────────────

  // Food Products: from OpenFoodFactsFetcher
  FOOD_PRODUCT: [
    "code",
    "name",
    "brand",
    "categories",
    "imageUrl",
    "quantity",
    "nutriScore",
    "novaGroup",
    "ecoScore",
    "nutrition.calories",
    "nutrition.fat",
    "nutrition.saturatedFat",
    "nutrition.carbohydrates",
    "nutrition.sugars",
    "nutrition.fiber",
    "nutrition.proteins",
    "nutrition.salt",
    "allergens",
    "ingredients",
    "servingSize",
    "url",
  ],

  // Drug Labels: from OpenFdaFetcher
  DRUG_LABEL: [
    "brandName",
    "genericName",
    "manufacturer",
    "route",
    "substanceName",
    "indications",
    "warnings",
    "adverseReactions",
    "dosage",
    "contraindications",
    "drugInteractions",
  ],

  // Drug Adverse Events: from OpenFdaFetcher
  DRUG_ADVERSE_EVENTS: [
    "safetyReportId",
    "receiveDate",
    "serious",
    "seriousnessDetails",
    "reactions",
    "patientAge",
    "patientSex",
  ],

  // Drug Recalls: from OpenFdaFetcher
  DRUG_RECALLS: [
    "recallNumber",
    "status",
    "classification",
    "reportDate",
    "recallingFirm",
    "reason",
    "productDescription",
    "distribution",
  ],

  // ── Transit Domain ────────────────────────────────────────────

  // Next Bus: from TransLinkFetcher
  NEXT_BUS: [
    "stopNo",
    "count",
    "routes",
  ],

  // Stop Info: from TransLinkFetcher
  STOP_INFO: [
    "stopNo",
    "name",
    "city",
    "onStreet",
    "atStreet",
    "latitude",
    "longitude",
    "wheelchairAccess",
    "routes",
  ],

  // Nearby Stops: from TransLinkFetcher
  NEARBY_STOPS: [
    "count",
    "stops",
  ],

  // Route Info: from TransLinkFetcher
  ROUTE_INFO: [
    "routeNo",
    "name",
    "operatingCompany",
    "patterns",
  ],

  // ── Utility Domain ────────────────────────────────────────────

  // Currency Conversion: from CurrencyFetcher
  CURRENCY_CONVERT: [
    "from",
    "to",
    "amount",
    "rate",
    "converted",
    "lastUpdate",
  ],

  // Timezone: from TimezoneFetcher
  TIMEZONE: [
    "found",
    "timezone",
    "datetime",
    "abbreviation",
    "utcOffset",
    "dayOfWeek",
    "isDst",
    "dstFrom",
    "dstUntil",
  ],
};

// ────────────────────────────────────────────────────────────
// Helper — builds field description for tool parameters
// ────────────────────────────────────────────────────────────

function fieldsParam(fieldEnum) {
  return {
    fields: {
      type: "string",
      description: `Comma-separated list of fields to return. Available: ${fieldEnum.join(", ")}`,
    },
  };
}

// ────────────────────────────────────────────────────────────
// Tool Definitions — JSON Schema + endpoint metadata
// ────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  // ── Weather / Environment ──────────────────────────────────
  {
    name: "get_current_weather",
    description:
      "Get current weather conditions including temperature, humidity, wind, UV index, feels-like temperature, precipitation, and air quality indicators.",
    endpoint: { path: "/weather/weather/current" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.WEATHER_CURRENT) },
      required: ["fields"],
    },
  },
  {
    name: "get_weather_forecast",
    description:
      "Get multi-day weather forecast. Each forecast entry includes temperature highs/lows, precipitation probability, wind, and conditions.",
    endpoint: { path: "/weather/weather/forecast", queryParams: ["days"] },
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of forecast days (default: 7, max: 14)",
        },
        ...fieldsParam(FIELDS.WEATHER_FORECAST),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_air_quality",
    description:
      "Get current air quality data including AQI (US and European), PM2.5, PM10, ozone, and pollutant concentrations.",
    endpoint: { path: "/weather/weather/air" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.AIR_QUALITY) },
      required: ["fields"],
    },
  },
  {
    name: "get_earthquakes",
    description:
      "Get recent earthquake data. Each earthquake includes magnitude, location, depth, time, and alert level.",
    endpoint: { path: "/weather/earthquakes" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.EARTHQUAKES) },
      required: ["fields"],
    },
  },
  {
    name: "get_solar_activity",
    description:
      "Get current solar activity summary including solar flare count, CME count, geomagnetic storm count, strongest flare, fastest CME, and Earth-directed CME details.",
    endpoint: { path: "/weather/space-weather/summary" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.SOLAR_ACTIVITY) },
      required: ["fields"],
    },
  },
  {
    name: "get_aurora_forecast",
    description:
      "Get aurora/northern lights forecast including current Kp index, storm classification, and 24h peak.",
    endpoint: { path: "/weather/kp/current" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.AURORA) },
      required: ["fields"],
    },
  },
  {
    name: "get_twilight",
    description:
      "Get sunrise, sunset, solar noon, day length, and civil/nautical/astronomical twilight times for today.",
    endpoint: { path: "/weather/twilight" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.TWILIGHT) },
      required: ["fields"],
    },
  },
  {
    name: "get_tides",
    description:
      "Get tidal predictions including high and low tide times, heights, and type.",
    endpoint: { path: "/weather/tides" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.TIDES) },
      required: ["fields"],
    },
  },
  {
    name: "get_wildfires",
    description:
      "Get active wildfire data including fire title, location coordinates, magnitude, and status (open/closed).",
    endpoint: { path: "/weather/wildfires" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.WILDFIRES) },
      required: ["fields"],
    },
  },
  {
    name: "get_iss_position",
    description:
      "Get the current position (lat/lng) of the International Space Station and the list of astronauts currently aboard.",
    endpoint: { path: "/weather/iss" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.ISS) },
      required: ["fields"],
    },
  },
  {
    name: "get_near_earth_objects",
    description:
      "Get today's near-Earth objects (asteroids) summary including total count, hazardous count, closest approach, and largest object.",
    endpoint: { path: "/weather/neo/summary" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.NEO) },
      required: ["fields"],
    },
  },
  {
    name: "get_solar_wind",
    description:
      "Get latest solar wind conditions including plasma speed, density, temperature, and interplanetary magnetic field (Bz, Bt). Important for aurora and space weather assessment.",
    endpoint: { path: "/weather/solar-wind/latest" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.SOLAR_WIND) },
      required: ["fields"],
    },
  },
  {
    name: "get_pollen",
    description:
      "Get today's pollen forecast including grass, tree, and weed pollen index values, categories, and whether each type is in season.",
    endpoint: { path: "/weather/pollen/today" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.POLLEN) },
      required: ["fields"],
    },
  },
  {
    name: "get_apod",
    description:
      "Get NASA's Astronomy Picture of the Day including title, explanation, image URL, and copyright information.",
    endpoint: { path: "/weather/apod" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.APOD) },
      required: ["fields"],
    },
  },
  {
    name: "get_launches",
    description:
      "Get upcoming rocket launch summary including next launch details, provider, rocket, mission, pad location, and launch window.",
    endpoint: { path: "/weather/launches/summary" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.LAUNCHES) },
      required: ["fields"],
    },
  },
  {
    name: "get_weather_warnings",
    description:
      "Get active Environment Canada weather warnings, watches, advisories, and special weather statements for Metro Vancouver.",
    endpoint: { path: "/weather/warnings" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.WEATHER_WARNINGS) },
      required: ["fields"],
    },
  },
  {
    name: "get_avalanche_forecast",
    description:
      "Get Avalanche Canada forecast for BC regions including danger ratings (alpine/treeline/below treeline), problems, and highlights.",
    endpoint: { path: "/weather/avalanche" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.AVALANCHE) },
      required: ["fields"],
    },
  },
  {
    name: "get_google_air_quality",
    description:
      "Get detailed air quality from Google's Air Quality API including universal AQI, US EPA AQI, dominant pollutant, pollutant concentrations, and health recommendations.",
    endpoint: { path: "/weather/airquality/google" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.GOOGLE_AIR_QUALITY) },
      required: ["fields"],
    },
  },

  // ── Events ─────────────────────────────────────────────────
  {
    name: "search_events",
    description:
      "Search for local events including concerts, sports games, festivals, community gatherings, and movie releases. Can filter by source, category, and text search.",
    endpoint: {
      path: "/event/search",
      queryParams: ["q", "source", "category", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text search query for event names or descriptions",
        },
        source: {
          type: "string",
          description:
            "Filter by event source (e.g. ticketmaster, seatgeek, craigslist, ubc, sfu, city_of_vancouver, nhl, whitecaps, bc_lions, tmdb, google_places)",
        },
        category: {
          type: "string",
          description:
            "Filter by event category (music, sports, arts, comedy, family, film, food, tech, other)",
        },
        limit: {
          type: "number",
          description: "Maximum number of events to return (default: 20)",
        },
        ...fieldsParam(FIELDS.EVENTS),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_upcoming_events",
    description:
      "Get upcoming events in chronological order. Good for 'what's happening this weekend' type questions.",
    endpoint: {
      path: "/event/upcoming",
      queryParams: ["days", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days ahead to look (default: 7)",
        },
        limit: {
          type: "number",
          description: "Maximum number of events to return (default: 20)",
        },
        ...fieldsParam(FIELDS.EVENTS),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_events_today",
    description:
      "Get all events happening today. Returns events with venue, category, and timing information.",
    endpoint: { path: "/event/today" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.EVENTS) },
      required: ["fields"],
    },
  },
  {
    name: "get_event_summary",
    description:
      "Get a statistical summary of all cached events: total count, today's count, upcoming count, breakdown by category and source.",
    endpoint: { path: "/event/summary" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.EVENT_SUMMARY) },
      required: ["fields"],
    },
  },

  // ── Commodities / Markets ──────────────────────────────────
  {
    name: "get_commodities_summary",
    description:
      "Get a summary of all commodity/market prices including top gainers, top losers, and breakdown by category. Each item shows ticker, name, price, change, and percent change.",
    endpoint: { path: "/market/commodities/summary" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.COMMODITIES_SUMMARY) },
      required: ["fields"],
    },
  },
  {
    name: "get_commodity_by_category",
    description:
      "Get commodity prices filtered by category. Returns an array of commodities with ticker, name, price, change, and percent change.",
    endpoint: {
      path: "/market/commodities/category/:category",
      pathParams: ["category"],
    },
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Commodity category: energy, precious_metals, industrial_metals, agriculture, softs, livestock, lumber, index_futures, indices, bonds, forex, crypto, volatility",
          enum: [
            "energy",
            "precious_metals",
            "industrial_metals",
            "agriculture",
            "softs",
            "livestock",
            "lumber",
            "index_futures",
            "indices",
            "bonds",
            "forex",
            "crypto",
            "volatility",
          ],
        },
        ...fieldsParam(FIELDS.COMMODITY),
      },
      required: ["category", "fields"],
    },
  },
  {
    name: "get_commodity_ticker",
    description:
      "Get detailed data for a specific commodity/market ticker symbol.",
    endpoint: {
      path: "/market/commodities/ticker/:ticker",
      pathParams: ["ticker"],
    },
    parameters: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description:
            "Ticker symbol (e.g. CL=F for crude oil, GC=F for gold, SI=F for silver, BTC-USD for Bitcoin, ^GSPC for S&P 500)",
        },
        ...fieldsParam(FIELDS.COMMODITY),
      },
      required: ["ticker", "fields"],
    },
  },
  {
    name: "get_commodity_categories",
    description:
      "Get a list of all available commodity categories (energy, precious_metals, crypto, forex, etc.).",
    endpoint: { path: "/market/commodities/categories" },
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_commodity_history",
    description:
      "Get price history snapshots for a specific commodity ticker over a time window.",
    endpoint: {
      path: "/market/commodities/history/:ticker",
      pathParams: ["ticker"],
      queryParams: ["hours"],
    },
    parameters: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description:
            "Ticker symbol (e.g. GC=F for gold, BTC-USD for Bitcoin)",
        },
        hours: {
          type: "number",
          description: "Time window in hours (default: 24)",
        },
        ...fieldsParam(FIELDS.COMMODITY_HISTORY),
      },
      required: ["ticker", "fields"],
    },
  },

  // ── Trends ─────────────────────────────────────────────────
  {
    name: "get_trends",
    description:
      "Get currently trending topics aggregated from multiple sources including Google Trends, Reddit, Wikipedia, Hacker News, X (Twitter), Bluesky, Mastodon, and news.",
    endpoint: {
      path: "/trend/trends",
      conditionalPath: {
        param: "source",
        template: "/trend/trends/source/:source",
      },
    },
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "Filter by trend source: google_trends, reddit, wikipedia, hackernews, x, mastodon, bluesky, google_news, producthunt, tv, github",
        },
        ...fieldsParam(FIELDS.TRENDS),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_hot_trends",
    description:
      "Get cross-platform correlated trending topics — topics appearing in 2+ sources simultaneously. Shows which topics are truly viral across Google, Reddit, X, news, etc.",
    endpoint: { path: "/trend/trends/hot" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.TRENDS) },
      required: ["fields"],
    },
  },
  {
    name: "get_top_trends",
    description:
      "Get the highest-volume trending topics from the database over a configurable time window. Aggregated across all sources.",
    endpoint: {
      path: "/trend/trends/top",
      queryParams: ["hours", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "Time window in hours (default: 24)",
        },
        limit: {
          type: "number",
          description: "Maximum number of trends to return (default: 20)",
        },
        ...fieldsParam(FIELDS.TRENDS),
      },
      required: ["fields"],
    },
  },

  // ── Products ───────────────────────────────────────────────
  {
    name: "search_products",
    description:
      "Search for products with pricing, ratings, and deal information from Best Buy, Amazon, eBay, Etsy, Product Hunt, Costco US, and Costco Canada.",
    endpoint: {
      path: "/product/products/search",
      queryParams: ["q", "category", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product search query",
        },
        category: {
          type: "string",
          description: "Product category filter",
        },
        limit: {
          type: "number",
          description: "Maximum number of products to return (default: 20)",
        },
        ...fieldsParam(FIELDS.PRODUCTS),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_trending_products",
    description:
      "Get currently trending products ranked by trending score. Shows top deals and popular items.",
    endpoint: {
      path: "/product/products/trending",
      queryParams: ["limit"],
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of products to return (default: 50)",
        },
        ...fieldsParam(FIELDS.PRODUCTS),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_product_availability",
    description:
      "Get Best Buy Canada product availability for all monitored watchlist items. Shows in-stock/out-of-stock status.",
    endpoint: { path: "/product/products/availability" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.PRODUCT_AVAILABILITY) },
      required: ["fields"],
    },
  },
  {
    name: "check_product_availability",
    description:
      "Check Best Buy Canada availability for specific SKUs on demand. Useful for checking arbitrary products not on the watchlist.",
    endpoint: {
      path: "/product/products/availability/check",
      queryParams: ["skus"],
    },
    parameters: {
      type: "object",
      properties: {
        skus: {
          type: "string",
          description: "Comma-separated list of Best Buy SKU numbers to check",
        },
        ...fieldsParam(FIELDS.PRODUCT_AVAILABILITY),
      },
      required: ["skus", "fields"],
    },
  },
  {
    name: "get_costco_us_products",
    description:
      "Get products from Costco US (costco.com) including laptops, desktops, TVs, phones, tablets, headphones, speakers, cameras, video games, and appliances. Shows name, price (USD), rating, and product URL.",
    endpoint: {
      path: "/product/products/source/costco_us",
    },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.PRODUCTS) },
      required: ["fields"],
    },
  },
  {
    name: "get_costco_ca_products",
    description:
      "Get products from Costco Canada (costco.ca) including laptops, desktops, TVs, phones, tablets, headphones, speakers, cameras, video games, and appliances. Shows name, price (CAD), rating, and product URL.",
    endpoint: {
      path: "/product/products/source/costco_ca",
    },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.PRODUCTS) },
      required: ["fields"],
    },
  },

  // ── Finance / Stocks (Finnhub) ─────────────────────────────
  {
    name: "get_stock_quote",
    description:
      "Get real-time stock quote. Fields: c=current price, d=change, dp=percent change, h=day high, l=day low, o=open, pc=previous close, t=timestamp.",
    endpoint: {
      path: "/finance/quote/:symbol",
      pathParams: ["symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Stock ticker symbol (e.g. AAPL, MSFT, GOOGL)",
        },
        ...fieldsParam(FIELDS.STOCK_QUOTE),
      },
      required: ["symbol", "fields"],
    },
  },
  {
    name: "get_company_profile",
    description:
      "Get company profile including name, industry, market capitalization, shares outstanding, logo, and website.",
    endpoint: {
      path: "/finance/profile/:symbol",
      pathParams: ["symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Stock ticker symbol (e.g. AAPL)",
        },
        ...fieldsParam(FIELDS.COMPANY_PROFILE),
      },
      required: ["symbol", "fields"],
    },
  },
  {
    name: "get_market_news",
    description:
      "Get latest market news articles. Can optionally filter by company symbol for company-specific news.",
    endpoint: {
      path: "/finance/news",
      queryParams: ["symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description:
            "Optional stock symbol to get company-specific news instead of general market news",
        },
        ...fieldsParam(FIELDS.MARKET_NEWS),
      },
      required: ["fields"],
    },
  },
  {
    name: "get_earnings_calendar",
    description:
      "Get upcoming earnings calendar showing which companies are reporting earnings, with estimated and actual EPS and revenue.",
    endpoint: { path: "/finance/earnings" },
    parameters: {
      type: "object",
      properties: { ...fieldsParam(FIELDS.EARNINGS) },
      required: ["fields"],
    },
  },
  {
    name: "get_stock_recommendation",
    description:
      "Get analyst recommendation trends for a stock, including buy/hold/sell/strongBuy/strongSell counts per period.",
    endpoint: {
      path: "/finance/recommendation/:symbol",
      pathParams: ["symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Stock ticker symbol (e.g. AAPL)",
        },
        ...fieldsParam(FIELDS.RECOMMENDATION),
      },
      required: ["symbol", "fields"],
    },
  },
  {
    name: "get_stock_financials",
    description:
      "Get basic financial metrics for a stock including P/E ratio, EPS, 52-week high/low, beta, dividend yield, market cap, revenue, and profit margins.",
    endpoint: {
      path: "/finance/financials/:symbol",
      pathParams: ["symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Stock ticker symbol (e.g. AAPL)",
        },
        ...fieldsParam(FIELDS.FINANCIALS),
      },
      required: ["symbol", "fields"],
    },
  },

  // ── Knowledge ──────────────────────────────────────────────────
  {
    name: "define_word",
    description:
      "Look up a word's definition, pronunciation, phonetics (with audio URLs), synonyms, antonyms, etymology, and usage examples using the Free Dictionary API.",
    endpoint: {
      path: "/knowledge/dictionary/:word",
      pathParams: ["word"],
    },
    parameters: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "The word to look up",
        },
        ...fieldsParam(FIELDS.DICTIONARY),
      },
      required: ["word"],
    },
  },
  {
    name: "search_books",
    description:
      "Search for books by title, author, or query. Returns book metadata, cover images, ratings, author names, publication year, and edition count from Open Library (3M+ books).",
    endpoint: {
      path: "/knowledge/books/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (title, author, or keywords)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        ...fieldsParam(FIELDS.BOOKS),
      },
      required: ["query"],
    },
  },
  {
    name: "get_book_details",
    description:
      "Get detailed information about a specific book by its Open Library work key. Returns description, subjects, cover image, links, and publication date.",
    endpoint: {
      path: "/knowledge/books/work/:workKey",
      pathParams: ["workKey"],
    },
    parameters: {
      type: "object",
      properties: {
        workKey: {
          type: "string",
          description: "Open Library work key (e.g. 'OL45883W')",
        },
        ...fieldsParam(FIELDS.BOOK_DETAILS),
      },
      required: ["workKey"],
    },
  },
  {
    name: "get_author_info",
    description:
      "Get author biography, birth/death dates, photo, and Wikipedia link from Open Library.",
    endpoint: {
      path: "/knowledge/books/author/:authorKey",
      pathParams: ["authorKey"],
    },
    parameters: {
      type: "object",
      properties: {
        authorKey: {
          type: "string",
          description: "Open Library author key (e.g. 'OL23919A')",
        },
        ...fieldsParam(FIELDS.AUTHOR),
      },
      required: ["authorKey"],
    },
  },
  {
    name: "get_country_info",
    description:
      "Get detailed information about a country by name. Returns population, capital, languages, currencies, timezones, borders, flag, continent, calling codes, and more.",
    endpoint: {
      path: "/knowledge/countries/search/:name",
      pathParams: ["name"],
    },
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Country name (partial match supported, e.g. 'Canada', 'Japan')",
        },
        ...fieldsParam(FIELDS.COUNTRIES),
      },
      required: ["name"],
    },
  },
  {
    name: "get_country_by_code",
    description:
      "Get country information by ISO country code (2 or 3 letter). Returns full country details.",
    endpoint: {
      path: "/knowledge/countries/code/:code",
      pathParams: ["code"],
    },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "ISO 3166-1 alpha-2 or alpha-3 code (e.g. 'CA', 'CAN', 'US', 'JP')",
        },
        ...fieldsParam(FIELDS.COUNTRIES),
      },
      required: ["code"],
    },
  },
  {
    name: "search_papers",
    description:
      "Search academic papers on arXiv. Returns titles, abstracts, authors, publication dates, PDF links, and category classifications. Covers CS, physics, math, biology, economics, and more.",
    endpoint: {
      path: "/knowledge/papers/search",
      queryParams: ["q", "category", "limit", "sortBy"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for paper titles/abstracts",
        },
        category: {
          type: "string",
          description:
            "arXiv category filter (e.g. cs.AI, cs.LG, cs.CL, cs.CV, cs.SE, physics, math, econ, stat)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10, max: 30)",
        },
        sortBy: {
          type: "string",
          description: "Sort order: relevance, lastUpdatedDate, submittedDate",
          enum: ["relevance", "lastUpdatedDate", "submittedDate"],
        },
        ...fieldsParam(FIELDS.PAPERS),
      },
      required: ["query"],
    },
  },
  {
    name: "get_wikipedia_summary",
    description:
      "Get a summary of any Wikipedia article including extract text, thumbnail image, description, and page URL. Good for quick factual lookups.",
    endpoint: {
      path: "/knowledge/wikipedia/summary/:title",
      pathParams: ["title"],
    },
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Wikipedia article title (e.g. 'Albert Einstein', 'Machine learning')",
        },
        ...fieldsParam(FIELDS.WIKIPEDIA_SUMMARY),
      },
      required: ["title"],
    },
  },
  {
    name: "get_on_this_day",
    description:
      "Get historical events, births, deaths, or holidays that happened on a specific date from Wikipedia. Defaults to today if no date specified.",
    endpoint: {
      path: "/knowledge/wikipedia/onthisday",
      queryParams: ["type", "month", "day"],
    },
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Type of events: selected, births, deaths, events, holidays",
          enum: ["selected", "births", "deaths", "events", "holidays"],
        },
        month: {
          type: "number",
          description: "Month (1-12), defaults to today",
        },
        day: {
          type: "number",
          description: "Day (1-31), defaults to today",
        },
        ...fieldsParam(FIELDS.ON_THIS_DAY),
      },
    },
  },

  // ── Health ─────────────────────────────────────────────────────
  {
    name: "search_food_nutrition",
    description:
      "Search for food products and get nutritional information including calories, macros (fat, carbs, protein, fiber, sugar), Nutri-Score, allergens, and ingredients from Open Food Facts (3M+ products).",
    endpoint: {
      path: "/health/food/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Food product name to search for",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        ...fieldsParam(FIELDS.FOOD_PRODUCT),
      },
      required: ["query"],
    },
  },
  {
    name: "get_food_by_barcode",
    description:
      "Look up a specific food product by its barcode (EAN/UPC). Returns full nutritional data, Nutri-Score, allergens, and ingredients.",
    endpoint: {
      path: "/health/food/barcode/:barcode",
      pathParams: ["barcode"],
    },
    parameters: {
      type: "object",
      properties: {
        barcode: {
          type: "string",
          description: "Product barcode (EAN-13 or UPC-A)",
        },
        ...fieldsParam(FIELDS.FOOD_PRODUCT),
      },
      required: ["barcode"],
    },
  },
  {
    name: "search_drug_info",
    description:
      "Search FDA drug labels by brand or generic name. Returns indications, warnings, side effects, dosage, contraindications, and drug interactions.",
    endpoint: {
      path: "/health/drugs/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Drug name (brand or generic, e.g. 'Tylenol', 'Acetaminophen')",
        },
        limit: {
          type: "number",
          description: "Max results (default: 5)",
        },
        ...fieldsParam(FIELDS.DRUG_LABEL),
      },
      required: ["query"],
    },
  },
  {
    name: "get_drug_adverse_events",
    description:
      "Get FDA adverse event reports for a drug, including reported reactions, seriousness (death, hospitalization, life-threatening), and patient demographics.",
    endpoint: {
      path: "/health/drugs/adverse-events",
      queryParams: ["drug", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        drug: {
          type: "string",
          description: "Drug name (brand or generic)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        ...fieldsParam(FIELDS.DRUG_ADVERSE_EVENTS),
      },
      required: ["drug"],
    },
  },
  {
    name: "get_drug_recalls",
    description:
      "Get FDA drug recall and enforcement actions. Returns recall classification, reason, affected products, and recalling firm.",
    endpoint: {
      path: "/health/drugs/recalls",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional search term for recalls (drug name or keyword)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        ...fieldsParam(FIELDS.DRUG_RECALLS),
      },
    },
  },

  // ── Transit (TransLink Vancouver) ──────────────────────────────
  {
    name: "get_next_bus",
    description:
      "Get real-time bus arrival estimates for a TransLink (Vancouver) bus stop. Shows route, direction, expected arrival time, countdown, schedule status, and whether the trip is cancelled.",
    endpoint: {
      path: "/transit/nextbus/:stopNo",
      pathParams: ["stopNo"],
      queryParams: ["route"],
    },
    parameters: {
      type: "object",
      properties: {
        stopNo: {
          type: "number",
          description: "5-digit TransLink bus stop number (e.g. 51479)",
        },
        route: {
          type: "string",
          description: "Optional route number filter (e.g. '99', '014')",
        },
        ...fieldsParam(FIELDS.NEXT_BUS),
      },
      required: ["stopNo"],
    },
  },
  {
    name: "get_transit_stop_info",
    description:
      "Get details about a TransLink bus stop including name, street intersection, city, coordinates, wheelchair access, and which routes serve it.",
    endpoint: {
      path: "/transit/stops/:stopNo",
      pathParams: ["stopNo"],
    },
    parameters: {
      type: "object",
      properties: {
        stopNo: {
          type: "number",
          description: "5-digit TransLink bus stop number",
        },
        ...fieldsParam(FIELDS.STOP_INFO),
      },
      required: ["stopNo"],
    },
  },
  {
    name: "find_transit_stops_nearby",
    description:
      "Find TransLink bus stops near a location. Returns nearby stops with names, distances, and route numbers. Defaults to Vancouver downtown if no coordinates provided.",
    endpoint: {
      path: "/transit/stops/nearby",
      queryParams: ["lat", "lng", "radius"],
    },
    parameters: {
      type: "object",
      properties: {
        lat: {
          type: "number",
          description: "Latitude (default: Vancouver downtown)",
        },
        lng: {
          type: "number",
          description: "Longitude (default: Vancouver downtown)",
        },
        radius: {
          type: "number",
          description: "Search radius in meters (default: 500, max: 2000)",
        },
        ...fieldsParam(FIELDS.NEARBY_STOPS),
      },
    },
  },
  {
    name: "get_transit_route_info",
    description:
      "Get details about a TransLink bus/SkyTrain route including name, operating company, and pattern destinations.",
    endpoint: {
      path: "/transit/routes/:routeNo",
      pathParams: ["routeNo"],
    },
    parameters: {
      type: "object",
      properties: {
        routeNo: {
          type: "string",
          description: "Route number (e.g. '99', '014', 'R4')",
        },
        ...fieldsParam(FIELDS.ROUTE_INFO),
      },
      required: ["routeNo"],
    },
  },

  // ── Utilities ──────────────────────────────────────────────────
  {
    name: "convert_currency",
    description:
      "Convert an amount between any two currencies using real-time exchange rates. Supports 161 currencies including USD, CAD, EUR, GBP, JPY, etc.",
    endpoint: {
      path: "/utility/currency/convert",
      queryParams: ["amount", "from", "to"],
    },
    parameters: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Amount to convert (default: 1)",
        },
        from: {
          type: "string",
          description: "Source currency code (e.g. 'USD', 'CAD', 'EUR')",
        },
        to: {
          type: "string",
          description: "Target currency code (e.g. 'CAD', 'JPY', 'GBP')",
        },
        ...fieldsParam(FIELDS.CURRENCY_CONVERT),
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_time_in_timezone",
    description:
      "Get the current time in any timezone worldwide. Returns datetime, UTC offset, DST status, abbreviation, and day of week.",
    endpoint: {
      path: "/utility/timezone/:area/:location",
      pathParams: ["area", "location"],
    },
    parameters: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description: "Timezone area (e.g. 'America', 'Europe', 'Asia', 'Pacific')",
        },
        location: {
          type: "string",
          description: "Timezone location (e.g. 'Vancouver', 'Tokyo', 'London', 'New_York')",
        },
        ...fieldsParam(FIELDS.TIMEZONE),
      },
      required: ["area", "location"],
    },
  },
];

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Get all tool schemas with endpoint metadata.
 * Used by clients (like Retina) to build dynamic executors.
 * @returns {Array} Full tool definitions including endpoint info
 */
export function getToolSchemas() {
  return TOOL_DEFINITIONS;
}

/**
 * Get tool schemas cleaned for LLM consumption.
 * Strips the `endpoint` property since the AI doesn't need routing info.
 * @returns {Array} Tool definitions without endpoint metadata
 */
export function getToolSchemasForAI() {
  return TOOL_DEFINITIONS.map(({ endpoint: _endpoint, ...rest }) => rest);
}

/**
 * Get the available fields map.
 * @returns {object} FIELDS enum map
 */
export function getFields() {
  return FIELDS;
}
