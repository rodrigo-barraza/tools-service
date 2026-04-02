// ============================================================
// Tool Schema Service — Single Source of Truth
// ============================================================
// Defines all AI-callable tool schemas for the Sun ecosystem.
// Each tool includes:
//   - name, description, parameters (JSON Schema for LLM)
//   - endpoint metadata (path, pathParams, queryParams)
//     so clients can build executors dynamically.
//   - dataSource metadata (type, provider, intervalSeconds)
//     describing where data comes from and how it's refreshed.
//
// Consumed by:
//   - tools-api: GET /admin/tool-schemas
//   - retina: fetches schemas and builds a generic executor
//
// CRITICAL CONVENTION:
//   Property keys in parameters.properties MUST exactly match
//   the names in endpoint.queryParams / endpoint.pathParams.
//   Retina sends the AI's parameter names directly as URL
//   query params — e.g. if the property is "q", the URL gets
//   ?q=value. A mismatch (e.g. "query" vs "q") causes 400s.
// ============================================================

// ────────────────────────────────────────────────────────────
// Interval Constants — imported as single source of truth
// for both the collectors and the dataSource metadata.
// ────────────────────────────────────────────────────────────

import {
  // Weather domain
  OPEN_METEO_INTERVAL_MS,
  AIR_QUALITY_INTERVAL_MS,
  EARTHQUAKE_INTERVAL_MS,
  DONKI_INTERVAL_MS,
  KP_INDEX_INTERVAL_MS,
  TWILIGHT_INTERVAL_MS,
  TIDE_INTERVAL_MS,
  WILDFIRE_INTERVAL_MS,
  ISS_POSITION_INTERVAL_MS,
  NEO_INTERVAL_MS,
  SOLAR_WIND_INTERVAL_MS,
  GOOGLE_POLLEN_INTERVAL_MS,
  APOD_INTERVAL_MS,
  LAUNCH_INTERVAL_MS,
  ENV_CANADA_INTERVAL_MS,
  AVALANCHE_INTERVAL_MS,
  GOOGLE_AIR_QUALITY_INTERVAL_MS,
  // Event domain
  TICKETMASTER_INTERVAL_MS,
  // Market domain
  COMMODITIES_INTERVAL_MS,
  // Product domain
  BESTBUY_INTERVAL_MS,
  BESTBUY_CA_AVAILABILITY_INTERVAL_MS,
  COSTCO_INTERVAL_MS,
  // Trend domain
  GOOGLE_TRENDS_INTERVAL_MS,
  // Finance domain
  FINNHUB_NEWS_INTERVAL_MS,
  FINNHUB_EARNINGS_INTERVAL_MS,
} from "../constants.js";

// ────────────────────────────────────────────────────────────
// Data Source Helpers — builds the dataSource metadata
// ────────────────────────────────────────────────────────────
// type: "cached"    — background-polled on a cron interval,
//                     served from in-memory cache / database.
// type: "onDemand"  — fetched from a provider at request time.
//
// provider: the external API or "internal" for own data.
// intervalSeconds: polling interval (cached only), derived
//                  from the same constant the collector uses.
// ────────────────────────────────────────────────────────────

function cached(provider, intervalMs) {
  return {
    type: "cached",
    provider,
    intervalSeconds: Math.round(intervalMs / 1000),
  };
}

function onDemand(provider) {
  return { type: "onDemand", provider };
}

function staticDataset(name) {
  return { type: "static", provider: "internal", dataset: name };
}

function compute(name) {
  return { type: "compute", provider: "internal", runtime: name };
}

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

  // ── Macroeconomics (FRED) ────────────────────────────────────

  // Macro Indicators: from FredFetcher
  MACRO_INDICATORS: ["id", "name", "category", "value", "date", "unit"],

  // Macro Series Info: from FredFetcher
  MACRO_SERIES_INFO: [
    "id",
    "title",
    "frequency",
    "units",
    "seasonalAdjustment",
    "lastUpdated",
    "observationStart",
    "observationEnd",
    "notes",
  ],

  // Macro Series Search: from FredFetcher
  MACRO_SERIES_SEARCH: [
    "id",
    "title",
    "frequency",
    "units",
    "seasonalAdjustment",
    "lastUpdated",
    "popularity",
    "notes",
  ],

  // Macro Observations: from FredFetcher
  MACRO_OBSERVATIONS: ["date", "value"],

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
  ON_THIS_DAY: ["date", "type", "count", "events"],

  // Anime: from JikanFetcher
  ANIME: [
    "malId",
    "title",
    "titleEnglish",
    "titleJapanese",
    "imageUrl",
    "trailerUrl",
    "synopsis",
    "type",
    "source",
    "episodes",
    "status",
    "airing",
    "airedString",
    "duration",
    "rating",
    "score",
    "scoredBy",
    "rank",
    "popularity",
    "season",
    "year",
    "studios",
    "genres",
    "themes",
  ],

  // Movies: from TMDbFetcher
  MOVIES: [
    "tmdbId",
    "title",
    "originalTitle",
    "tagline",
    "overview",
    "releaseDate",
    "status",
    "runtime",
    "voteAverage",
    "voteCount",
    "popularity",
    "posterUrl",
    "backdropUrl",
    "genres",
    "originalLanguage",
    "url",
  ],

  // Movie Details: from TMDbFetcher.getMovieDetails()
  MOVIE_DETAILS: [
    "tmdbId",
    "title",
    "originalTitle",
    "tagline",
    "overview",
    "releaseDate",
    "status",
    "runtime",
    "budget",
    "revenue",
    "voteAverage",
    "voteCount",
    "popularity",
    "posterUrl",
    "backdropUrl",
    "genres",
    "originalLanguage",
    "spokenLanguages",
    "productionCompanies",
    "productionCountries",
    "homepage",
    "imdbId",
    "url",
  ],

  // Movie Credits: from TMDbFetcher.getMovieCredits()
  MOVIE_CREDITS: [
    "cast.name",
    "cast.character",
    "cast.profileUrl",
    "cast.order",
    "crew.name",
    "crew.job",
    "crew.department",
  ],

  // TV Shows: from TMDbFetcher
  TV_SHOWS: [
    "tmdbId",
    "name",
    "originalName",
    "tagline",
    "overview",
    "firstAirDate",
    "lastAirDate",
    "status",
    "type",
    "numberOfSeasons",
    "numberOfEpisodes",
    "voteAverage",
    "voteCount",
    "popularity",
    "posterUrl",
    "backdropUrl",
    "genres",
    "networks",
    "url",
  ],

  // TV Show Details: from TMDbFetcher.getTvShowDetails()
  TV_SHOW_DETAILS: [
    "tmdbId",
    "name",
    "originalName",
    "tagline",
    "overview",
    "firstAirDate",
    "lastAirDate",
    "status",
    "type",
    "numberOfSeasons",
    "numberOfEpisodes",
    "episodeRuntime",
    "voteAverage",
    "voteCount",
    "popularity",
    "posterUrl",
    "backdropUrl",
    "genres",
    "networks",
    "productionCompanies",
    "createdBy",
    "originCountry",
    "originalLanguage",
    "homepage",
    "inProduction",
    "url",
  ],

  // TV Credits: from TMDbFetcher.getTvShowCredits()
  TV_CREDITS: [
    "cast.name",
    "cast.character",
    "cast.profileUrl",
    "cast.order",
    "crew.name",
    "crew.job",
    "crew.department",
  ],

  // TV Season: from TMDbFetcher.getTvSeasonDetails()
  TV_SEASON: [
    "seasonNumber",
    "name",
    "overview",
    "airDate",
    "posterUrl",
    "episodeCount",
    "episodes.episodeNumber",
    "episodes.name",
    "episodes.overview",
    "episodes.airDate",
    "episodes.runtime",
    "episodes.voteAverage",
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

  // USDA Nutrition: from NutritionFetcher (raw whole foods)
  USDA_NUTRITION: [
    "name",
    "description",
    "kingdom",
    "foodType",
    "foodSubtype",
    "part",
    "form",
    "state",
    "taxonomy.taxon",
    "taxonomy.kingdom",
    "taxonomy.phylum",
    "taxonomy.class",
    "taxonomy.order",
    "taxonomy.suborder",
    "taxonomy.family",
    "taxonomy.subfamily",
    "taxonomy.tribe",
    "taxonomy.genus",
    "taxonomy.species",
    "taxonomy.subspecies",
    "taxonomy.variety",
    "taxonomy.form",
    "taxonomy.group",
    "taxonomy.cultivar",
    "taxonomy.phenotype",
    "taxonomy.binomial",
    "taxonomy.nomial",
    "taxonomy.trinomial",
    "perHundredGrams.macros",
    "perHundredGrams.minerals",
    "perHundredGrams.vitamins",
    "perHundredGrams.aminoAcids",
    "perHundredGrams.lipidProfile",
    "perHundredGrams.carbDetails",
    "perHundredGrams.sterols",
  ],

  // USDA Taxonomy Search: from NutritionFetcher.searchByTaxonomy()
  USDA_TAXONOMY: [
    "rank",
    "value",
    "count",
    "foods.name",
    "foods.description",
    "foods.kingdom",
    "foods.taxonomy",
    "foods.perHundredGrams",
  ],

  // USDA Nutrient Ranking: from NutritionFetcher.rankByNutrient()
  USDA_NUTRIENT_RANKING: [
    "nutrient",
    "nutrientName",
    "type",
    "count",
    "foods.name",
    "foods.description",
    "foods.kingdom",
    "foods.foodType",
    "foods.value",
  ],

  // ── Transit Domain ────────────────────────────────────────────

  // Next Bus: from TransLinkFetcher
  NEXT_BUS: ["stopNo", "count", "routes"],

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
  NEARBY_STOPS: ["count", "stops"],

  // Route Info: from TransLinkFetcher
  ROUTE_INFO: ["routeNo", "name", "operatingCompany", "patterns"],

  // ── Utility Domain ────────────────────────────────────────────

  // Currency Conversion: from CurrencyFetcher
  CURRENCY_CONVERT: ["from", "to", "amount", "rate", "converted", "lastUpdate"],

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

  // IP Geolocation: from IpInfoFetcher
  IP_GEOLOCATION: [
    "ip",
    "hostname",
    "city",
    "region",
    "country",
    "latitude",
    "longitude",
    "org",
    "postal",
    "timezone",
  ],

  // Places: from PlacesFetcher
  PLACES: [
    "id",
    "name",
    "type",
    "types",
    "address",
    "shortAddress",
    "latitude",
    "longitude",
    "rating",
    "reviewCount",
    "priceLevel",
    "phone",
    "website",
    "googleMapsUrl",
    "description",
    "openNow",
  ],

  // Periodic Table: from PeriodicTableFetcher
  ELEMENTS: [
    "atomicNumber",
    "symbol",
    "name",
    "atomicMass",
    "category",
    "groupNumber",
    "period",
    "block",
    "electronConfiguration",
    "electronegativity",
    "density",
    "molarHeat",
    "electronAffinity",
    "firstIonizationEnergy",
    "phaseAtSTP",
    "meltingPoint",
    "boilingPoint",
    "appearance",
    "discoveredBy",
    "cpkHexColor",
    "summary",
  ],

  // Element Ranking: from PeriodicTableFetcher.rankElementsByProperty()
  ELEMENT_RANKING: [
    "property",
    "propertyLabel",
    "order",
    "count",
    "elements.atomicNumber",
    "elements.symbol",
    "elements.name",
    "elements.value",
    "elements.category",
  ],

  // World Bank: from WorldBankFetcher
  WORLD_BANK_COUNTRY: [
    "countryCode",
    "countryName",
    "dataYear",
    "indicators.gdp_usd",
    "indicators.gdp_per_capita_usd",
    "indicators.population",
    "indicators.life_expectancy",
    "indicators.infant_mortality_per_1k",
    "indicators.co2_per_capita_tons",
    "indicators.literacy_rate_pct",
    "indicators.internet_users_pct",
    "indicators.unemployment_pct",
    "indicators.inflation_cpi_pct",
    "indicators.forest_area_pct",
    "indicators.renewable_energy_pct",
    "indicators.gini_index",
    "indicators.electricity_access_pct",
    "indicators.health_expenditure_per_capita_usd",
  ],

  // World Bank Ranking: from WorldBankFetcher.rankCountriesByIndicator()
  WORLD_BANK_RANKING: [
    "indicator",
    "indicatorLabel",
    "unit",
    "order",
    "count",
    "countries.countryCode",
    "countries.countryName",
    "countries.value",
    "countries.dataYear",
  ],

  // ── Airport Domain ─────────────────────────────────────────────

  // Airport Search/Lookup: from AirportFetcher
  AIRPORTS: [
    "iataCode",
    "icaoCode",
    "name",
    "city",
    "countryCode",
    "continent",
    "latitude",
    "longitude",
    "elevationFt",
    "type",
    "scheduledService",
  ],

  // Nearest Airport: from AirportFetcher.getNearestAirports()
  AIRPORTS_NEAREST: [
    "iataCode",
    "icaoCode",
    "name",
    "city",
    "countryCode",
    "distanceKm",
  ],

  // ── Webcams ────────────────────────────────────────────────────────

  WEBCAMS: [
    "id",
    "name",
    "url",
    "area",
    "latitude",
    "longitude",
    "city",
    "country",
    "source",
  ],

  // ── Exoplanet Domain ───────────────────────────────────────────

  // Exoplanet Search/Lookup: from ExoplanetFetcher
  EXOPLANETS: [
    "name",
    "hostStar",
    "discoveryMethod",
    "discoveryYear",
    "discoveryFacility",
    "orbitalPeriodDays",
    "radiusEarth",
    "massEarth",
    "semiMajorAxisAU",
    "eccentricity",
    "equilibriumTempK",
    "stellarMassSolar",
    "stellarRadiusSolar",
    "stellarTempK",
    "distanceParsecs",
  ],

  // Exoplanet Ranking: from ExoplanetFetcher.rankExoplanets()
  EXOPLANET_RANKING: [
    "field",
    "label",
    "unit",
    "order",
    "count",
    "planets.name",
    "planets.hostStar",
    "planets.value",
    "planets.discoveryYear",
    "planets.method",
  ],

  // Exoplanet Discovery Stats: from ExoplanetFetcher.getDiscoveryStats()
  EXOPLANET_STATS: [
    "totalPlanets",
    "yearRange.first",
    "yearRange.latest",
    "discoveryMethods",
    "topFacilities",
  ],

  // ── FDA Drug Domain ────────────────────────────────────────────

  // FDA Drug Search: from FdaDrugFetcher
  FDA_DRUGS: [
    "productNdc",
    "genericName",
    "brandName",
    "labelerName",
    "dosageForm",
    "route",
    "productType",
    "marketingCategory",
    "activeIngredients",
    "pharmClass",
  ],

  // FDA Dosage Forms: from FdaDrugFetcher.getDosageForms()
  FDA_DOSAGE_FORMS: [
    "totalProducts",
    "dosageForms.form",
    "dosageForms.count",
  ],

  // ── Gym Exercises ──────────────────────────────────────────────

  // Exercises: from ExercisesFetcher
  EXERCISES: [
    "id",
    "name",
    "force",
    "level",
    "mechanic",
    "equipment",
    "category",
    "primary_muscles",
    "secondary_muscles",
    "instructions",
  ],

  // ── Maritime Domain (AIS Stream) ──────────────────────────────

  // Tracked Vessels: from AisStreamFetcher.getTrackedVessels()
  VESSELS: [
    "mmsi",
    "shipName",
    "latitude",
    "longitude",
    "cog",
    "sog",
    "trueHeading",
    "navigationalStatus",
    "rateOfTurn",
    "imoNumber",
    "callSign",
    "shipType",
    "destination",
    "draught",
    "eta",
    "dimensions",
    "messageType",
    "timestamp",
    "receivedAt",
  ],

  // AIS Messages: raw ring buffer entries
  AIS_MESSAGES: [
    "messageType",
    "mmsi",
    "shipName",
    "latitude",
    "longitude",
    "timestamp",
    "receivedAt",
    "cog",
    "sog",
    "trueHeading",
    "safetyText",
  ],

  // ── Energy Domain (EIA) ───────────────────────────────────────

  // Energy Indicators: from EiaFetcher.getEnergyIndicators()
  ENERGY_INDICATORS: [
    "id",
    "name",
    "category",
    "value",
    "period",
    "unit",
    "description",
  ],

  // EIA Browse: from EiaFetcher.browseRoute()
  EIA_BROWSE: [
    "id",
    "name",
    "description",
    "routes",
    "frequency",
    "facets",
    "data",
    "startPeriod",
    "endPeriod",
  ],

  // EIA Facets: from EiaFetcher.getFacetValues()
  EIA_FACETS: [
    "route",
    "facetId",
    "totalFacets",
    "facets",
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
    dataSource: cached("Open-Meteo", OPEN_METEO_INTERVAL_MS),
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
    dataSource: cached("Open-Meteo", OPEN_METEO_INTERVAL_MS),
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
    dataSource: cached("Open-Meteo", AIR_QUALITY_INTERVAL_MS),
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
    dataSource: cached("USGS", EARTHQUAKE_INTERVAL_MS),
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
    dataSource: cached("NASA DONKI", DONKI_INTERVAL_MS),
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
    dataSource: cached("NOAA SWPC", KP_INDEX_INTERVAL_MS),
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
    dataSource: cached("Sunrise-Sunset API", TWILIGHT_INTERVAL_MS),
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
    dataSource: cached("NOAA CO-OPS", TIDE_INTERVAL_MS),
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
    dataSource: cached("NASA EONET", WILDFIRE_INTERVAL_MS),
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
    dataSource: cached("Open Notify", ISS_POSITION_INTERVAL_MS),
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
    dataSource: cached("NASA NeoWs", NEO_INTERVAL_MS),
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
    dataSource: cached("NOAA SWPC", SOLAR_WIND_INTERVAL_MS),
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
    dataSource: cached("Google Pollen API", GOOGLE_POLLEN_INTERVAL_MS),
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
    dataSource: cached("NASA APOD", APOD_INTERVAL_MS),
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
    dataSource: cached("Launch Library 2", LAUNCH_INTERVAL_MS),
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
    dataSource: cached("Environment Canada", ENV_CANADA_INTERVAL_MS),
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
    dataSource: cached("Avalanche Canada", AVALANCHE_INTERVAL_MS),
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
    dataSource: cached("Google Air Quality API", GOOGLE_AIR_QUALITY_INTERVAL_MS),
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
    dataSource: cached("Ticketmaster / SeatGeek / TMDB / Google Places", TICKETMASTER_INTERVAL_MS),
    description:
      "Search for local events including concerts, sports games, festivals, community gatherings, and movie releases. Can filter by source, category, and text search.",
    endpoint: {
      path: "/event/search",
      queryParams: ["q", "source", "category", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
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
    dataSource: cached("Ticketmaster / SeatGeek / TMDB / Google Places", TICKETMASTER_INTERVAL_MS),
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
    dataSource: cached("Ticketmaster / SeatGeek / TMDB / Google Places", TICKETMASTER_INTERVAL_MS),
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
    dataSource: cached("internal", TICKETMASTER_INTERVAL_MS),
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
    dataSource: cached("Yahoo Finance", COMMODITIES_INTERVAL_MS),
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
    dataSource: cached("Yahoo Finance", COMMODITIES_INTERVAL_MS),
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
    dataSource: cached("Yahoo Finance", COMMODITIES_INTERVAL_MS),
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
    dataSource: cached("Yahoo Finance", COMMODITIES_INTERVAL_MS),
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
    dataSource: cached("Yahoo Finance / MongoDB", COMMODITIES_INTERVAL_MS),
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
    dataSource: cached("Google Trends / Reddit / Wikipedia / HackerNews / X / Mastodon / Bluesky / GitHub / ProductHunt / TVMaze / Google News", GOOGLE_TRENDS_INTERVAL_MS),
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
    dataSource: cached("internal", GOOGLE_TRENDS_INTERVAL_MS),
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
    dataSource: cached("internal / MongoDB", GOOGLE_TRENDS_INTERVAL_MS),
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
    dataSource: cached("Best Buy / Amazon / eBay / Etsy / ProductHunt / Costco", BESTBUY_INTERVAL_MS),
    description:
      "Search for products with pricing, ratings, and deal information from Best Buy, Amazon, eBay, Etsy, Product Hunt, Costco US, and Costco Canada.",
    endpoint: {
      path: "/product/products/search",
      queryParams: ["q", "category", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
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
    dataSource: cached("Best Buy / Amazon / eBay / Etsy / ProductHunt / Costco", BESTBUY_INTERVAL_MS),
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
    dataSource: cached("Best Buy Canada", BESTBUY_CA_AVAILABILITY_INTERVAL_MS),
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
    dataSource: onDemand("Best Buy Canada"),
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
    dataSource: cached("Costco US", COSTCO_INTERVAL_MS),
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
    dataSource: cached("Costco Canada", COSTCO_INTERVAL_MS),
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
    dataSource: onDemand("Finnhub"),
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
    dataSource: onDemand("Finnhub"),
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
    dataSource: cached("Finnhub", FINNHUB_NEWS_INTERVAL_MS),
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
    dataSource: cached("Finnhub", FINNHUB_EARNINGS_INTERVAL_MS),
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
    dataSource: onDemand("Finnhub"),
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
    dataSource: onDemand("Finnhub"),
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

  // ── Finance (FRED Macroeconomics) ──────────────────────────────
  {
    name: "get_macro_indicators",
    dataSource: onDemand("FRED (St. Louis Fed)"),
    description:
      "Get the latest snapshot of key macroeconomic indicators including inflation (CPI, PCE), interest rates (Fed Funds, 10Y Yield), unemployment, GDP, and consumer sentiment from the St. Louis Fed (FRED).",
    endpoint: {
      path: "/finance/macro/indicators",
    },
    parameters: {
      type: "object",
      properties: {
        ...fieldsParam(FIELDS.MACRO_INDICATORS),
      },
    },
  },
  {
    name: "search_macro_series",
    dataSource: onDemand("FRED (St. Louis Fed)"),
    description:
      "Search for macroeconomic data series by keywords (e.g. 'housing prices', 'credit card debt', 'wheat prices') from FRED. Returns series IDs required for fetching specific observations.",
    endpoint: {
      path: "/finance/macro/search",
      queryParams: ["q", "limit", "orderBy"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Search keywords (e.g. 'inflation')",
        },
        limit: {
          type: "number",
          description: "Max number of results to return (default: 10)",
        },
        orderBy: {
          type: "string",
          description:
            "Sort order: search_rank, series_id, title, frequency, popularity, observation_start, observation_end. Default is search_rank.",
        },
        ...fieldsParam(FIELDS.MACRO_SERIES_SEARCH),
      },
      required: ["q"],
    },
  },
  {
    name: "get_macro_series_info",
    dataSource: onDemand("FRED (St. Louis Fed)"),
    description:
      "Get detailed metadata about a specific FRED macroeconomic data series by its ID, including unit description, frequency, and notes.",
    endpoint: {
      path: "/finance/macro/series/:seriesId",
      pathParams: ["seriesId"],
    },
    parameters: {
      type: "object",
      properties: {
        seriesId: {
          type: "string",
          description: "The FRED series ID (e.g., 'UNRATE', 'CPIAUCSL')",
        },
        ...fieldsParam(FIELDS.MACRO_SERIES_INFO),
      },
      required: ["seriesId"],
    },
  },
  {
    name: "get_macro_observations",
    dataSource: onDemand("FRED (St. Louis Fed)"),
    description:
      "Get historical observations (data points) for a specific FRED macroeconomic data series by its ID.",
    endpoint: {
      path: "/finance/macro/series/:seriesId/observations",
      pathParams: ["seriesId"],
      queryParams: ["limit", "sortOrder", "observationStart", "observationEnd"],
    },
    parameters: {
      type: "object",
      properties: {
        seriesId: {
          type: "string",
          description: "The FRED series ID (e.g., 'UNRATE', 'CPIAUCSL')",
        },
        limit: {
          type: "number",
          description: "Maximum number of observations to return (default 50)",
        },
        sortOrder: {
          type: "string",
          description: "Sort direction: 'asc' or 'desc' (default: 'desc')",
          enum: ["asc", "desc"],
        },
        observationStart: {
          type: "string",
          description: "Start date for filtering in YYYY-MM-DD format",
        },
        observationEnd: {
          type: "string",
          description: "End date for filtering in YYYY-MM-DD format",
        },
        ...fieldsParam(FIELDS.MACRO_OBSERVATIONS),
      },
      required: ["seriesId"],
    },
  },

  // ── Knowledge ──────────────────────────────────────────────────
  {
    name: "define_word",
    dataSource: onDemand("Free Dictionary API"),
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
    dataSource: onDemand("Open Library"),
    description:
      "Search for books by title, author, or query. Returns book metadata, cover images, ratings, author names, publication year, and edition count from Open Library (3M+ books).",
    endpoint: {
      path: "/knowledge/books/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Search query (title, author, or keywords)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        ...fieldsParam(FIELDS.BOOKS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_book_details",
    dataSource: onDemand("Open Library"),
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
    dataSource: onDemand("Open Library"),
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
    dataSource: onDemand("REST Countries"),
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
          description:
            "Country name (partial match supported, e.g. 'Canada', 'Japan')",
        },
        ...fieldsParam(FIELDS.COUNTRIES),
      },
      required: ["name"],
    },
  },
  {
    name: "get_country_by_code",
    dataSource: onDemand("REST Countries"),
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
          description:
            "ISO 3166-1 alpha-2 or alpha-3 code (e.g. 'CA', 'CAN', 'US', 'JP')",
        },
        ...fieldsParam(FIELDS.COUNTRIES),
      },
      required: ["code"],
    },
  },
  {
    name: "search_papers",
    dataSource: onDemand("arXiv"),
    description:
      "Search academic papers on arXiv. Returns titles, abstracts, authors, publication dates, PDF links, and category classifications. Covers CS, physics, math, biology, economics, and more.",
    endpoint: {
      path: "/knowledge/papers/search",
      queryParams: ["q", "category", "limit", "sortBy"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
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
      required: ["q"],
    },
  },
  {
    name: "get_wikipedia_summary",
    dataSource: onDemand("Wikipedia REST API"),
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
          description:
            "Wikipedia article title (e.g. 'Albert Einstein', 'Machine learning')",
        },
        ...fieldsParam(FIELDS.WIKIPEDIA_SUMMARY),
      },
      required: ["title"],
    },
  },
  {
    name: "get_on_this_day",
    dataSource: onDemand("Wikipedia REST API"),
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
          description:
            "Type of events: selected, births, deaths, events, holidays",
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
  {
    name: "search_anime",
    dataSource: onDemand("Jikan (MyAnimeList)"),
    description: "Search for anime titles on MyAnimeList (via Jikan API).",
    endpoint: {
      path: "/knowledge/anime/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Anime title or keyword to search for",
        },
        limit: {
          type: "number",
          description: "Max number of results to return (default: 10)",
        },
        ...fieldsParam(FIELDS.ANIME),
      },
      required: ["q"],
    },
  },
  {
    name: "get_top_anime",
    dataSource: onDemand("Jikan (MyAnimeList)"),
    description: "Get the top-ranked anime from MyAnimeList (via Jikan API).",
    endpoint: {
      path: "/knowledge/anime/top",
      queryParams: ["limit"],
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of results to return (default: 10)",
        },
        ...fieldsParam(FIELDS.ANIME),
      },
    },
  },
  {
    name: "get_current_season_anime",
    dataSource: onDemand("Jikan (MyAnimeList)"),
    description:
      "Get currently airing seasonal anime from MyAnimeList (via Jikan API).",
    endpoint: {
      path: "/knowledge/anime/season/now",
      queryParams: ["limit"],
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of results to return (default: 10)",
        },
        ...fieldsParam(FIELDS.ANIME),
      },
    },
  },
  {
    name: "get_anime_details",
    dataSource: onDemand("Jikan (MyAnimeList)"),
    description:
      "Get comprehensive details for a specific anime by its MyAnimeList ID.",
    endpoint: {
      path: "/knowledge/anime/:id",
      pathParams: ["id"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The MyAnimeList ID of the anime",
        },
        ...fieldsParam(FIELDS.ANIME),
      },
      required: ["id"],
    },
  },

  // ── Movies (TMDb) ──────────────────────────────────────────────
  {
    name: "search_movies",
    dataSource: onDemand("TMDb"),
    description:
      "Search for movies by title. Returns matching movies with posters, ratings, release dates, and overviews from TMDb.",
    endpoint: {
      path: "/knowledge/movies/search",
      queryParams: ["q", "page", "year"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Movie title or keyword to search for",
        },
        year: {
          type: "number",
          description: "Filter by release year",
        },
        page: {
          type: "number",
          description: "Page number for paginated results (default: 1)",
        },
        ...fieldsParam(FIELDS.MOVIES),
      },
      required: ["q"],
    },
  },
  {
    name: "get_movie_details",
    dataSource: onDemand("TMDb"),
    description:
      "Get comprehensive details for a specific movie by its TMDb ID, including budget, revenue, runtime, production companies, and IMDB link.",
    endpoint: {
      path: "/knowledge/movies/:id",
      pathParams: ["id"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The TMDb ID of the movie",
        },
        ...fieldsParam(FIELDS.MOVIE_DETAILS),
      },
      required: ["id"],
    },
  },
  {
    name: "get_movie_credits",
    dataSource: onDemand("TMDb"),
    description:
      "Get the cast and key crew (director, writer, producer, cinematographer, composer) for a movie by its TMDb ID.",
    endpoint: {
      path: "/knowledge/movies/:id/credits",
      pathParams: ["id"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The TMDb ID of the movie",
        },
        ...fieldsParam(FIELDS.MOVIE_CREDITS),
      },
      required: ["id"],
    },
  },
  {
    name: "get_trending_movies",
    dataSource: onDemand("TMDb"),
    description:
      "Get currently trending movies. Reflects real-time popularity across TMDb users.",
    endpoint: {
      path: "/knowledge/movies/trending",
      queryParams: ["timeWindow", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        timeWindow: {
          type: "string",
          description: "Time window: 'day' or 'week' (default: 'day')",
          enum: ["day", "week"],
        },
        limit: {
          type: "number",
          description: "Max number of results (default: 10)",
        },
        ...fieldsParam(FIELDS.MOVIES),
      },
    },
  },
  {
    name: "discover_movies",
    dataSource: onDemand("TMDb"),
    description:
      "Discover movies using filters like genre, year, minimum rating, and sort order. Good for 'best sci-fi movies of 2024' type queries.",
    endpoint: {
      path: "/knowledge/movies/discover",
      queryParams: [
        "genreId",
        "year",
        "sortBy",
        "page",
        "minVoteAverage",
        "minVoteCount",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        genreId: {
          type: "number",
          description:
            "TMDb genre ID to filter by (use get_movie_genres to find IDs)",
        },
        year: {
          type: "number",
          description: "Filter by release year",
        },
        sortBy: {
          type: "string",
          description:
            "Sort order: popularity.desc, revenue.desc, vote_average.desc, primary_release_date.desc (default: popularity.desc)",
        },
        minVoteAverage: {
          type: "number",
          description: "Minimum vote average (e.g. 7.0)",
        },
        minVoteCount: {
          type: "number",
          description: "Minimum number of votes (e.g. 100)",
        },
        page: {
          type: "number",
          description: "Page number (default: 1)",
        },
        ...fieldsParam(FIELDS.MOVIES),
      },
    },
  },
  {
    name: "get_movie_genres",
    dataSource: onDemand("TMDb"),
    description:
      "Get the list of official TMDb movie genres with their IDs. Use this to find genre IDs for the discover_movies tool.",
    endpoint: {
      path: "/knowledge/movies/genres",
    },
    parameters: {
      type: "object",
      properties: {},
    },
  },

  // ── TV Series (TMDb) ───────────────────────────────────────────
  {
    name: "search_tv_shows",
    dataSource: onDemand("TMDb"),
    description:
      "Search for TV series by name. Returns matching shows with posters, ratings, air dates, and overviews from TMDb.",
    endpoint: {
      path: "/knowledge/tv/search",
      queryParams: ["q", "page", "firstAirDateYear"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "TV show name or keyword to search for",
        },
        firstAirDateYear: {
          type: "number",
          description: "Filter by first air date year",
        },
        page: {
          type: "number",
          description: "Page number (default: 1)",
        },
        ...fieldsParam(FIELDS.TV_SHOWS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_tv_show_details",
    dataSource: onDemand("TMDb"),
    description:
      "Get comprehensive details for a TV series by its TMDb ID, including seasons, episodes, networks, creators, and production info.",
    endpoint: {
      path: "/knowledge/tv/:id",
      pathParams: ["id"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The TMDb ID of the TV show",
        },
        ...fieldsParam(FIELDS.TV_SHOW_DETAILS),
      },
      required: ["id"],
    },
  },
  {
    name: "get_tv_show_credits",
    dataSource: onDemand("TMDb"),
    description:
      "Get the aggregate cast and key crew for a TV series across all seasons.",
    endpoint: {
      path: "/knowledge/tv/:id/credits",
      pathParams: ["id"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The TMDb ID of the TV show",
        },
        ...fieldsParam(FIELDS.TV_CREDITS),
      },
      required: ["id"],
    },
  },
  {
    name: "get_tv_season_details",
    dataSource: onDemand("TMDb"),
    description:
      "Get details for a specific TV season including all episodes with names, air dates, runtimes, and ratings.",
    endpoint: {
      path: "/knowledge/tv/:id/season/:seasonNumber",
      pathParams: ["id", "seasonNumber"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The TMDb ID of the TV show",
        },
        seasonNumber: {
          type: "number",
          description: "Season number (0 for specials)",
        },
        ...fieldsParam(FIELDS.TV_SEASON),
      },
      required: ["id", "seasonNumber"],
    },
  },
  {
    name: "get_trending_tv_shows",
    dataSource: onDemand("TMDb"),
    description:
      "Get currently trending TV series. Reflects real-time popularity across TMDb users.",
    endpoint: {
      path: "/knowledge/tv/trending",
      queryParams: ["timeWindow", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        timeWindow: {
          type: "string",
          description: "Time window: 'day' or 'week' (default: 'day')",
          enum: ["day", "week"],
        },
        limit: {
          type: "number",
          description: "Max number of results (default: 10)",
        },
        ...fieldsParam(FIELDS.TV_SHOWS),
      },
    },
  },
  {
    name: "discover_tv_shows",
    dataSource: onDemand("TMDb"),
    description:
      "Discover TV series using filters like genre, year, minimum rating, and sort order. Good for 'best drama series of 2025' type queries.",
    endpoint: {
      path: "/knowledge/tv/discover",
      queryParams: [
        "genreId",
        "firstAirDateYear",
        "sortBy",
        "page",
        "minVoteAverage",
        "minVoteCount",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        genreId: {
          type: "number",
          description: "TMDb genre ID (use get_tv_genres to find IDs)",
        },
        firstAirDateYear: {
          type: "number",
          description: "Filter by first air date year",
        },
        sortBy: {
          type: "string",
          description:
            "Sort order: popularity.desc, vote_average.desc, first_air_date.desc (default: popularity.desc)",
        },
        minVoteAverage: {
          type: "number",
          description: "Minimum vote average (e.g. 7.0)",
        },
        minVoteCount: {
          type: "number",
          description: "Minimum number of votes (e.g. 100)",
        },
        page: {
          type: "number",
          description: "Page number (default: 1)",
        },
        ...fieldsParam(FIELDS.TV_SHOWS),
      },
    },
  },
  {
    name: "get_tv_genres",
    dataSource: onDemand("TMDb"),
    description:
      "Get the list of official TMDb TV genres with their IDs. Use this to find genre IDs for the discover_tv_shows tool.",
    endpoint: {
      path: "/knowledge/tv/genres",
    },
    parameters: {
      type: "object",
      properties: {},
    },
  },

  // ── Health ─────────────────────────────────────────────────────
  {
    name: "search_drug_info",
    dataSource: onDemand("openFDA"),
    description:
      "Search FDA drug labels by brand or generic name. Returns indications, warnings, side effects, dosage, contraindications, and drug interactions.",
    endpoint: {
      path: "/health/drugs/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Drug name (brand or generic, e.g. 'Tylenol', 'Acetaminophen')",
        },
        limit: {
          type: "number",
          description: "Max results (default: 5)",
        },
        ...fieldsParam(FIELDS.DRUG_LABEL),
      },
      required: ["q"],
    },
  },
  {
    name: "get_drug_adverse_events",
    dataSource: onDemand("openFDA"),
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
    dataSource: onDemand("openFDA"),
    description:
      "Get FDA drug recall and enforcement actions. Returns recall classification, reason, affected products, and recalling firm.",
    endpoint: {
      path: "/health/drugs/recalls",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Optional search term for recalls (drug name or keyword)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        ...fieldsParam(FIELDS.DRUG_RECALLS),
      },
    },
  },

  // ── Gym Exercises (Free Exercise DB & Wger) ─────────────────
  {
    name: "search_gym_exercises",
    dataSource: staticDataset("Free Exercise DB & Wger"),
    description:
      "Search for gym exercises by keyword, category, equipment, target muscle, or difficulty level. Returns detailed instructions and muscle group targets.",
    endpoint: {
      path: "/health/exercises/search",
      queryParams: [
        "q",
        "limit",
        "category",
        "equipment",
        "force",
        "level",
        "mechanic",
        "muscle",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Optional search query (e.g. 'curl', 'bench')",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        category: {
          type: "string",
          description: "Filter by category (e.g. 'strength', 'stretching')",
        },
        equipment: {
          type: "string",
          description: "Filter by equipment (e.g. 'dumbbell', 'barbell', 'body only')",
        },
        force: {
          type: "string",
          description: "Filter by force (e.g. 'push', 'pull', 'static')",
        },
        level: {
          type: "string",
          description: "Filter by level (e.g. 'beginner', 'intermediate', 'expert')",
        },
        mechanic: {
          type: "string",
          description: "Filter by mechanic (e.g. 'compound', 'isolation')",
        },
        muscle: {
          type: "string",
          description: "Filter by target muscle (e.g. 'chest', 'biceps', 'abdominals')",
        },
        ...fieldsParam(FIELDS.EXERCISES),
      },
    },
  },
  {
    name: "get_gym_exercise_categories",
    dataSource: staticDataset("Free Exercise DB & Wger"),
    description:
      "Get all available gym exercise categories, equipment types, and muscle groups.",
    endpoint: {
      path: "/health/exercises/categories",
      queryParams: [],
    },
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_gym_exercise_by_id",
    dataSource: staticDataset("Free Exercise DB & Wger"),
    description:
      "Get details for a specific gym exercise by its exact ID.",
    endpoint: {
      path: "/health/exercises/{id}",
      pathParams: ["id"],
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Exact exercise ID (e.g. 'Biceps_Curl')",
        },
        ...fieldsParam(FIELDS.EXERCISES),
      },
      required: ["id"],
    },
  },

  // ── USDA Nutrition (Raw Whole Foods) ────────────────────────────
  {
    name: "search_usda_nutrition",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Search USDA's curated database of ~1,346 raw whole foods (fruits, vegetables, meats, fish, nuts, grains, fungi) for detailed nutritional information. Returns per-100g nutrient values including macros, minerals, vitamins, amino acids, lipid profiles, and more. Use nutrientTypes parameter to request specific nutrient categories. For ranking foods by a specific nutrient (e.g. 'highest iron'), use the top_foods_by_* tools instead.",
    endpoint: {
      path: "/health/nutrition/search",
      queryParams: ["q", "limit", "kingdom", "foodType", "nutrientTypes"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Food name to search (e.g. 'chicken', 'spinach', 'salmon', 'almond')",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        kingdom: {
          type: "string",
          description:
            "Filter by biological kingdom: animalia, plantae, or fungi",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: {
          type: "string",
          description: "Filter by food type: animal, plant, or fungus",
        },
        nutrientTypes: {
          type: "string",
          description:
            "Comma-separated nutrient categories to include: macros, minerals, vitamins, amino_acids, lipids, carbs, sterols. Omit for all.",
        },
        ...fieldsParam(FIELDS.USDA_NUTRITION),
      },
      required: ["q"],
    },
  },
  {
    name: "rank_foods_by_nutrient",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Rank raw whole foods by a specific nutrient content (highest first). Great for answering questions like 'what foods are highest in iron?' or 'best sources of vitamin C'. Supports ~1,346 USDA foods with ~150 nutrient columns.",
    endpoint: {
      path: "/health/nutrition/rank",
      queryParams: ["nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        nutrient: {
          type: "string",
          description:
            "Nutrient column name (e.g. 'protein', 'calcium', 'iron', 'vitamin_b6', 'ascorbic_acid', 'potassium', 'fiber', 'kilocalories', 'c22_d6_n3_dha')",
        },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
        kingdom: {
          type: "string",
          description: "Filter by kingdom: animalia, plantae, fungi",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: {
          type: "string",
          description: "Filter by food type: animal, plant, fungus",
        },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["nutrient"],
    },
  },
  {
    name: "compare_food_nutrition",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Compare nutritional profiles side-by-side between 2+ raw whole foods. Example: compare chicken vs salmon vs tofu. Returns matched foods with their per-100g nutrient values.",
    endpoint: {
      path: "/health/nutrition/compare",
      queryParams: ["foods", "nutrientTypes"],
    },
    parameters: {
      type: "object",
      properties: {
        foods: {
          type: "string",
          description:
            "Comma-separated food names to compare (e.g. 'chicken,salmon,tofu')",
        },
        nutrientTypes: {
          type: "string",
          description:
            "Comma-separated nutrient categories: macros, minerals, vitamins, amino_acids, lipids, carbs, sterols. Omit for all.",
        },
        ...fieldsParam(FIELDS.USDA_NUTRITION),
      },
      required: ["foods"],
    },
  },
  {
    name: "get_food_categories",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "List all available food categories, kingdoms, types, and parts in the USDA nutrition database. Useful for discovering what filters are available before searching.",
    endpoint: {
      path: "/health/nutrition/categories",
    },
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_nutrient_types",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "List all available nutrient type categories (macros, minerals, vitamins, amino_acids, lipids, carbs, sterols) and database stats. Use this to understand what nutrient data is available.",
    endpoint: {
      path: "/health/nutrition/nutrient-types",
    },
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_category_nutrients",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "List all available nutrients within a specific category (e.g. all minerals, all vitamins). Returns column names and human-readable labels. Use this to discover which nutrients you can query with the top_foods_by_* tools.",
    endpoint: {
      path: "/health/nutrition/nutrients/:category",
      pathParams: ["category"],
    },
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Nutrient category to list",
          enum: [
            "macros",
            "minerals",
            "vitamins",
            "amino_acids",
            "lipids",
            "carbs",
            "sterols",
          ],
        },
      },
      required: ["category"],
    },
  },
  {
    name: "top_foods_by_macro",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific macronutrient — protein, fat, carbs, calories, fiber, sugar, water, or alcohol. Example: 'what foods have the most protein?' → nutrient='protein'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["macros"], description: "Fixed category — always 'macros'" },
        nutrient: {
          type: "string",
          description: "Which macronutrient to rank by",
          enum: [
            "protein",
            "lipid",
            "carbohydrate",
            "kilocalories",
            "fiber",
            "sugar",
            "water",
            "ethanol",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "top_foods_by_mineral",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific mineral — calcium, iron, magnesium, potassium, zinc, selenium, etc. Example: 'what foods are high in iron?' → nutrient='iron'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["minerals"], description: "Fixed category — always 'minerals'" },
        nutrient: {
          type: "string",
          description: "Which mineral to rank by",
          enum: [
            "calcium",
            "iron",
            "magnesium",
            "phosphorus",
            "potassium",
            "sodium",
            "zinc",
            "copper",
            "manganese",
            "selenium",
            "fluoride",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "top_foods_by_vitamin",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific vitamin — vitamin A, B1-B12, C, D, E, K, folate, choline, carotenoids, etc. Example: 'best sources of vitamin C?' → nutrient='ascorbic_acid'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["vitamins"], description: "Fixed category — always 'vitamins'" },
        nutrient: {
          type: "string",
          description: "Which vitamin to rank by",
          enum: [
            "ascorbic_acid",
            "thiamin",
            "riboflavin",
            "niacin",
            "pantothenic_acid",
            "vitamin_b6",
            "folate_total",
            "cyanocobalamin",
            "choline",
            "vitamin_a_rae",
            "retinol",
            "beta_carotene",
            "alpha_tocopherol",
            "vitamin_d",
            "phylloquinone",
            "lycopene",
            "lutein_and_zeaxanthin",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "top_foods_by_amino_acid",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific amino acid — tryptophan, leucine, lysine, methionine, etc. Essential for protein quality analysis. Example: 'foods with most leucine?' → nutrient='leucine'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["amino_acids"], description: "Fixed category — always 'amino_acids'" },
        nutrient: {
          type: "string",
          description: "Which amino acid to rank by",
          enum: [
            "tryptophan",
            "threonine",
            "isoleucine",
            "leucine",
            "lysine",
            "methionine",
            "cystine",
            "phenylalanine",
            "tyrosine",
            "valine",
            "arginine",
            "histidine",
            "alanine",
            "aspartic_acid",
            "glutamic_acid",
            "glycine",
            "proline",
            "serine",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "top_foods_by_lipid",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific fat/lipid — saturated fat, omega-3 (DHA, EPA, ALA), omega-6, monounsaturated, polyunsaturated, or trans fats. Example: 'best omega-3 DHA sources?' → nutrient='c22_d6_n3_dha'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["lipids"], description: "Fixed category — always 'lipids'" },
        nutrient: {
          type: "string",
          description: "Which lipid/fat to rank by",
          enum: [
            "saturated_fat",
            "monounsaturated_fat",
            "polyunsaturated_fat",
            "trans_monoenoic_fat",
            "trans_polyenoic_fat",
            "c18_d3_n3_cis_cis_cis",
            "c20_d5_n3",
            "c22_d6_n3_dha",
            "c22_d5_n3",
            "c18_d2_n6_cis_cis",
            "c20_d4_undifferentiated",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "top_foods_by_carb",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific carbohydrate type — starch, glucose, fructose, sucrose, lactose, maltose, fiber, or total sugar. Example: 'foods highest in fiber?' → nutrient='fiber'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["carbs"], description: "Fixed category — always 'carbs'" },
        nutrient: {
          type: "string",
          description: "Which carbohydrate type to rank by",
          enum: [
            "starch",
            "sucrose",
            "glucose",
            "fructose",
            "lactose",
            "maltose",
            "galactose",
            "fiber",
            "sugar",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "top_foods_by_sterol",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific sterol — cholesterol, phytosterol, stigmasterol, campesterol, or beta-sitosterol. Example: 'foods highest in cholesterol?' → nutrient='cholesterol'.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["sterols"], description: "Fixed category — always 'sterols'" },
        nutrient: {
          type: "string",
          description: "Which sterol to rank by",
          enum: [
            "cholesterol",
            "phytosterol",
            "stigmasterol",
            "campesterol",
            "beta_sitosterol",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: {
          type: "string",
          enum: ["animalia", "plantae", "fungi"],
        },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "search_foods_by_taxonomy",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find all foods matching a specific biological taxonomic classification. Filter by any Linnaean rank — kingdom, phylum, class, order, family, subfamily, tribe, genus, species, subspecies, variety, cultivar, etc. Example: rank='family', value='Rosaceae' returns all rose-family foods (apples, pears, cherries, etc). Use browse_food_taxonomy first to discover available values.",
    endpoint: {
      path: "/health/nutrition/taxonomy/search",
      queryParams: ["rank", "value", "limit", "nutrientTypes"],
    },
    parameters: {
      type: "object",
      properties: {
        rank: {
          type: "string",
          description: "Taxonomic rank to filter on",
          enum: [
            "kingdom",
            "phylum",
            "class",
            "order",
            "suborder",
            "family",
            "subfamily",
            "tribe",
            "genus",
            "species",
            "subspecies",
            "variety",
            "form",
            "group",
            "cultivar",
            "phenotype",
          ],
        },
        value: {
          type: "string",
          description:
            "Value to match at the specified rank (case-insensitive). E.g. 'Rosaceae', 'Brassica', 'animalia', 'Chordata'",
        },
        limit: {
          type: "number",
          description: "Max results (default: 25)",
        },
        nutrientTypes: {
          type: "string",
          description:
            "Comma-separated nutrient categories to include: macros, minerals, vitamins, amino_acids, lipids, carbs, sterols. Omit for all.",
        },
        ...fieldsParam(FIELDS.USDA_TAXONOMY),
      },
      required: ["rank", "value"],
    },
  },
  {
    name: "browse_food_taxonomy",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Discover available biological taxonomy values in the USDA food database. Without parameters, returns the full taxonomy tree with all ranks and their unique values. Optionally filter to a single rank, or scope by a parent rank (e.g. rank='genus', parentRank='family', parentValue='Rosaceae' to see all genera within the Rosaceae family). Use this to explore before using search_foods_by_taxonomy.",
    endpoint: {
      path: "/health/nutrition/taxonomy/tree",
      queryParams: ["rank", "parentRank", "parentValue"],
    },
    parameters: {
      type: "object",
      properties: {
        rank: {
          type: "string",
          description:
            "Optional: return only values for this specific rank",
          enum: [
            "kingdom",
            "phylum",
            "class",
            "order",
            "suborder",
            "family",
            "subfamily",
            "tribe",
            "genus",
            "species",
            "subspecies",
            "variety",
            "form",
            "group",
            "cultivar",
            "phenotype",
          ],
        },
        parentRank: {
          type: "string",
          description:
            "Optional: filter by parent taxonomic rank (requires parentValue)",
          enum: [
            "kingdom",
            "phylum",
            "class",
            "order",
            "suborder",
            "family",
            "subfamily",
            "tribe",
            "genus",
            "species",
          ],
        },
        parentValue: {
          type: "string",
          description:
            "Value to match at the parent rank (e.g. parentRank='family', parentValue='Rosaceae')",
        },
      },
    },
  },

  // ── Transit (TransLink Vancouver) ──────────────────────────────
  {
    name: "get_next_bus",
    dataSource: onDemand("TransLink RTTI"),
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
    dataSource: onDemand("TransLink RTTI"),
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
    dataSource: onDemand("TransLink RTTI"),
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
    dataSource: onDemand("TransLink RTTI"),
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
    name: "execute_python",
    dataSource: compute("Python 3 subprocess"),
    description:
      "Execute Python code in a sandboxed interpreter. Use this for complex calculations, data transformations, statistical analysis, string manipulation, date/time operations, or any task that benefits from programmatic computation. The interpreter has access to Python's standard library (math, json, datetime, collections, itertools, statistics, decimal, fractions, re, textwrap, csv, io, etc.) but network access and dangerous modules (subprocess, shutil, ctypes) are blocked. Code runs with a 30-second default timeout (max 60s) and 256 MB memory limit. Print results to stdout — the output is captured and returned.",
    endpoint: {
      method: "POST",
      path: "/utility/python/execute",
      bodyParams: ["code", "timeout"],
    },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "Python 3 source code to execute. Use print() to produce output. The full standard library is available (math, json, datetime, statistics, collections, itertools, decimal, fractions, re, csv, io, etc.). Network and subprocess access is blocked.",
        },
        timeout: {
          type: "integer",
          description:
            "Execution timeout in milliseconds (min 1000, max 60000, default 30000). Increase for computationally intensive tasks.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "precise_calculator",
    dataSource: compute("bignumber.js"),
    description:
      "Perform highly precise mathematical calculations using bignumber.js. Supports arbitrary-precision arithmetic. Passed numbers should be strings to prevent precision loss. For sqrt, 'b' is ignored.",
    endpoint: {
      path: "/utility/calculate",
      queryParams: ["operation", "a", "b"],
    },
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide", "modulo", "power", "sqrt"],
          description: "The mathematical operation to perform",
        },
        a: {
          type: "string",
          description: "The first operand (must be a valid numeric string)",
        },
        b: {
          type: "string",
          description: "The second operand (must be a valid numeric string). Optional for sqrt.",
        },
      },
      required: ["operation", "a"],
    },
  },
  {
    name: "execute_javascript",
    dataSource: compute("Node.js vm"),
    description:
      "Execute JavaScript code in a sandboxed Node.js vm context. Much faster than Python for quick data transforms, JSON manipulation, regex, and math. Has access to JSON, Math, Date, RegExp, Array, Object, Map, Set, typed arrays, TextEncoder/TextDecoder, console.log, and all core JS builtins. No access to require, import, process, fetch, setTimeout, filesystem, or network. Use console.log() to produce output. Returns both captured output and the expression result.",
    endpoint: {
      method: "POST",
      path: "/compute/js/execute",
      bodyParams: ["code", "timeout"],
    },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript source code to execute. Use console.log() to produce output. The last expression value is returned as 'result'. Full standard JS built-ins available (JSON, Math, Date, RegExp, Array methods, Map, Set, etc.). No require/import/fetch/process/setTimeout.",
        },
        timeout: {
          type: "integer",
          description:
            "Execution timeout in milliseconds (min 100, max 30000, default 5000).",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "execute_shell",
    dataSource: compute("bash subprocess"),
    description:
      "Execute allowlisted shell commands for text processing. Supports pipes (|) between commands. Allowed binaries: awk, sed, grep, cut, tr, sort, uniq, wc, head, tail, jq, bc, expr, base64, md5sum, sha256sum, date, cal, echo, printf, cat, paste, column, fold, nl, rev, tac, seq, shuf, factor, and more. No filesystem mutation, no network access. Input data can be piped via stdin.",
    endpoint: {
      method: "POST",
      path: "/compute/shell/execute",
      bodyParams: ["command", "stdin", "timeout"],
    },
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Shell command to execute. Pipes (|) are allowed between allowlisted binaries. Example: 'echo \"hello world\" | tr a-z A-Z' or 'sort | uniq -c | sort -rn | head -10'. Shell metacharacters (;, &, `, $, etc.) are blocked for security.",
        },
        stdin: {
          type: "string",
          description:
            "Optional input data to pipe to the command's stdin. Useful for processing text data with awk/sed/grep/sort/jq pipelines. Max 1 MB.",
        },
        timeout: {
          type: "integer",
          description:
            "Execution timeout in milliseconds (min 500, max 30000, default 10000).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "convert_units",
    dataSource: compute("convert-units"),
    description:
      "Convert between physical measurement units. Supports length, mass, volume, temperature, time, speed, area, pressure, energy, power, frequency, data, acceleration, current, voltage, and more. LLMs frequently hallucinate unit conversions — use this tool for accuracy.",
    endpoint: {
      path: "/compute/units/convert",
      queryParams: ["value", "from", "to"],
    },
    parameters: {
      type: "object",
      properties: {
        value: {
          type: "number",
          description: "The numeric value to convert",
        },
        from: {
          type: "string",
          description:
            "Source unit abbreviation (e.g. 'mi', 'km', 'lb', 'kg', 'F', 'C', 'gal', 'l', 'psi', 'Pa', 'GB', 'MB')",
        },
        to: {
          type: "string",
          description:
            "Target unit abbreviation (e.g. 'km', 'mi', 'kg', 'lb', 'C', 'F', 'l', 'gal')",
        },
      },
      required: ["value", "from", "to"],
    },
  },
  {
    name: "parse_datetime",
    dataSource: compute("date-fns"),
    description:
      "Parse, format, compare, and perform arithmetic on dates and times. Operations: 'now' (current time), 'parse' (analyze a date), 'format' (custom formatting), 'diff' (difference between two dates in all units), 'add'/'subtract' (date arithmetic), 'startOf'/'endOf' (period boundaries), 'isValid' (validation). Supports timezone conversion. LLMs frequently get date math wrong — use this tool for accuracy.",
    endpoint: {
      method: "POST",
      path: "/compute/datetime/parse",
      bodyParams: ["operation", "date", "date2", "amount", "unit", "format", "timezone"],
    },
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["now", "parse", "format", "diff", "add", "subtract", "startOf", "endOf", "isValid"],
          description: "The date/time operation to perform",
        },
        date: {
          type: "string",
          description:
            "Date input — ISO 8601 string (e.g. '2024-03-15T10:30:00Z'), Unix timestamp (number), or 'now'. Required for most operations.",
        },
        date2: {
          type: "string",
          description:
            "Second date for 'diff' operation. Same format as 'date'.",
        },
        amount: {
          type: "integer",
          description: "Amount to add/subtract (for 'add' and 'subtract' operations)",
        },
        unit: {
          type: "string",
          enum: ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "year", "month", "week", "day", "hour", "minute"],
          description:
            "Time unit for add/subtract/startOf/endOf operations",
        },
        format: {
          type: "string",
          description:
            "Output format string using date-fns tokens (e.g. 'yyyy-MM-dd', 'EEEE, MMMM do yyyy', 'HH:mm:ss'). See date-fns format docs.",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone for output (e.g. 'America/Vancouver', 'Europe/London', 'Asia/Tokyo'). If omitted, uses UTC.",
        },
      },
      required: ["operation"],
    },
  },
  {
    name: "transform_json",
    dataSource: compute("jsonpath-plus"),
    description:
      "Transform, filter, reshape, and aggregate JSON data using JSONPath expressions and/or chained operations. Useful for extracting specific fields from complex API responses, reshaping data structures, filtering arrays, grouping, sorting, and aggregating. Operations: flatten, unique, sort, filter, pick, omit, groupBy, count, sum, limit, reverse.",
    endpoint: {
      method: "POST",
      path: "/compute/json/transform",
      bodyParams: ["data", "expression", "operations"],
    },
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "object",
          description: "The JSON data to transform (object or array)",
        },
        expression: {
          type: "string",
          description:
            "JSONPath expression to extract data (e.g. '$.store.book[*].author', '$..price', '$.items[?(@.active==true)]'). Optional — can use operations alone.",
        },
        operations: {
          type: "array",
          description:
            "Array of chained operations to apply. Each operation: { type: 'flatten'|'unique'|'sort'|'filter'|'pick'|'omit'|'groupBy'|'count'|'sum'|'limit'|'reverse', ...params }. Sort: { key, order:'asc'|'desc' }. Filter: { key, value, operator:'eq'|'gt'|'lt'|'contains' }. Pick/Omit: { keys:[] }. GroupBy: { key }. Sum: { key }. Limit: { count }.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["flatten", "unique", "sort", "filter", "pick", "omit", "groupBy", "count", "sum", "limit", "reverse"],
              },
            },
          },
        },
      },
      required: ["data"],
    },
  },
  {
    name: "generate_csv",
    dataSource: compute("internal"),
    description:
      "Convert an array of objects into a downloadable CSV file. Returns a download URL. Use this when the user needs data exported for spreadsheets, reports, or external tools. Supports custom column ordering and delimiter.",
    endpoint: {
      method: "POST",
      path: "/compute/csv",
      bodyParams: ["data", "columns", "filename", "delimiter"],
    },
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "array",
          description:
            "Array of objects to convert to CSV. Each object becomes one row.",
          items: { type: "object" },
        },
        columns: {
          type: "array",
          description:
            "Optional explicit column order. If omitted, uses keys from the first object.",
          items: { type: "string" },
        },
        filename: {
          type: "string",
          description: "Download filename (default: 'export.csv')",
        },
        delimiter: {
          type: "string",
          description: "Column delimiter (default: ','). Use '\\t' for TSV.",
        },
      },
      required: ["data"],
    },
  },
  {
    name: "generate_qr_code",
    dataSource: compute("qrcode"),
    description:
      "Generate a QR code PNG image from text, URLs, WiFi credentials, vCards, or any string data. Returns a qrImageUrl — render it with ![QR](qrImageUrl) markdown syntax so the user sees the QR code inline.",
    endpoint: {
      method: "POST",
      path: "/compute/qr",
      bodyParams: ["data", "size", "errorCorrection", "darkColor", "lightColor"],
    },
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description:
            "The data to encode. URL, text, WiFi config (WIFI:T:WPA;S:MyNetwork;P:MyPassword;;), vCard, etc. Max ~4296 chars.",
        },
        size: {
          type: "integer",
          description: "Image width/height in pixels (default: 400, max: 1024)",
        },
        errorCorrection: {
          type: "string",
          enum: ["L", "M", "Q", "H"],
          description: "Error correction level: L (7%), M (15%, default), Q (25%), H (30%)",
        },
        darkColor: {
          type: "string",
          description: "Foreground color as hex (default: '#000000')",
        },
        lightColor: {
          type: "string",
          description: "Background color as hex (default: '#ffffff')",
        },
      },
      required: ["data"],
    },
  },
  {
    name: "render_latex",
    dataSource: compute("KaTeX CDN"),
    description:
      "Render LaTeX mathematical expressions as a beautiful embedded page using KaTeX. Use this to display equations, formulas, and mathematical notation. Returns a latexEmbedUrl — render it with ![LaTeX](latexEmbedUrl) markdown syntax so the user sees the rendered math inline.",
    endpoint: {
      method: "POST",
      path: "/compute/latex",
      bodyParams: ["latex", "displayMode"],
    },
    parameters: {
      type: "object",
      properties: {
        latex: {
          type: "string",
          description:
            "LaTeX math expression to render. Examples: '\\\\int_0^1 x^2 dx = \\\\frac{1}{3}', 'E = mc^2', '\\\\sum_{i=1}^{n} i = \\\\frac{n(n+1)}{2}'",
        },
        displayMode: {
          type: "boolean",
          description:
            "If true (default), renders as a display-style equation (centered, larger). If false, renders inline-style.",
        },
      },
      required: ["latex"],
    },
  },
  {
    name: "generate_diagram",
    dataSource: compute("Mermaid CDN"),
    description:
      "Render Mermaid diagrams (flowcharts, sequence diagrams, class diagrams, ER diagrams, Gantt charts, state diagrams, pie charts, git graphs) as interactive embedded pages. Returns a diagramEmbedUrl — render it with ![Diagram](diagramEmbedUrl) markdown syntax so the user sees the diagram inline.",
    endpoint: {
      method: "POST",
      path: "/compute/diagram",
      bodyParams: ["definition", "theme"],
    },
    parameters: {
      type: "object",
      properties: {
        definition: {
          type: "string",
          description:
            "Mermaid diagram syntax. Examples: 'graph TD\\n  A[Start] --> B{Decision}\\n  B -->|Yes| C[OK]\\n  B -->|No| D[End]' or 'sequenceDiagram\\n  Alice->>Bob: Hello\\n  Bob-->>Alice: Hi back' or 'pie\\n  \"Dogs\" : 386\\n  \"Cats\" : 85'",
        },
        theme: {
          type: "string",
          enum: ["dark", "default", "forest", "neutral"],
          description: "Mermaid color theme (default: 'dark')",
        },
      },
      required: ["definition"],
    },
  },
  {
    name: "diff_text",
    dataSource: compute("diff"),
    description:
      "Compare two text inputs and produce a structured diff showing additions, deletions, and unchanged content. Also generates a unified patch. Supports character-level, word-level, line-level, sentence-level, and JSON diffs.",
    endpoint: {
      method: "POST",
      path: "/compute/diff",
      bodyParams: ["textA", "textB", "mode"],
    },
    parameters: {
      type: "object",
      properties: {
        textA: {
          type: "string",
          description: "The original text (or JSON string for json mode)",
        },
        textB: {
          type: "string",
          description: "The modified text (or JSON string for json mode)",
        },
        mode: {
          type: "string",
          enum: ["lines", "words", "chars", "sentences", "json"],
          description: "Diff granularity (default: 'lines')",
        },
      },
      required: ["textA", "textB"],
    },
  },
  {
    name: "generate_hash",
    dataSource: compute("node:crypto"),
    description:
      "Generate cryptographic hashes and HMACs. Supports MD5, SHA-1, SHA-256, SHA-512, and all Node.js crypto algorithms. Outputs in hex, base64, or other encodings. Use for checksums, data verification, and fingerprinting.",
    endpoint: {
      path: "/compute/hash",
      queryParams: ["data", "algorithm", "encoding", "key"],
    },
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "The data to hash",
        },
        algorithm: {
          type: "string",
          description: "Hash algorithm: md5, sha1, sha256, sha512, sha3-256, etc. (default: sha256)",
        },
        encoding: {
          type: "string",
          description: "Output encoding: hex (default), base64, base64url",
        },
        key: {
          type: "string",
          description: "Optional HMAC key. If provided, computes HMAC instead of plain hash.",
        },
      },
      required: ["data"],
    },
  },
  {
    name: "regex_tester",
    dataSource: compute("native RegExp"),
    description:
      "Test a regular expression pattern against input text. Returns all matches with indices, captured groups, and named groups. Validates regex syntax. Useful for pattern matching, data extraction, and regex debugging.",
    endpoint: {
      method: "POST",
      path: "/compute/regex",
      bodyParams: ["pattern", "flags", "text"],
    },
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern (without delimiters). Example: '\\\\d{3}-\\\\d{4}' or '(?<name>[A-Z]\\\\w+)'",
        },
        flags: {
          type: "string",
          description: "Regex flags: g (global), i (case-insensitive), m (multiline), s (dotAll), u (unicode). Default: 'g'",
        },
        text: {
          type: "string",
          description: "The input text to test the pattern against",
        },
      },
      required: ["pattern", "text"],
    },
  },
  {
    name: "encode_decode",
    dataSource: compute("internal"),
    description:
      "Encode or decode data between formats: Base64, Base64URL, hex, URL encoding, HTML entities, ROT13, binary, and JWT decode (no verification). Bidirectional — specify encode or decode direction.",
    endpoint: {
      path: "/compute/encode",
      queryParams: ["data", "format", "direction"],
    },
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "The data to encode or decode",
        },
        format: {
          type: "string",
          enum: ["base64", "base64url", "hex", "url", "html", "rot13", "binary", "jwt"],
          description: "The encoding format",
        },
        direction: {
          type: "string",
          enum: ["encode", "decode"],
          description: "Direction of transformation (default: 'encode'). JWT only supports 'decode'.",
        },
      },
      required: ["data", "format"],
    },
  },
  {
    name: "convert_color",
    dataSource: compute("internal"),
    description:
      "Convert colors between HEX, RGB, HSL, HSV, and CMYK formats. Also generates color palettes: complementary, analogous, triadic, split-complementary, tetradic, and monochromatic. Accepts any common color input format including CSS named colors.",
    endpoint: {
      path: "/compute/color/convert",
      queryParams: ["color", "palette"],
    },
    parameters: {
      type: "object",
      properties: {
        color: {
          type: "string",
          description:
            "Color value in any format: HEX ('#ff6347'), RGB ('rgb(255,99,71)'), HSL ('hsl(9,100%,64%)'), or CSS name ('tomato')",
        },
        palette: {
          type: "string",
          enum: ["complementary", "analogous", "triadic", "splitComplementary", "tetradic", "monochromatic"],
          description: "Optional — generate a color harmony palette based on the input color",
        },
      },
      required: ["color"],
    },
  },
  {
    name: "convert_currency",
    dataSource: onDemand("Exchange Rate API"),
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
    dataSource: onDemand("World Time API"),
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
          description:
            "Timezone area (e.g. 'America', 'Europe', 'Asia', 'Pacific')",
        },
        location: {
          type: "string",
          description:
            "Timezone location (e.g. 'Vancouver', 'Tokyo', 'London', 'New_York')",
        },
        ...fieldsParam(FIELDS.TIMEZONE),
      },
      required: ["area", "location"],
    },
  },
  {
    name: "lookup_ip",
    dataSource: onDemand("IPinfo.io"),
    description:
      "Look up geolocation and network information for an IP address. Returns city, region, country, coordinates, and ISP/organization info. For your own server IP, omit the ip parameter or use 'self'.",
    endpoint: {
      path: "/utility/ip/:ip",
      pathParams: ["ip"],
    },
    parameters: {
      type: "object",
      properties: {
        ip: {
          type: "string",
          description:
            "The IP address to look up (e.g. '8.8.8.8'). Leave empty or use 'self' for the caller's IP.",
        },
        ...fieldsParam(FIELDS.IP_GEOLOCATION),
      },
    },
  },
  {
    name: "search_nearby_places",
    dataSource: onDemand("Google Places API"),
    description:
      "Search for nearby places/businesses by type (e.g. restaurant, cafe, pharmacy, gas_station, grocery_store, gym, hospital, park, shopping_mall, bar, hotel, bank, library). Returns name, address, rating, reviews, price level, phone, website, and whether currently open. To show results on a map, follow up with the generate_map tool using the returned coordinates.",
    endpoint: {
      path: "/utility/places/nearby",
      queryParams: ["type", "latitude", "longitude", "radius", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Google Places type to search for. Common types: restaurant, cafe, bar, bakery, pharmacy, gas_station, grocery_store, supermarket, gym, hospital, dentist, park, shopping_mall, hotel, bank, library, museum, movie_theater, night_club, spa, car_repair, car_wash, laundry, post_office, veterinary_care",
        },
        latitude: {
          type: "number",
          description: "Center latitude for the search (defaults to server location)",
        },
        longitude: {
          type: "number",
          description: "Center longitude for the search (defaults to server location)",
        },
        radius: {
          type: "number",
          description: "Search radius in meters (default: 5000, max: 50000)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 20, max: 20)",
        },
        ...fieldsParam(FIELDS.PLACES),
      },
      required: ["type"],
    },
  },
  {
    name: "search_places",
    dataSource: onDemand("Google Places API"),
    description:
      "Search for places using a natural language text query (e.g. 'best sushi near downtown', 'coffee shops with wifi', '24 hour pharmacy'). More flexible than nearby search — supports descriptive queries. Returns name, address, rating, reviews, price level, phone, website, and whether currently open. To show results on a map, follow up with the generate_map tool using the returned coordinates.",
    endpoint: {
      path: "/utility/places/search",
      queryParams: ["q", "latitude", "longitude", "radius", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Natural language search query (e.g. 'italian restaurants', 'best coffee shops', '24 hour pharmacy near me')",
        },
        latitude: {
          type: "number",
          description: "Bias latitude for the search (defaults to server location)",
        },
        longitude: {
          type: "number",
          description: "Bias longitude for the search (defaults to server location)",
        },
        radius: {
          type: "number",
          description: "Bias radius in meters (default: 10000, max: 50000)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 10, max: 20)",
        },
        ...fieldsParam(FIELDS.PLACES),
      },
      required: ["q"],
    },
  },
  {
    name: "generate_map",
    dataSource: onDemand("Google Static Maps API"),
    description:
      "Generate an interactive Google Map with labeled markers for a set of locations. Use this AFTER a places search, IP lookup, or any query that yields coordinates. Pass the locations as a JSON markers array. The response contains a mapEmbedUrl — you MUST render it in your response using ![Map](mapEmbedUrl) markdown syntax so the user sees the interactive map inline.",
    endpoint: {
      path: "/utility/map",
      queryParams: ["markers", "zoom", "maptype"],
    },
    parameters: {
      type: "object",
      properties: {
        markers: {
          type: "string",
          description:
            'JSON array of marker objects. Each marker: { "latitude": number, "longitude": number, "label": "optional string" }. Example: [{"latitude":49.28,"longitude":-123.12,"label":"Miku"},{"latitude":49.27,"longitude":-123.11,"label":"Ramen Danbo"}]',
        },
        zoom: {
          type: "number",
          description: "Optional zoom level (1-20). If omitted, auto-fits to markers.",
        },
        maptype: {
          type: "string",
          description: "Map type: roadmap, satellite, terrain, hybrid (default: roadmap)",
          enum: ["roadmap", "satellite", "terrain", "hybrid"],
        },
      },
      required: ["markers"],
    },
  },

  // ── Chart Generation ──────────────────────────────────────
  {
    name: "generate_chart",
    dataSource: onDemand("internal"),
    description:
      "Generate an interactive chart (bar, line, or pie) from structured data. Use this to visualize comparisons, trends, distributions, or any numeric data the user asks to see as a chart. Pass labels (category names or x-axis values) and one or more datasets (each with a label and numeric data array). The response contains a chartImageUrl — you MUST render it in your response using ![Chart](chartImageUrl) markdown syntax so the user sees the chart image inline.",
    endpoint: {
      method: "POST",
      path: "/utility/chart",
      bodyParams: ["type", "title", "labels", "datasets"],
    },
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "The chart type to generate",
          enum: ["bar", "line", "pie"],
        },
        title: {
          type: "string",
          description: "Optional chart title displayed at the top",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description:
            'Category labels (bar/pie) or x-axis values (line). Example: ["Jan", "Feb", "Mar", "Apr"]',
        },
        datasets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "Dataset name shown in the legend (e.g. \"Revenue\", \"Temperature\")",
              },
              data: {
                type: "array",
                items: { type: "number" },
                description:
                  "Numeric values corresponding to each label. Length must match labels array.",
              },
            },
            required: ["label", "data"],
          },
          description:
            'One or more data series. For pie charts use a single dataset. Example: [{"label": "Sales", "data": [120, 190, 300, 500]}]',
        },
      },
      required: ["type", "labels", "datasets"],
    },
  },

  // ── Periodic Table ─────────────────────────────────────────
  {
    name: "search_elements",
    dataSource: staticDataset("Periodic Table"),
    description:
      "Search the periodic table by element name, symbol, or atomic number. Returns full element data including atomic mass, density, melting/boiling points, electronegativity, electron configuration, and more. Optionally filter by category (e.g. 'noble gas', 'transition metal') or block (s, p, d, f).",
    endpoint: {
      path: "/knowledge/elements/search",
      queryParams: ["q", "limit", "category", "block"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Search query — element name (e.g. 'iron'), symbol (e.g. 'Fe'), or atomic number (e.g. '26')",
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        category: {
          type: "string",
          description:
            "Filter by element category (e.g. 'noble gas', 'transition metal', 'alkali metal', 'metalloid')",
        },
        block: {
          type: "string",
          description: "Filter by electron block",
          enum: ["s", "p", "d", "f"],
        },
        ...fieldsParam(FIELDS.ELEMENTS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_element",
    dataSource: staticDataset("Periodic Table"),
    description:
      "Get full details of a specific chemical element by its symbol (e.g. 'Fe' for Iron, 'Au' for Gold). Returns atomic mass, density, melting/boiling points, electron configuration, discovery info, and a summary.",
    endpoint: {
      path: "/knowledge/elements/:symbol",
      pathParams: ["symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Element symbol (e.g. 'Fe', 'Au', 'H', 'O')",
        },
        ...fieldsParam(FIELDS.ELEMENTS),
      },
      required: ["symbol"],
    },
  },
  {
    name: "rank_elements",
    dataSource: staticDataset("Periodic Table"),
    description:
      "Rank chemical elements by a numeric property — atomic mass, density, melting point, boiling point, electronegativity, ionization energy, or electron affinity. Example: 'densest elements' → property='density_g_cm3'.",
    endpoint: {
      path: "/knowledge/elements/rank",
      queryParams: ["property", "limit", "order", "category", "block"],
    },
    parameters: {
      type: "object",
      properties: {
        property: {
          type: "string",
          description: "Which property to rank by",
          enum: [
            "atomic_mass",
            "electronegativity",
            "density_g_cm3",
            "molar_heat_j_mol_k",
            "electron_affinity_kj_mol",
            "first_ionization_energy_kj_mol",
            "melting_point_k",
            "boiling_point_k",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        order: {
          type: "string",
          description: "Sort order",
          enum: ["asc", "desc"],
        },
        category: { type: "string", description: "Filter by element category" },
        block: {
          type: "string",
          description: "Filter by block",
          enum: ["s", "p", "d", "f"],
        },
        ...fieldsParam(FIELDS.ELEMENT_RANKING),
      },
      required: ["property"],
    },
  },
  {
    name: "get_element_categories",
    dataSource: staticDataset("Periodic Table"),
    description:
      "List all element categories (noble gas, transition metal, etc.), blocks (s, p, d, f), phases at STP, and available rankable properties. Use this for discovery before searching or ranking.",
    endpoint: { path: "/knowledge/elements/categories" },
    parameters: {
      type: "object",
      properties: {},
    },
  },

  // ── World Bank Indicators ───────────────────────────────────
  {
    name: "get_country_indicators",
    dataSource: staticDataset("World Bank"),
    description:
      "Get development indicators for a specific country by ISO alpha-3 code or name. Returns GDP, population, life expectancy, CO2 emissions, unemployment, literacy, internet penetration, and more. Data from World Bank.",
    endpoint: {
      path: "/knowledge/indicators/country/:code",
      pathParams: ["code"],
    },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "ISO 3166-1 alpha-3 country code (e.g. 'USA', 'CAN', 'JPN', 'GBR') or country name",
        },
        ...fieldsParam(FIELDS.WORLD_BANK_COUNTRY),
      },
      required: ["code"],
    },
  },
  {
    name: "rank_countries_by_indicator",
    dataSource: staticDataset("World Bank"),
    description:
      "Rank countries by a specific development indicator. Example: 'countries with highest GDP per capita' \u2192 indicator='gdp_per_capita_usd'. Supports ascending/descending order.",
    endpoint: {
      path: "/knowledge/indicators/rank",
      queryParams: ["indicator", "limit", "order"],
    },
    parameters: {
      type: "object",
      properties: {
        indicator: {
          type: "string",
          description: "Which indicator to rank by",
          enum: [
            "gdp_usd",
            "gdp_per_capita_usd",
            "population",
            "life_expectancy",
            "infant_mortality_per_1k",
            "co2_per_capita_tons",
            "literacy_rate_pct",
            "internet_users_pct",
            "unemployment_pct",
            "inflation_cpi_pct",
            "forest_area_pct",
            "renewable_energy_pct",
            "gini_index",
            "electricity_access_pct",
            "health_expenditure_per_capita_usd",
          ],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        order: {
          type: "string",
          description: "Sort order (default: desc)",
          enum: ["asc", "desc"],
        },
        ...fieldsParam(FIELDS.WORLD_BANK_RANKING),
      },
      required: ["indicator"],
    },
  },
  {
    name: "compare_countries",
    dataSource: staticDataset("World Bank"),
    description:
      "Compare development indicators between multiple countries side-by-side. Pass comma-separated ISO alpha-3 codes. Optionally focus on a single indicator. Example: 'compare USA, CAN, GBR on life expectancy'.",
    endpoint: {
      path: "/knowledge/indicators/compare",
      queryParams: ["countries", "indicator"],
    },
    parameters: {
      type: "object",
      properties: {
        countries: {
          type: "string",
          description:
            "Comma-separated ISO alpha-3 codes (e.g. 'USA,CAN,JPN,GBR')",
        },
        indicator: {
          type: "string",
          description:
            "Optional: focus comparison on one indicator (e.g. 'life_expectancy')",
          enum: [
            "gdp_usd",
            "gdp_per_capita_usd",
            "population",
            "life_expectancy",
            "infant_mortality_per_1k",
            "co2_per_capita_tons",
            "literacy_rate_pct",
            "internet_users_pct",
            "unemployment_pct",
            "inflation_cpi_pct",
            "forest_area_pct",
            "renewable_energy_pct",
            "gini_index",
            "electricity_access_pct",
            "health_expenditure_per_capita_usd",
          ],
        },
        ...fieldsParam(FIELDS.WORLD_BANK_COUNTRY),
      },
      required: ["countries"],
    },
  },
  {
    name: "list_development_indicators",
    dataSource: staticDataset("World Bank"),
    description:
      "List all available World Bank development indicators with coverage statistics. Use this for discovery before querying or ranking.",
    endpoint: { path: "/knowledge/indicators/list" },
    parameters: {
      type: "object",
      properties: {},
    },
  },

  // ── Airport Tools ──────────────────────────────────────────────

  {
    name: "search_airports",
    dataSource: staticDataset("OurAirports CSV"),
    description:
      "Search for airports by name, IATA/ICAO code, city, or country. Returns matching airports with codes, location, and type. Use this when the user asks about airports, flight routes, or travel.",
    endpoint: { path: "/utility/airports/search" },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Search query: airport name, IATA code (e.g. 'YVR'), city name, etc.",
        },
        limit: { type: "integer", description: "Max results (default 10)" },
        country: {
          type: "string",
          description: "ISO country code to filter by (e.g. 'CA', 'US', 'JP')",
        },
        ...fieldsParam(FIELDS.AIRPORTS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_airport_by_code",
    dataSource: staticDataset("OurAirports CSV"),
    description:
      "Look up a specific airport by its IATA or ICAO code. Returns full details including coordinates.",
    endpoint: { path: "/utility/airports/code/{code}" },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "IATA (e.g. 'YVR', 'LAX') or ICAO (e.g. 'CYVR') code",
        },
        ...fieldsParam(FIELDS.AIRPORTS),
      },
      required: ["code"],
    },
  },
  {
    name: "get_airports_by_country",
    dataSource: staticDataset("OurAirports CSV"),
    description:
      "List all medium and large airports in a country. Results sorted by size (large airports first).",
    endpoint: { path: "/utility/airports/country/{code}" },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "ISO country code (e.g. 'CA', 'US', 'JP', 'DE')",
        },
        limit: { type: "integer", description: "Max results (default 50)" },
        ...fieldsParam(FIELDS.AIRPORTS),
      },
      required: ["code"],
    },
  },
  {
    name: "find_nearest_airports",
    dataSource: staticDataset("OurAirports CSV"),
    description:
      "Find the nearest airports to a given latitude/longitude coordinate. Uses Haversine distance calculation. Great for travel planning.",
    endpoint: { path: "/utility/airports/nearest" },
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude (decimal degrees)" },
        lng: { type: "number", description: "Longitude (decimal degrees)" },
        limit: { type: "integer", description: "Max results (default 5)" },
        ...fieldsParam(FIELDS.AIRPORTS_NEAREST),
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "get_public_webcams",
    dataSource: onDemand("Municipal Open Data APIs"),
    description:
      "Get a list of public traffic and scenic webcams for a specific city across North America. Returns camera name, location, coordinates, and the URL to the camera page or image. Covers 33 cities across Canada and the US.",
    endpoint: { path: "/utility/webcams", queryParams: ["city", "limit"] },
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description:
            "City/area name. Default: vancouver.",
          enum: [
            "vancouver", "seattle", "toronto", "calgary", "austin",
            "ottawa", "hamilton", "london-on", "kingston", "windsor-on",
            "kitchener", "barrie", "thunder-bay", "sudbury", "niagara", "mississauga",
            "edmonton", "red-deer", "lethbridge", "medicine-hat", "grande-prairie", "banff", "fort-mcmurray",
            "baton-rouge",
            "nyc", "buffalo", "syracuse", "albany", "rochester", "long-island", "westchester", "utica", "binghamton", "ithaca",
          ],
        },
        limit: {
          type: "integer",
          description: "Max number of webcams to return. Default 100.",
        },
        ...fieldsParam(FIELDS.WEBCAMS),
      },
    },
  },

  // ── Exoplanet Tools ────────────────────────────────────────────

  {
    name: "search_exoplanets",
    dataSource: staticDataset("NASA Exoplanet Archive"),
    description:
      "Search confirmed exoplanets from the NASA Exoplanet Archive by name or host star. Database contains ~6,100 planets.",
    endpoint: { path: "/knowledge/exoplanets/search" },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Planet name or host star name (e.g. 'TRAPPIST-1', 'Kepler-442', 'Proxima')",
        },
        limit: { type: "integer", description: "Max results (default 10)" },
        method: {
          type: "string",
          description: "Filter by discovery method (e.g. 'Transit', 'Radial Velocity', 'Imaging', 'Microlensing')",
        },
        ...fieldsParam(FIELDS.EXOPLANETS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_exoplanet",
    dataSource: staticDataset("NASA Exoplanet Archive"),
    description:
      "Get detailed information about a specific exoplanet by exact name.",
    endpoint: { path: "/knowledge/exoplanets/lookup/{name}" },
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact planet name (e.g. 'TRAPPIST-1 e', 'Kepler-442 b', 'Proxima Cen b')",
        },
        ...fieldsParam(FIELDS.EXOPLANETS),
      },
      required: ["name"],
    },
  },
  {
    name: "rank_exoplanets",
    dataSource: staticDataset("NASA Exoplanet Archive"),
    description:
      "Rank exoplanets by a physical property like mass, radius, temperature, or orbital period.",
    endpoint: { path: "/knowledge/exoplanets/rank" },
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "Field to rank by",
          enum: [
            "pl_orbper",
            "pl_rade",
            "pl_bmasse",
            "pl_orbsmax",
            "pl_orbeccen",
            "pl_eqt",
            "st_mass",
            "st_rad",
            "st_teff",
            "sy_dist",
          ],
        },
        limit: { type: "integer", description: "Max results (default 10)" },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort order (default 'desc')",
        },
        ...fieldsParam(FIELDS.EXOPLANET_RANKING),
      },
      required: ["field"],
    },
  },
  {
    name: "exoplanet_discovery_stats",
    dataSource: staticDataset("NASA Exoplanet Archive"),
    description:
      "Get statistics about exoplanet discoveries: methods, facilities, year ranges, and counts.",
    endpoint: { path: "/knowledge/exoplanets/stats" },
    parameters: {
      type: "object",
      properties: {
        ...fieldsParam(FIELDS.EXOPLANET_STATS),
      },
    },
  },
  {
    name: "habitable_zone_exoplanets",
    dataSource: staticDataset("NASA Exoplanet Archive"),
    description:
      "Find exoplanets in the habitable zone (equilibrium temperature 200-320K or appropriate orbit around sun-like stars). Sorted by Earth similarity.",
    endpoint: { path: "/knowledge/exoplanets/habitable" },
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max results (default 20)" },
        ...fieldsParam(FIELDS.EXOPLANETS),
      },
    },
  },

  // ── FDA Drug NDC Tools ─────────────────────────────────────────

  {
    name: "search_fda_drugs",
    dataSource: staticDataset("FDA NDC Directory"),
    description:
      "Search FDA-registered drug products by name, brand, ingredient, or manufacturer. Database contains ~26,000 NDC products. For informational use only.",
    endpoint: { path: "/health/drugs/ndc/search" },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Drug name, brand name, ingredient, or manufacturer (e.g. 'ibuprofen', 'Tylenol', 'Pfizer')",
        },
        limit: { type: "integer", description: "Max results (default 10)" },
        dosageForm: {
          type: "string",
          description: "Filter by dosage form (e.g. 'TABLET', 'CAPSULE', 'INJECTION', 'CREAM')",
        },
        productType: {
          type: "string",
          description: "Filter by product type (e.g. 'HUMAN PRESCRIPTION DRUG', 'HUMAN OTC DRUG')",
        },
        ...fieldsParam(FIELDS.FDA_DRUGS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_drug_by_ndc",
    dataSource: staticDataset("FDA NDC Directory"),
    description:
      "Look up a specific FDA drug product by its NDC (National Drug Code) identifier.",
    endpoint: { path: "/health/drugs/ndc/lookup/{ndc}" },
    parameters: {
      type: "object",
      properties: {
        ndc: {
          type: "string",
          description: "Product NDC code (e.g. '0069-0770')",
        },
        ...fieldsParam(FIELDS.FDA_DRUGS),
      },
      required: ["ndc"],
    },
  },
  {
    name: "list_drug_dosage_forms",
    dataSource: staticDataset("FDA NDC Directory"),
    description:
      "List all available drug dosage forms (tablet, capsule, injection, etc.) with counts. Use for discovery.",
    endpoint: { path: "/health/drugs/ndc/dosage-forms" },
    parameters: {
      type: "object",
      properties: {
        ...fieldsParam(FIELDS.FDA_DOSAGE_FORMS),
      },
    },
  },
  {
    name: "search_drugs_by_ingredient",
    dataSource: staticDataset("FDA NDC Directory"),
    description:
      "Find all FDA drug products containing a specific active ingredient.",
    endpoint: { path: "/health/drugs/ndc/ingredient" },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Active ingredient name (e.g. 'acetaminophen', 'ibuprofen', 'amoxicillin')",
        },
        limit: { type: "integer", description: "Max results (default 20)" },
        ...fieldsParam(FIELDS.FDA_DRUGS),
      },
      required: ["q"],
    },
  },
  {
    name: "search_drugs_by_pharm_class",
    dataSource: staticDataset("FDA NDC Directory"),
    description:
      "Find FDA drug products by pharmacological class (e.g. 'beta-blocker', 'antibiotic', 'analgesic').",
    endpoint: { path: "/health/drugs/ndc/pharm-class" },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Pharmacological class (e.g. 'Beta Adrenergic Blocker', 'Nonsteroidal Anti-inflammatory', 'Opioid Agonist')",
        },
        limit: { type: "integer", description: "Max results (default 20)" },
        ...fieldsParam(FIELDS.FDA_DRUGS),
      },
      required: ["q"],
    },
  },

  // ── Maritime Domain (AIS Stream) ──────────────────────────────
  {
    name: "get_tracked_vessels",
    dataSource: { type: "realtime", provider: "AIS Stream (aisstream.io)" },
    description:
      "Get the latest known positions and data for all maritime vessels currently tracked via AIS (Automatic Identification System). Returns vessels sorted by most recently seen. Data streams in real-time via WebSocket from nearby ship transponders.",
    endpoint: {
      path: "/maritime/vessels",
      queryParams: ["limit"],
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max vessels to return (default 100)",
        },
        ...fieldsParam(FIELDS.VESSELS),
      },
    },
  },
  {
    name: "get_vessel_by_mmsi",
    dataSource: { type: "realtime", provider: "AIS Stream (aisstream.io)" },
    description:
      "Get detailed data for a specific vessel by its MMSI (Maritime Mobile Service Identity) number. Returns position, speed, heading, destination, ship type, dimensions, and ETA if available.",
    endpoint: {
      path: "/maritime/vessels/:mmsi",
      pathParams: ["mmsi"],
    },
    parameters: {
      type: "object",
      properties: {
        mmsi: {
          type: "string",
          description: "9-digit Maritime Mobile Service Identity number",
        },
        ...fieldsParam(FIELDS.VESSELS),
      },
      required: ["mmsi"],
    },
  },
  {
    name: "search_vessels",
    dataSource: { type: "realtime", provider: "AIS Stream (aisstream.io)" },
    description:
      "Search tracked vessels by name (case-insensitive partial match). Useful for finding specific ships currently in the monitored area.",
    endpoint: {
      path: "/maritime/search",
      queryParams: ["q", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Vessel name search query (partial match)",
        },
        limit: {
          type: "integer",
          description: "Max results (default 20)",
        },
        ...fieldsParam(FIELDS.VESSELS),
      },
      required: ["q"],
    },
  },
  {
    name: "get_vessels_in_area",
    dataSource: { type: "realtime", provider: "AIS Stream (aisstream.io)" },
    description:
      "Get all tracked vessels within a geographic bounding box. Useful for monitoring ship traffic in a specific sea area, port, or strait.",
    endpoint: {
      path: "/maritime/area",
      queryParams: ["minLat", "maxLat", "minLng", "maxLng", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        minLat: {
          type: "number",
          description: "Southern boundary latitude (e.g. 48.0)",
        },
        maxLat: {
          type: "number",
          description: "Northern boundary latitude (e.g. 50.0)",
        },
        minLng: {
          type: "number",
          description: "Western boundary longitude (e.g. -125.0)",
        },
        maxLng: {
          type: "number",
          description: "Eastern boundary longitude (e.g. -122.0)",
        },
        limit: {
          type: "integer",
          description: "Max vessels to return (default 100)",
        },
        ...fieldsParam(FIELDS.VESSELS),
      },
      required: ["minLat", "maxLat", "minLng", "maxLng"],
    },
  },
  {
    name: "get_ais_messages",
    dataSource: { type: "realtime", provider: "AIS Stream (aisstream.io)" },
    description:
      "Get recent raw AIS messages from the stream buffer. Each message includes vessel identification, position, and type-specific data (position reports, static data, safety broadcasts).",
    endpoint: {
      path: "/maritime/messages",
      queryParams: ["limit", "type"],
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max messages to return (default 50)",
        },
        type: {
          type: "string",
          description:
            "Filter by AIS message type: PositionReport, ShipStaticData, StandardClassBPositionReport, ExtendedClassBPositionReport, SafetyBroadcastMessage, StandardSearchAndRescueAircraftReport, BaseStationReport",
        },
        ...fieldsParam(FIELDS.AIS_MESSAGES),
      },
    },
  },

  // ── Energy Domain (EIA) ──────────────────────────────────────
  {
    name: "get_energy_indicators",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Get a curated snapshot of key U.S. energy indicators including gasoline prices, diesel prices, crude oil (WTI/Brent), natural gas prices and storage, average electricity price, coal production, and nuclear outage percentage. Data is sourced from the EIA API.",
    endpoint: { path: "/energy/indicators" },
    parameters: {
      type: "object",
      properties: {
        ...fieldsParam(FIELDS.ENERGY_INDICATORS),
      },
    },
  },
  {
    name: "browse_energy_data",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Browse the EIA data catalog tree. Start with no route to see top-level categories (petroleum, electricity, natural-gas, coal, nuclear-outages, etc.), then drill down into sub-routes to discover available datasets, frequencies, and facets.",
    endpoint: {
      path: "/energy/browse",
      queryParams: ["route"],
    },
    parameters: {
      type: "object",
      properties: {
        route: {
          type: "string",
          description:
            "Data route path to browse (e.g. 'electricity', 'petroleum/pri', 'natural-gas/stor'). Leave empty for top-level categories.",
        },
        ...fieldsParam(FIELDS.EIA_BROWSE),
      },
    },
  },
  {
    name: "get_energy_facets",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Get available facet values for an EIA data route. Use this to discover valid filter values (e.g. state IDs, sector IDs, product codes) before querying energy data.",
    endpoint: {
      path: "/energy/facets",
      queryParams: ["route", "facetId"],
    },
    parameters: {
      type: "object",
      properties: {
        route: {
          type: "string",
          description: "EIA data route (e.g. 'electricity/retail-sales', 'petroleum/pri/gnd')",
        },
        facetId: {
          type: "string",
          description: "Facet identifier (e.g. 'stateid', 'sectorid', 'product', 'duoarea')",
        },
        ...fieldsParam(FIELDS.EIA_FACETS),
      },
      required: ["route", "facetId"],
    },
  },
  {
    name: "query_energy_data",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Query EIA energy data for a specific route with optional facet filters, date range, and frequency. Returns time-series data points. Use browse_energy_data first to discover routes and get_energy_facets to find valid filter values.",
    endpoint: {
      path: "/energy/data",
      queryParams: ["route", "frequency", "start", "end", "sort", "length", "offset"],
    },
    parameters: {
      type: "object",
      properties: {
        route: {
          type: "string",
          description: "EIA data route (e.g. 'electricity/retail-sales', 'petroleum/pri/gnd', 'natural-gas/pri/sum')",
        },
        frequency: {
          type: "string",
          description: "Data frequency: 'daily', 'weekly', 'monthly', 'quarterly', 'annual'",
        },
        start: {
          type: "string",
          description: "Start period (e.g. '2024-01', '2024')",
        },
        end: {
          type: "string",
          description: "End period (e.g. '2024-12', '2025')",
        },
        sort: {
          type: "string",
          description: "Sort column and direction (e.g. 'period:desc', 'value:asc')",
        },
        length: {
          type: "integer",
          description: "Max rows to return (default 100, max 5000)",
        },
        offset: {
          type: "integer",
          description: "Pagination offset (default 0)",
        },
      },
      required: ["route"],
    },
  },
  {
    name: "get_electricity_retail_sales",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Get U.S. electricity retail sales data including price (cents/kWh), revenue, sales volume, and customer counts. Filter by state and sector (residential, commercial, industrial, transportation).",
    endpoint: {
      path: "/energy/electricity/retail-sales",
      queryParams: ["state", "sector", "frequency", "start", "end", "length"],
    },
    parameters: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description: "State code (e.g. 'CA', 'TX', 'NY') or 'US' for national",
        },
        sector: {
          type: "string",
          description: "Sector: 'RES' (residential), 'COM' (commercial), 'IND' (industrial), 'TRA' (transportation), 'ALL' (total)",
        },
        frequency: {
          type: "string",
          description: "Data frequency: 'monthly', 'quarterly', 'annual' (default: monthly)",
        },
        start: {
          type: "string",
          description: "Start period (e.g. '2024-01')",
        },
        end: {
          type: "string",
          description: "End period (e.g. '2024-12')",
        },
        length: {
          type: "integer",
          description: "Max rows (default 50)",
        },
      },
    },
  },
  {
    name: "get_petroleum_prices",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Get U.S. petroleum/gasoline prices including regular, midgrade, premium, and diesel retail prices. Filter by product type and geographic area.",
    endpoint: {
      path: "/energy/petroleum/prices",
      queryParams: ["product", "area", "frequency", "start", "end", "length"],
    },
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Product code (e.g. 'EPM0' for regular gasoline, 'EPD2DXL0' for diesel)",
        },
        area: {
          type: "string",
          description: "Geographic area code (e.g. 'NUS' for U.S., 'R10' for PADD 1)",
        },
        frequency: {
          type: "string",
          description: "Data frequency: 'weekly', 'monthly' (default: weekly)",
        },
        start: {
          type: "string",
          description: "Start period (e.g. '2024-01-01')",
        },
        end: {
          type: "string",
          description: "End period",
        },
        length: {
          type: "integer",
          description: "Max rows (default 50)",
        },
      },
    },
  },
  {
    name: "get_natural_gas_prices",
    dataSource: onDemand("EIA (U.S. Energy Information Administration)"),
    description:
      "Get U.S. natural gas prices. Filter by process type and geographic area.",
    endpoint: {
      path: "/energy/natural-gas/prices",
      queryParams: ["process", "area", "frequency", "start", "end", "length"],
    },
    parameters: {
      type: "object",
      properties: {
        process: {
          type: "string",
          description: "Process type (e.g. 'FRC' for futures contract 1)",
        },
        area: {
          type: "string",
          description: "Geographic area code",
        },
        frequency: {
          type: "string",
          description: "Data frequency: 'daily', 'weekly', 'monthly', 'annual' (default: monthly)",
        },
        start: {
          type: "string",
          description: "Start period (e.g. '2024-01')",
        },
        end: {
          type: "string",
          description: "End period",
        },
        length: {
          type: "integer",
          description: "Max rows (default 50)",
        },
      },
    },
  },
];

// ────────────────────────────────────────────────────────────
// Domain Taxonomy — groups tools by functional area
// ────────────────────────────────────────────────────────────

const TOOL_DOMAINS = {
  // Weather & Environment
  get_current_weather: "Weather & Environment",
  get_weather_forecast: "Weather & Environment",
  get_air_quality: "Weather & Environment",
  get_earthquakes: "Weather & Environment",
  get_solar_activity: "Weather & Environment",
  get_aurora_forecast: "Weather & Environment",
  get_twilight: "Weather & Environment",
  get_tides: "Weather & Environment",
  get_wildfires: "Weather & Environment",
  get_iss_position: "Weather & Environment",
  get_near_earth_objects: "Weather & Environment",
  get_solar_wind: "Weather & Environment",
  get_pollen: "Weather & Environment",
  get_apod: "Weather & Environment",
  get_launches: "Weather & Environment",
  get_weather_warnings: "Weather & Environment",
  get_avalanche_forecast: "Weather & Environment",
  get_google_air_quality: "Weather & Environment",

  // Events
  search_events: "Events",
  get_upcoming_events: "Events",
  get_events_today: "Events",
  get_event_summary: "Events",

  // Markets & Commodities
  get_commodities_summary: "Markets & Commodities",
  get_commodity_by_category: "Markets & Commodities",
  get_commodity_ticker: "Markets & Commodities",
  get_commodity_categories: "Markets & Commodities",
  get_commodity_history: "Markets & Commodities",

  // Trends
  get_trends: "Trends",
  get_hot_trends: "Trends",
  get_top_trends: "Trends",

  // Products
  search_products: "Products",
  get_trending_products: "Products",
  get_product_availability: "Products",
  check_product_availability: "Products",
  get_costco_us_products: "Products",
  get_costco_ca_products: "Products",

  // Finance
  get_stock_quote: "Finance",
  get_company_profile: "Finance",
  get_market_news: "Finance",
  get_earnings_calendar: "Finance",
  get_stock_recommendation: "Finance",
  get_stock_financials: "Finance",
  get_macro_indicators: "Finance",
  search_macro_series: "Finance",
  get_macro_series_info: "Finance",
  get_macro_observations: "Finance",

  // Knowledge
  define_word: "Knowledge",
  search_books: "Knowledge",
  get_book_details: "Knowledge",
  get_author_info: "Knowledge",
  get_country_info: "Knowledge",
  get_country_by_code: "Knowledge",
  search_papers: "Knowledge",
  get_wikipedia_summary: "Knowledge",
  get_on_this_day: "Knowledge",
  search_anime: "Knowledge",
  get_top_anime: "Knowledge",
  get_current_season_anime: "Knowledge",
  get_anime_details: "Knowledge",
  search_elements: "Knowledge",
  get_element: "Knowledge",
  rank_elements: "Knowledge",
  get_element_categories: "Knowledge",
  get_country_indicators: "Knowledge",
  rank_countries_by_indicator: "Knowledge",
  compare_countries: "Knowledge",
  list_development_indicators: "Knowledge",
  search_exoplanets: "Knowledge",
  get_exoplanet: "Knowledge",
  rank_exoplanets: "Knowledge",
  exoplanet_discovery_stats: "Knowledge",
  habitable_zone_exoplanets: "Knowledge",

  // Movies & TV
  search_movies: "Movies & TV",
  get_movie_details: "Movies & TV",
  get_movie_credits: "Movies & TV",
  get_trending_movies: "Movies & TV",
  discover_movies: "Movies & TV",
  get_movie_genres: "Movies & TV",
  search_tv_shows: "Movies & TV",
  get_tv_show_details: "Movies & TV",
  get_tv_show_credits: "Movies & TV",
  get_tv_season_details: "Movies & TV",
  get_trending_tv_shows: "Movies & TV",
  discover_tv_shows: "Movies & TV",
  get_tv_genres: "Movies & TV",

  // Health
  search_drug_info: "Health",
  get_drug_adverse_events: "Health",
  get_drug_recalls: "Health",
  search_usda_nutrition: "Health",
  rank_foods_by_nutrient: "Health",
  compare_food_nutrition: "Health",
  get_food_categories: "Health",
  get_nutrient_types: "Health",
  list_category_nutrients: "Health",
  top_foods_by_macro: "Health",
  top_foods_by_mineral: "Health",
  top_foods_by_vitamin: "Health",
  top_foods_by_amino_acid: "Health",
  top_foods_by_lipid: "Health",
  top_foods_by_carb: "Health",
  top_foods_by_sterol: "Health",
  search_foods_by_taxonomy: "Health",
  browse_food_taxonomy: "Health",
  search_fda_drugs: "Health",
  get_drug_by_ndc: "Health",
  list_drug_dosage_forms: "Health",
  search_drugs_by_ingredient: "Health",
  search_drugs_by_pharm_class: "Health",
  search_gym_exercises: "Health",
  get_gym_exercise_categories: "Health",
  get_gym_exercise_by_id: "Health",

  // Transit
  get_next_bus: "Transit",
  get_transit_stop_info: "Transit",
  find_transit_stops_nearby: "Transit",
  get_transit_route_info: "Transit",

  // Utilities
  precise_calculator: "Utilities",
  convert_currency: "Utilities",
  get_time_in_timezone: "Utilities",
  lookup_ip: "Utilities",
  search_nearby_places: "Utilities",
  search_places: "Utilities",
  generate_map: "Utilities",
  generate_chart: "Utilities",
  search_airports: "Utilities",
  get_airport_by_code: "Utilities",
  get_airports_by_country: "Utilities",
  find_nearest_airports: "Utilities",
  get_public_webcams: "Utilities",
  execute_python: "Utilities",

  // Compute
  execute_javascript: "Compute",
  execute_shell: "Compute",
  convert_units: "Compute",
  parse_datetime: "Compute",
  transform_json: "Compute",
  generate_csv: "Compute",
  generate_qr_code: "Compute",
  render_latex: "Compute",
  generate_diagram: "Compute",
  diff_text: "Compute",
  generate_hash: "Compute",
  regex_tester: "Compute",
  encode_decode: "Compute",
  convert_color: "Compute",

  // Maritime
  get_tracked_vessels: "Maritime",
  get_vessel_by_mmsi: "Maritime",
  search_vessels: "Maritime",
  get_vessels_in_area: "Maritime",
  get_ais_messages: "Maritime",

  // Energy
  get_energy_indicators: "Energy",
  browse_energy_data: "Energy",
  get_energy_facets: "Energy",
  query_energy_data: "Energy",
  get_electricity_retail_sales: "Energy",
  get_petroleum_prices: "Energy",
  get_natural_gas_prices: "Energy",
};

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Get all tool schemas with endpoint metadata.
 * Used by clients (like Retina) to build dynamic executors.
 * @returns {Array} Full tool definitions including endpoint info
 */
export function getToolSchemas() {
  return TOOL_DEFINITIONS.map((t) => ({
    ...t,
    domain: TOOL_DOMAINS[t.name] || "Other",
  }));
}

/**
 * Get tool schemas cleaned for LLM consumption.
 * Strips the `endpoint` property since the AI doesn't need routing info.
 * @returns {Array} Tool definitions without endpoint metadata
 */
export function getToolSchemasForAI() {
  return TOOL_DEFINITIONS.map(
    ({ endpoint: _endpoint, dataSource: _dataSource, ...rest }) => rest,
  );
}

/**
 * Get the available fields map.
 * @returns {object} FIELDS enum map
 */
export function getFields() {
  return FIELDS;
}
