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
  // Weather domain — still used by get_weather_forecast, get_avalanche_forecast
  OPEN_METEO_INTERVAL_MS,
  AVALANCHE_INTERVAL_MS,
  // Product domain
  BESTBUY_INTERVAL_MS,
  BESTBUY_CA_AVAILABILITY_INTERVAL_MS,
  COSTCO_INTERVAL_MS,
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

  // YouTube Video: from YouTubeFetcher.getYouTubeVideoInfo()
  YOUTUBE_VIDEO: [
    "videoId",
    "url",
    "title",
    "author",
    "authorUrl",
    "channelId",
    "description",
    "publishDate",
    "duration",
    "genre",
    "viewCount",
    "isFamilyFriendly",
    "keywords",
    "thumbnailUrl",
    "transcript",
  ],

  // GitHub Repo: from GitHubFetcher.getGitHubRepo()
  GITHUB_REPO: [
    "fullName",
    "description",
    "url",
    "homepage",
    "stars",
    "forks",
    "openIssues",
    "watchers",
    "language",
    "languages",
    "license",
    "topics",
    "defaultBranch",
    "isArchived",
    "isFork",
    "createdAt",
    "updatedAt",
    "pushedAt",
    "sizeKb",
    "readme",
  ],

  // Reddit Thread: from RedditFetcher.getRedditThread()
  REDDIT_THREAD: [
    "title",
    "author",
    "subreddit",
    "score",
    "upvoteRatio",
    "url",
    "externalUrl",
    "selfText",
    "commentCount",
    "createdUtc",
    "flair",
    "isNsfw",
    "domain",
    "comments",
  ],

  // NPM Package: from NpmFetcher.getNpmPackage()
  NPM_PACKAGE: [
    "name",
    "version",
    "description",
    "license",
    "homepage",
    "repository",
    "keywords",
    "author",
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "engines",
    "types",
    "weeklyDownloads",
    "distTags",
    "createdAt",
    "lastPublished",
    "deprecated",
    "readme",
  ],

  // PyPI Package: from PyPiFetcher.getPyPiPackage()
  PYPI_PACKAGE: [
    "name",
    "version",
    "summary",
    "description",
    "author",
    "maintainer",
    "license",
    "homepage",
    "projectUrls",
    "keywords",
    "requiresPython",
    "requiresDist",
    "classifiers",
  ],

  // PDF: from PdfFetcher.readPdfUrl()
  PDF: [
    "url",
    "pageCount",
    "info",
    "text",
    "charCount",
    "truncated",
  ],

  // RSS Feed: from RssFetcher.readRssFeed()
  RSS_FEED: [
    "format",
    "feedUrl",
    "title",
    "description",
    "link",
    "language",
    "itemCount",
    "items",
  ],

  // Twitter/X Post: from TwitterFetcher.getTwitterPost()
  TWITTER_POST: [
    "tweetId",
    "url",
    "author",
    "authorHandle",
    "text",
    "createdAt",
    "likes",
    "retweets",
    "replies",
    "views",
    "media",
    "quotedTweet",
  ],

  // Hacker News Thread: from HackerNewsFetcher.getHackerNewsThread()
  HACKERNEWS_THREAD: [
    "id",
    "type",
    "title",
    "url",
    "hnUrl",
    "author",
    "score",
    "commentCount",
    "time",
    "text",
    "comments",
  ],

  // Stack Overflow Question: from StackOverflowFetcher.getStackOverflowQuestion()
  STACKOVERFLOW_QUESTION: [
    "questionId",
    "title",
    "url",
    "author",
    "body",
    "tags",
    "score",
    "viewCount",
    "answerCount",
    "isAnswered",
    "acceptedAnswerId",
    "createdAt",
    "answers",
  ],

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
    name: "get_weather",
    dataSource: onDemand("Open-Meteo Geocoding + Forecast"),
    description:
      "Get live current weather and 3-day forecast for any location worldwide. Accepts a city name (geocoded automatically) or direct latitude/longitude coordinates. Returns temperature, humidity, wind, precipitation, UV index, pressure, cloud cover, sunrise/sunset, and daily forecasts. Supports metric and imperial units.",
    endpoint: {
      path: "/weather/live",
      queryParams: ["location", "latitude", "longitude", "units"],
    },
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City name, optionally with country code (e.g. 'Tokyo', 'Paris, FR', 'New York')",
        },
        latitude: {
          type: "number",
          description: "Latitude (use instead of location for precise coordinates)",
        },
        longitude: {
          type: "number",
          description: "Longitude (use instead of location for precise coordinates)",
        },
        units: {
          type: "string",
          description: "Unit system: metric (°C, km/h, mm) or imperial (°F, mph, inch). Default: metric",
          enum: ["metric", "imperial"],
        },
      },
    },
  },
  {
    name: "get_local_environment",
    dataSource: onDemand("Multiple APIs"),
    description:
      "Get cached environmental, weather, or space data for the server's local area. This returns pre-fetched data for the server's IP-based location — for weather at a specific place, use get_weather instead. Select a source: current_weather (temp/wind/humidity), air_quality (AQI/pollutants), earthquakes (seismic), solar_activity (flares/storms), aurora (Kp index), twilight (sunrise/sunset), tides, wildfires, iss (ISS position), neo (near-Earth objects), solar_wind, pollen, apod (NASA pic of the day), launches (rockets), warnings (NWS alerts), air_quality_google.",
    endpoint: {
      path: "/weather/environment",
      queryParams: ["source"],
    },
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Which environmental data source to query",
          enum: [
            "current_weather", "air_quality", "earthquakes", "solar_activity",
            "aurora", "twilight", "tides", "wildfires", "iss", "neo",
            "solar_wind", "pollen", "apod", "launches", "warnings", "air_quality_google",
          ],
        },
        fields: { type: "string", description: "Comma-separated fields to return (varies by source)" },
      },
      required: ["source"],
    },
  },

  // ── Events (4 → 1) ────────────────────────────────────────
  {
    name: "get_events",
    dataSource: onDemand("Beacon event aggregation"),
    description:
      "Get community events. Actions: 'search' (full-text with optional source/category), 'upcoming' (next N days), 'today' (today's events), 'summary' (aggregate stats).",
    endpoint: {
      path: "/event/events",
      queryParams: ["action", "q", "source", "category", "days", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Event query mode",
          enum: ["search", "upcoming", "today", "summary"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        source: { type: "string", description: "Event source filter (action=search)" },
        category: { type: "string", description: "Category filter (action=search)" },
        days: { type: "number", description: "Days ahead (action=upcoming, default: 7)" },
        limit: { type: "number", description: "Max results (default: 20)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action"],
    },
  },

  // ── Commodities (5 → 1) ───────────────────────────────────
  {
    name: "get_commodities",
    dataSource: onDemand("YAML-sourced commodities"),
    description:
      "Get commodity market data. Actions: 'summary' (all overview), 'category' (by category), 'ticker' (specific ticker), 'categories' (list categories), 'history' (price history).",
    endpoint: {
      path: "/market/commodities/data",
      queryParams: ["action", "category", "ticker", "hours"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Query mode",
          enum: ["summary", "category", "ticker", "categories", "history"],
        },
        category: { type: "string", description: "Category name (action=category)" },
        ticker: { type: "string", description: "Commodity ticker (action=ticker or history)" },
        hours: { type: "number", description: "Lookback hours (action=history, default: 24)" },
        ...fieldsParam(FIELDS.COMMODITY),
      },
      required: ["action"],
    },
  },

  // ── Trends (3 → 1) ────────────────────────────────────────
  {
    name: "get_trends",
    dataSource: onDemand("Trend aggregation"),
    description:
      "Get trending topics. Actions: 'current' (by source), 'hot' (hottest), 'top' (top over N hours).",
    endpoint: {
      path: "/trend/data",
      queryParams: ["action", "source", "hours", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Trend query mode",
          enum: ["current", "hot", "top"],
        },
        source: { type: "string", description: "Source filter (action=current)" },
        hours: { type: "number", description: "Lookback hours (action=top, default: 24)" },
        limit: { type: "number", description: "Max results (default: 20)" },
        ...fieldsParam(FIELDS.TRENDS),
      },
      required: ["action"],
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

  // ── Finance: Stocks (4 → 1) ───────────────────────────────────
  {
    name: "get_stock_data",
    dataSource: onDemand("Finnhub API"),
    description:
      "Get stock market data by symbol. Actions: 'quote' (real-time price/change), 'profile' (company info, sector, market cap), 'recommendation' (analyst consensus), 'financials' (key financial metrics).",
    endpoint: {
      path: "/finance/stock/data",
      queryParams: ["action", "symbol"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Data type to retrieve",
          enum: ["quote", "profile", "recommendation", "financials"],
        },
        symbol: {
          type: "string",
          description: "Stock ticker symbol (e.g. 'AAPL', 'MSFT', 'TSLA')",
        },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action", "symbol"],
    },
  },

  // ── Finance: Macro/FRED (4 → 1) ───────────────────────────────
  {
    name: "get_macro_data",
    dataSource: onDemand("FRED (Federal Reserve)"),
    description:
      "Access macroeconomic data from FRED. Actions: 'indicators' (key indicator summary), 'search' (search data series), 'series' (series metadata by ID), 'observations' (time series data points).",
    endpoint: {
      path: "/finance/macro/data",
      queryParams: ["action", "q", "seriesId", "limit", "orderBy", "sortOrder", "observationStart", "observationEnd"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Query mode",
          enum: ["indicators", "search", "series", "observations"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        seriesId: { type: "string", description: "FRED series ID like 'GDP', 'UNRATE' (action=series or observations)" },
        limit: { type: "number", description: "Max results (default: 10)" },
        orderBy: { type: "string", description: "Sort field (action=search)" },
        sortOrder: { type: "string", enum: ["asc", "desc"], description: "Sort direction (action=observations)" },
        observationStart: { type: "string", description: "Start date YYYY-MM-DD (action=observations)" },
        observationEnd: { type: "string", description: "End date YYYY-MM-DD (action=observations)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action"],
    },
  },

  // ── Knowledge (consolidated tools) ────────────────────────────
  {
    name: "lookup_book",
    dataSource: onDemand("Open Library API"),
    description:
      "Search or look up books/authors from Open Library. Actions: 'search' (full-text search), 'work' (book details by work key), 'author' (author info by key).",
    endpoint: {
      path: "/knowledge/books/lookup",
      queryParams: ["action", "q", "workKey", "authorKey", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Lookup mode",
          enum: ["search", "work", "author"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        workKey: { type: "string", description: "Open Library work key like 'OL45804W' (action=work)" },
        authorKey: { type: "string", description: "Open Library author key like 'OL34184A' (action=author)" },
        limit: { type: "number", description: "Max results (action=search, default: 10)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action"],
    },
  },
  {
    name: "get_country_data",
    dataSource: onDemand("REST Countries + World Bank"),
    description:
      "Look up country info or development indicators. Actions: 'info' (by name), 'code' (by ISO code), 'indicators' (development data for a country), 'rank' (rank countries by indicator), 'compare' (compare multiple countries).",
    endpoint: {
      path: "/knowledge/countries/data",
      queryParams: ["action", "name", "code", "indicator", "countries", "limit", "order"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Query mode",
          enum: ["info", "code", "indicators", "rank", "compare"],
        },
        name: { type: "string", description: "Country name (action=info)" },
        code: { type: "string", description: "ISO 2/3-letter code (action=code or indicators)" },
        indicator: { type: "string", description: "World Bank indicator ID (action=rank or compare)" },
        countries: { type: "string", description: "Comma-separated country codes (action=compare)" },
        limit: { type: "number", description: "Max results (action=rank, default: 10)" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order (action=rank)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action"],
    },
  },
  {
    name: "get_element_data",
    dataSource: staticDataset("Periodic Table (119 elements)"),
    description:
      "Query the periodic table. Actions: 'search' (text search), 'lookup' (by symbol), 'rank' (rank by property), 'categories' (list categories).",
    endpoint: {
      path: "/knowledge/elements/data",
      queryParams: ["action", "q", "symbol", "property", "limit", "order", "category", "block"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Query mode",
          enum: ["search", "lookup", "rank", "categories"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        symbol: { type: "string", description: "Element symbol like 'Fe', 'Au' (action=lookup)" },
        property: { type: "string", description: "Property to rank by (action=rank)" },
        limit: { type: "number", description: "Max results (default: 10)" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order (action=rank)" },
        category: { type: "string", description: "Filter by element category" },
        block: { type: "string", description: "Filter by block (s, p, d, f)" },
        ...fieldsParam(FIELDS.ELEMENTS),
      },
      required: ["action"],
    },
  },
  {
    name: "get_exoplanet_data",
    dataSource: staticDataset("NASA Exoplanet Archive (~6,153 planets)"),
    description:
      "Query the NASA exoplanet database. Actions: 'search' (text search), 'lookup' (by name), 'rank' (rank by property), 'stats' (discovery statistics), 'habitable' (habitable zone planets).",
    endpoint: {
      path: "/knowledge/exoplanets/data",
      queryParams: ["action", "q", "name", "field", "limit", "order", "method"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Query mode",
          enum: ["search", "lookup", "rank", "stats", "habitable"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        name: { type: "string", description: "Planet name (action=lookup)" },
        field: { type: "string", description: "Property to rank by (action=rank)" },
        limit: { type: "number", description: "Max results (default: 10)" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order" },
        method: { type: "string", description: "Discovery method filter (action=search)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action"],
    },
  },
  {
    name: "get_anime",
    dataSource: onDemand("Jikan (MyAnimeList)"),
    description:
      "Search and browse anime. Actions: 'search' (text search), 'top' (top rated), 'season' (current season), 'details' (full details by MAL ID).",
    endpoint: {
      path: "/knowledge/anime/data",
      queryParams: ["action", "q", "id", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Query mode",
          enum: ["search", "top", "season", "details"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        id: { type: "number", description: "MyAnimeList ID (action=details)" },
        limit: { type: "number", description: "Max results (default: 10)" },
        ...fieldsParam(FIELDS.ANIME),
      },
      required: ["action"],
    },
  },

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
    name: "get_youtube_video",
    dataSource: onDemand("YouTube oEmbed + youtube-transcript"),
    description:
      "Get full metadata and transcript for a YouTube video. Returns title, author, description, publish date, duration, view count, keywords, and the full timestamped transcript/captions. Accepts any YouTube URL format (youtube.com/watch, youtu.be, shorts, live) or a raw 11-character video ID. Useful for summarizing video content, extracting quotes, or analyzing spoken content without watching.",
    endpoint: {
      path: "/knowledge/youtube/video",
      queryParams: ["url", "lang", "transcript", "timestamps"],
    },
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "YouTube video URL or 11-character video ID (e.g. 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', or 'dQw4w9WgXcQ')",
        },
        lang: {
          type: "string",
          description:
            "Preferred transcript language code (e.g. 'en', 'es', 'fr'). Defaults to 'en'.",
        },
        transcript: {
          type: "string",
          description:
            "Set to 'false' to skip transcript fetching and only return metadata. Defaults to true.",
          enum: ["true", "false"],
        },
        timestamps: {
          type: "string",
          description:
            "Set to 'false' to get plain text without timestamps. Defaults to true (timestamped format).",
          enum: ["true", "false"],
        },
        ...fieldsParam(FIELDS.YOUTUBE_VIDEO),
      },
      required: ["url"],
    },
  },

  // ── Unified Web Extraction Tools ─────────────────────────────
  {
    name: "get_web_content",
    dataSource: onDemand("Auto-detected platform API"),
    description:
      "Extract structured content from a URL on any supported platform. Auto-detects: GitHub (repo metadata + README + languages), Reddit (post + comments), Twitter/X (tweet + metrics + media), Hacker News (post + comments), Stack Overflow (question + answers with code blocks). Pass the URL and optional platform-specific parameters.",
    endpoint: {
      path: "/knowledge/web/content",
      queryParams: ["url", "commentLimit", "answerLimit", "readme", "languages"],
    },
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "URL from GitHub, Reddit, Twitter/X, Hacker News, or Stack Overflow. Also accepts GitHub 'owner/repo' shorthand or Stack Overflow question IDs.",
        },
        commentLimit: {
          type: "number",
          description:
            "Max comments to fetch (Reddit default: 20, HN default: 25)",
        },
        answerLimit: {
          type: "number",
          description:
            "Max answers to fetch for Stack Overflow (default: 5, max: 10)",
        },
        readme: {
          type: "string",
          description: "Include repository README for GitHub (default: true)",
          enum: ["true", "false"],
        },
        languages: {
          type: "string",
          description: "Include language breakdown for GitHub (default: true)",
          enum: ["true", "false"],
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_package_info",
    dataSource: onDemand("NPM Registry / PyPI JSON API"),
    description:
      "Look up a package on NPM or PyPI. Returns version, description, dependencies, license, README, weekly downloads (NPM), Python version requirements (PyPI), and more. Specify the registry to search.",
    endpoint: {
      path: "/knowledge/package/info",
      queryParams: ["name", "registry", "readme"],
    },
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Package name (e.g. 'express', '@types/node', 'requests', 'numpy')",
        },
        registry: {
          type: "string",
          description: "Which package registry to search",
          enum: ["npm", "pypi"],
        },
        readme: {
          type: "string",
          description: "Include README content (NPM only, default: true)",
          enum: ["true", "false"],
        },
      },
      required: ["name", "registry"],
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

  // ── Movies & TV (12 → 6 unified + get_tv_season_details) ──────
  {
    name: "search_media",
    dataSource: onDemand("TMDB API"),
    description: "Search for movies or TV shows by title. Returns matching results with overview, release date, ratings, and poster images.",
    endpoint: {
      path: "/knowledge/media/search",
      queryParams: ["type", "q", "year", "page"],
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["movie", "tv"], description: "Search movies or TV shows" },
        q: { type: "string", description: "Search query (title)" },
        year: { type: "number", description: "Filter by release/first air date year" },
        page: { type: "number", description: "Page number (default: 1)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["type", "q"],
    },
  },
  {
    name: "get_media_details",
    dataSource: onDemand("TMDB API"),
    description: "Get full details for a movie or TV show by TMDB ID — overview, genres, runtime, ratings, revenue, production companies, seasons (TV).",
    endpoint: {
      path: "/knowledge/media/:id",
      pathParams: ["id"],
      queryParams: ["type"],
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["movie", "tv"], description: "Movie or TV show" },
        id: { type: "number", description: "TMDB ID" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "get_media_credits",
    dataSource: onDemand("TMDB API"),
    description: "Get cast and crew credits for a movie or TV show by TMDB ID.",
    endpoint: {
      path: "/knowledge/media/:id/credits",
      pathParams: ["id"],
      queryParams: ["type"],
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["movie", "tv"], description: "Movie or TV show" },
        id: { type: "number", description: "TMDB ID" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "get_trending_media",
    dataSource: onDemand("TMDB API"),
    description: "Get trending movies or TV shows for the day or week.",
    endpoint: {
      path: "/knowledge/media/trending",
      queryParams: ["type", "timeWindow", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["movie", "tv"], description: "Movie or TV show" },
        timeWindow: { type: "string", enum: ["day", "week"], description: "Trending window (default: week)" },
        limit: { type: "number", description: "Max results (default: 10)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["type"],
    },
  },
  {
    name: "discover_media",
    dataSource: onDemand("TMDB API"),
    description: "Discover movies or TV shows by genre, year, rating, and vote count. Useful for browsing, not by name.",
    endpoint: {
      path: "/knowledge/media/discover",
      queryParams: ["type", "genreId", "year", "sortBy", "page", "minVoteAverage", "minVoteCount"],
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["movie", "tv"], description: "Movie or TV show" },
        genreId: { type: "number", description: "Genre ID (use get_media_genres)" },
        year: { type: "number", description: "Release/first air date year" },
        sortBy: { type: "string", description: "Sort: popularity.desc, vote_average.desc, etc." },
        minVoteAverage: { type: "number", description: "Min vote average (0-10)" },
        minVoteCount: { type: "number", description: "Min vote count" },
        page: { type: "number", description: "Page number (default: 1)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["type"],
    },
  },
  {
    name: "get_media_genres",
    dataSource: onDemand("TMDB API"),
    description: "Get the list of genre IDs and names for movies or TV shows. Use these IDs with discover_media.",
    endpoint: {
      path: "/knowledge/media/genres",
      queryParams: ["type"],
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["movie", "tv"], description: "Movie or TV show" },
      },
      required: ["type"],
    },
  },

  // ── TV Series (TV-only) ────────────────────────────────────────

  // ── Health (consolidated tools) ────────────────────────────────
  {
    name: "rank_foods",
    dataSource: staticDataset("USDA SR Legacy"),
    description:
      "Find foods highest in a specific nutrient. Choose a category (macros, minerals, vitamins, amino_acids, lipids, carbs, sterols) and nutrient to rank by. Examples: 'foods high in protein' → category='macros', nutrient='protein'. 'Best omega-3 sources' → category='lipids', nutrient='c22_d6_n3_dha'. Use list_category_nutrients to discover valid nutrient names per category.",
    endpoint: {
      path: "/health/nutrition/top",
      queryParams: ["category", "nutrient", "limit", "kingdom", "foodType"],
    },
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Nutrient category",
          enum: ["macros", "minerals", "vitamins", "amino_acids", "lipids", "carbs", "sterols"],
        },
        nutrient: {
          type: "string",
          description: "Specific nutrient to rank by (use list_category_nutrients for valid values)",
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        kingdom: { type: "string", enum: ["animalia", "plantae", "fungi"] },
        foodType: { type: "string" },
        ...fieldsParam(FIELDS.USDA_NUTRIENT_RANKING),
      },
      required: ["category", "nutrient"],
    },
  },
  {
    name: "search_drugs",
    dataSource: onDemand("OpenFDA + FDA NDC API"),
    description:
      "Search for drug information. Use searchBy to control mode: 'name' (general search), 'ndc_search' (FDA NDC directory), 'ndc_lookup' (exact NDC code), 'ingredient' (by active ingredient), 'pharm_class' (by pharmacological class).",
    endpoint: {
      path: "/health/drugs/unified",
      queryParams: ["q", "searchBy", "limit", "dosageForm", "productType"],
    },
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query — drug name, NDC code, ingredient, or class" },
        searchBy: {
          type: "string",
          description: "Search mode",
          enum: ["name", "ndc_search", "ndc_lookup", "ingredient", "pharm_class"],
        },
        limit: { type: "number", description: "Max results (default: 10)" },
        dosageForm: { type: "string", description: "Dosage form filter (ndc_search only)" },
        productType: { type: "string", description: "Product type filter (ndc_search only)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
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

  // ── World Bank Indicators ───────────────────────────────────
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

  // ── Airports (4 → 1) ──────────────────────────────────────────
  {
    name: "lookup_airport",
    dataSource: staticDataset("OpenFlights (7,698 airports)"),
    description:
      "Look up airports. Actions: 'search' (by name/city), 'code' (by IATA/ICAO code), 'country' (list by country), 'nearest' (find nearest to coordinates).",
    endpoint: {
      path: "/utility/airports/lookup",
      queryParams: ["action", "q", "code", "country", "lat", "lng", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Lookup mode",
          enum: ["search", "code", "country", "nearest"],
        },
        q: { type: "string", description: "Search query (action=search)" },
        code: { type: "string", description: "IATA/ICAO code or country code (action=code or country)" },
        lat: { type: "number", description: "Latitude (action=nearest)" },
        lng: { type: "number", description: "Longitude (action=nearest)" },
        limit: { type: "number", description: "Max results (default: 10)" },
        country: { type: "string", description: "Country code filter (action=search)" },
        fields: { type: "string", description: "Comma-separated fields to return" },
      },
      required: ["action"],
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


  // ── FDA Drug NDC Tools ─────────────────────────────────────────

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

  // ════════════════════════════════════════════════════════════════
  // AGENTIC — File System & Web Tools for AI Coding Loops
  // ════════════════════════════════════════════════════════════════

  {
    name: "read_file",
    dataSource: compute("sandboxed fs"),
    description:
      "Read the content of a file from the local filesystem. Returns numbered lines for easy reference. Supports optional line range selection for targeted reading of large files. Use this to inspect code, understand context, or identify where to make changes. Maximum 800 lines per read — use startLine/endLine for large files.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/read",
      bodyParams: ["path", "startLine", "endLine"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the file to read. Must be within the allowed workspace roots.",
        },
        startLine: {
          type: "integer",
          description:
            "Optional 1-indexed start line (inclusive). Use with endLine to read a specific portion of a large file.",
        },
        endLine: {
          type: "integer",
          description:
            "Optional 1-indexed end line (inclusive). Maximum 800 lines will be returned per read.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    dataSource: compute("sandboxed fs"),
    description:
      "Create a new file or overwrite an existing file with the provided content. Parent directories are created automatically. Use this for creating new files — for targeted edits to existing files, prefer str_replace_file instead (it's safer and more token-efficient). Maximum file size: 5 MB.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/write",
      bodyParams: ["path", "content", "createDirs"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path for the file to create/overwrite. Must be within allowed workspace roots.",
        },
        content: {
          type: "string",
          description: "The complete file content to write.",
        },
        createDirs: {
          type: "boolean",
          description:
            "Create parent directories if they don't exist (default: true).",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "str_replace_file",
    dataSource: compute("sandboxed fs"),
    description:
      "Perform a targeted string replacement in a file. Finds the exact 'oldStr' and replaces it with 'newStr'. The oldStr must match EXACTLY (including whitespace and indentation). This is the preferred method for editing existing files — it's safer than write_file because it can't accidentally overwrite the entire file, and it's more token-efficient. If multiple occurrences are found and allowMultiple is false, it returns an error asking you to provide more context for a unique match.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/str-replace",
      bodyParams: ["path", "oldStr", "newStr", "allowMultiple"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to edit.",
        },
        oldStr: {
          type: "string",
          description:
            "The exact string to find and replace. Must match the file content exactly, including whitespace, indentation, and line breaks. Include enough surrounding context to ensure a unique match.",
        },
        newStr: {
          type: "string",
          description:
            "The replacement string. This replaces the oldStr entirely.",
        },
        allowMultiple: {
          type: "boolean",
          description:
            "If true, replace ALL occurrences of oldStr. If false (default), error if multiple matches are found.",
        },
      },
      required: ["path", "oldStr", "newStr"],
    },
  },
  {
    name: "patch_file",
    dataSource: compute("sandboxed fs + diff"),
    description:
      "Apply a unified diff patch to a file. Useful for complex, multi-hunk edits where str_replace_file would require multiple calls. The patch must be in standard unified diff format (as produced by 'diff -u' or git). The file content must match the diff context lines for the patch to apply.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/patch",
      bodyParams: ["path", "patch"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to patch.",
        },
        patch: {
          type: "string",
          description:
            "A unified diff string (standard diff -u format). Must include @@ hunk headers and context lines that match the current file content.",
        },
      },
      required: ["path", "patch"],
    },
  },
  {
    name: "list_directory",
    dataSource: compute("sandboxed fs"),
    description:
      "List the contents of a directory, showing all files and subdirectories with metadata (name, size, type). Use this to explore project structure, find files, or understand codebase organization. Results are capped at 500 entries. Supports recursive listing with configurable depth.",
    endpoint: {
      method: "POST",
      path: "/agentic/directory/list",
      bodyParams: ["path", "recursive", "maxDepth"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the directory to list.",
        },
        recursive: {
          type: "boolean",
          description:
            "If true, list contents recursively (default: false). Use with maxDepth to control depth.",
        },
        maxDepth: {
          type: "integer",
          description:
            "Maximum recursion depth when recursive=true (default: 3, max: 5).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "grep_search",
    dataSource: compute("sandboxed fs"),
    description:
      "Search for a literal string or regex pattern across files in a directory. Returns matching lines with file paths and line numbers. Use this to find function definitions, usage patterns, imports, variable references, or any text across the codebase. Automatically skips node_modules, .git, and binary files. Results capped at 50 matches.",
    endpoint: {
      method: "POST",
      path: "/agentic/search/grep",
      bodyParams: ["pattern", "searchPath", "isRegex", "includes", "caseInsensitive", "matchPerLine"],
    },
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "The search pattern — a literal string or regex. Use isRegex=true for regex mode.",
        },
        searchPath: {
          type: "string",
          description:
            "Absolute path to search in (file or directory).",
        },
        isRegex: {
          type: "boolean",
          description:
            "If true, treat pattern as a regular expression. If false (default), treat as a literal string.",
        },
        includes: {
          type: "array",
          items: { type: "string" },
          description:
            "Glob patterns to filter files (e.g. ['*.js', '*.ts']). Only files matching these patterns will be searched.",
        },
        caseInsensitive: {
          type: "boolean",
          description: "If true, perform case-insensitive search (default: false).",
        },
        matchPerLine: {
          type: "boolean",
          description:
            "If true (default), return each matching line with file and line number. If false, return only the names of matching files.",
        },
      },
      required: ["pattern", "searchPath"],
    },
  },
  {
    name: "glob_files",
    dataSource: compute("sandboxed fs"),
    description:
      "Find files by name pattern using glob syntax. Supports *, **, and ? wildcards. Use this to find files by extension, naming convention, or path pattern. Automatically skips node_modules and .git. Results capped at 200 matches.",
    endpoint: {
      method: "POST",
      path: "/agentic/search/glob",
      bodyParams: ["pattern", "searchPath"],
    },
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match filenames (e.g. '*.test.js', '**/*.css', 'README*'). Supports * (any except /), ** (any including /), ? (single char).",
        },
        searchPath: {
          type: "string",
          description:
            "Absolute path to the root directory to search from.",
        },
      },
      required: ["pattern", "searchPath"],
    },
  },
  {
    name: "fetch_url",
    dataSource: onDemand("HTTP fetch"),
    description:
      "Fetch content from a URL via HTTP request. Automatically converts HTML pages to clean markdown, strips scripts/styles/navigation, and extracts the main content. JSON responses are returned formatted. Use this to read documentation, web pages, and API responses. Supports optional CSS selector to extract specific page sections. Maximum output: 100,000 characters.",
    endpoint: {
      method: "POST",
      path: "/agentic/web/fetch",
      bodyParams: ["url", "selector"],
    },
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch (must be http or https).",
        },
        selector: {
          type: "string",
          description:
            "Optional CSS selector to extract specific content from the page (e.g. 'article', '.main-content', '#docs'). If omitted, the tool automatically finds the main content area.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    dataSource: onDemand("Brave Search / Google CSE"),
    description:
      "Search the web using Brave Search (primary, whole-web) with Google Custom Search fallback. Returns results with titles, URLs, and snippets. Use this for researching topics, finding documentation, looking up current information, or verifying facts. Supports date filtering and site-specific search.",
    endpoint: {
      method: "POST",
      path: "/agentic/web/search",
      bodyParams: ["query", "limit", "dateRestrict", "siteSearch"],
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of results to return (default: 5, max: 10).",
        },
        dateRestrict: {
          type: "string",
          description: "Restrict results by age. Examples: 'd7' (past 7 days), 'w2' (past 2 weeks), 'm1' (past month), 'y1' (past year).",
        },
        siteSearch: {
          type: "string",
          description: "Restrict search to a specific domain (e.g. 'stackoverflow.com', 'developer.mozilla.org').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "multi_file_read",
    dataSource: compute("sandboxed fs"),
    description:
      "Read multiple files in a single call. Returns numbered lines for each file. Much more efficient than calling read_file multiple times — use this when you need to read 2-20 files for context (e.g. a component, its CSS module, and the service it imports). Each file supports optional line range selection. Maximum 20 files per batch, 800 lines per file.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/read-multi",
      bodyParams: ["files"],
    },
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Absolute path to the file." },
              startLine: { type: "integer", description: "Optional 1-indexed start line." },
              endLine: { type: "integer", description: "Optional 1-indexed end line." },
            },
            required: ["path"],
          },
          description: "Array of file read requests. Maximum 20 files.",
        },
      },
      required: ["files"],
    },
  },
  {
    name: "file_info",
    dataSource: compute("sandboxed fs"),
    description:
      "Get metadata about one or more files without reading their content. Returns: exists, isFile, isDirectory, sizeBytes, lines, lastModified, extension, isBinary. Use this to check if files exist, determine file sizes, or inspect metadata before deciding whether to read the full content. Supports batch queries (up to 20 paths).",
    endpoint: {
      method: "POST",
      path: "/agentic/file/info",
      bodyParams: ["path", "paths"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to inspect. Use this for a single file.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Array of absolute paths to inspect (max 20). Use this for batch queries instead of 'path'.",
        },
      },
      required: [],
    },
  },
  {
    name: "file_diff",
    dataSource: compute("sandboxed fs + diff"),
    description:
      "Generate a unified diff between two files, or between a file and provided content. Returns additions/deletions counts and the unified diff output. Use this to compare file versions, review changes before committing, or verify that edits had the intended effect.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/diff",
      bodyParams: ["pathA", "pathB", "content", "contextLines"],
    },
    parameters: {
      type: "object",
      properties: {
        pathA: {
          type: "string",
          description: "Absolute path to the first file (the 'old' side of the diff).",
        },
        pathB: {
          type: "string",
          description: "Absolute path to the second file (the 'new' side). Use this OR 'content', not both.",
        },
        content: {
          type: "string",
          description: "Content string to diff against pathA. Use this OR 'pathB', not both.",
        },
        contextLines: {
          type: "integer",
          description: "Number of context lines in the diff output (default: 3, max: 10).",
        },
      },
      required: ["pathA"],
    },
  },
  {
    name: "move_file",
    dataSource: compute("sandboxed fs"),
    description:
      "Move or rename a file within the allowed workspace. Parent directories at the destination are created automatically. The destination must not already exist. Use this for refactoring operations like renaming component files or reorganizing project structure.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/move",
      bodyParams: ["source", "destination", "createDirs"],
    },
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Absolute path of the file to move/rename.",
        },
        destination: {
          type: "string",
          description: "Absolute path of the new location/name.",
        },
        createDirs: {
          type: "boolean",
          description: "Create parent directories at destination if needed (default: true).",
        },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "delete_file",
    dataSource: compute("sandboxed fs"),
    description:
      "Delete a file from the allowed workspace. Only files can be deleted — directories are not supported for safety. Returns the file size that was deleted. Use this when cleaning up generated files or removing obsolete code.",
    endpoint: {
      method: "POST",
      path: "/agentic/file/delete",
      bodyParams: ["path"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path of the file to delete.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    dataSource: compute("sandboxed subprocess"),
    description:
      "Execute a project-scoped command in a sandboxed subprocess. Supports common development commands: npm, npx, node, git, eslint, prettier, tsc, python3, pip, and read-only filesystem tools (cat, ls, find, etc.). The working directory must be within the allowed workspace. Use this to run tests, lint code, build projects, check dependencies, or any development workflow. Timeout default: 60s, max: 120s.",
    endpoint: {
      method: "POST",
      path: "/agentic/command/run",
      bodyParams: ["command", "cwd", "timeout"],
    },
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to execute. Must start with an allowed binary (npm, npx, node, git, eslint, prettier, tsc, python3, pip, cat, ls, find, wc, diff, which, head, tail, tree, du, ps, lsof).",
        },
        cwd: {
          type: "string",
          description: "Absolute path of the working directory. Must be within allowed workspace roots.",
        },
        timeout: {
          type: "integer",
          description: "Timeout in milliseconds (default: 60000, max: 120000).",
        },
      },
      required: ["command", "cwd"],
    },
  },
  {
    name: "project_summary",
    dataSource: compute("fs scan"),
    description:
      "Scan a project directory and return structured metadata: package.json info (scripts, dependencies, frameworks), directory structure, entry points, config files, and README excerpt. Use this as the FIRST tool when starting work on a new project to understand its structure and technology stack in a single call, instead of multiple list_directory + read_file calls.",
    endpoint: {
      method: "POST",
      path: "/agentic/project/summary",
      bodyParams: ["path"],
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project root directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "git",
    dataSource: compute("git subprocess"),
    description:
      "Run git operations on a repository. Actions: 'status' (branch, staged/unstaged/untracked files), 'diff' (show changes — optionally staged, specific file, or against a ref), 'log' (commit history — filter by author, date, file).",
    endpoint: {
      method: "POST",
      path: "/agentic/git",
      bodyParams: ["action", "path", "staged", "file", "ref", "limit", "author", "since"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Git operation",
          enum: ["status", "diff", "log"],
        },
        path: { type: "string", description: "Absolute path to the repo root" },
        staged: { type: "boolean", description: "Show staged changes only (diff)" },
        file: { type: "string", description: "Specific file to diff or filter log" },
        ref: { type: "string", description: "Git ref to diff against" },
        limit: { type: "number", description: "Max commits (log, default: 10)" },
        author: { type: "string", description: "Filter by author (log)" },
        since: { type: "string", description: "Since date, e.g. '2 weeks ago' (log)" },
      },
      required: ["action", "path"],
    },
  },
  {

    name: "browser_action",
    dataSource: compute("headless Chromium (Playwright)"),
    description:
      "Control a headless Chromium browser for web automation, E2E testing, visual QA, and interacting with JavaScript-rendered pages that fetch_url cannot handle. Supports navigation, screenshots, clicking, typing, scrolling, JS evaluation, content extraction, element discovery, and waiting. Each call performs ONE action. The browser session persists between calls (same sessionId) so you can build multi-step flows: navigate → get_elements → click → type → screenshot. IMPORTANT: After navigating to a page, use 'get_elements' to discover available interactive elements and their CSS selectors before clicking or typing — never guess selectors. Sessions auto-close after 5 minutes of inactivity.",
    endpoint: {
      method: "POST",
      path: "/agentic/browser/action",
      bodyParams: ["action", "sessionId", "url", "selector", "text", "pressEnter", "fullPage", "direction", "amount", "expression", "format", "timeout", "state", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "The browser action to perform. One of: 'navigate' (go to URL), 'screenshot' (capture viewport), 'click' (click element), 'type' (enter text), 'scroll' (scroll page), 'evaluate' (run JS), 'get_content' (extract text/HTML), 'get_elements' (discover interactive elements with their CSS selectors — use this after navigating to find clickable/typeable elements), 'wait' (wait for element/time), 'close' (end session).",
          enum: ["navigate", "screenshot", "click", "type", "scroll", "evaluate", "get_content", "get_elements", "wait", "close"],
        },
        sessionId: {
          type: "string",
          description:
            "Optional session identifier for reusing the same browser page across calls. Defaults to 'default'. Use distinct IDs for parallel browser tasks.",
        },
        url: {
          type: "string",
          description: "URL to navigate to (required for 'navigate' action).",
        },
        selector: {
          type: "string",
          description: "CSS selector targeting an element (used by 'click', 'type', 'screenshot', 'scroll', 'get_content', 'wait').",
        },
        text: {
          type: "string",
          description: "Text to type into the selected element (required for 'type' action).",
        },
        pressEnter: {
          type: "boolean",
          description: "If true, press Enter after typing (for 'type' action). Useful for submitting search forms.",
        },
        fullPage: {
          type: "boolean",
          description: "If true, capture the full scrollable page instead of just the viewport (for 'screenshot' action).",
        },
        direction: {
          type: "string",
          description: "Scroll direction: 'up' or 'down' (for 'scroll' action, default: 'down').",
        },
        amount: {
          type: "integer",
          description: "Pixels to scroll (for 'scroll' action, default: 500).",
        },
        expression: {
          type: "string",
          description: "JavaScript expression to evaluate in the page context (for 'evaluate' action). The return value is serialized to JSON.",
        },
        format: {
          type: "string",
          description: "Content format: 'text' (default) or 'html' (for 'get_content' action).",
        },
        timeout: {
          type: "integer",
          description: "Timeout in milliseconds (for 'wait' action, default: 10000, max: 30000).",
        },
        state: {
          type: "string",
          description: "Element state to wait for: 'visible' (default), 'hidden', 'attached', 'detached' (for 'wait' action).",
        },
        limit: {
          type: "integer",
          description: "Maximum number of elements to return (for 'get_elements' action, default: 50, max: 100).",
        },
      },
      required: ["action"],
    },
  },

  // ── Communication (Twilio) ────────────────────────────────
  {
    name: "send_sms",
    dataSource: onDemand("Twilio"),
    description:
      "Send an SMS text message to a phone number. The recipient must be in E.164 international format (e.g. +14155551234). " +
      "Returns the message SID, delivery status, and metadata. Message body is limited to 1,600 characters.",
    endpoint: { path: "/communication/sms/send", method: "POST" },
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Destination phone number in E.164 format (e.g. +14155551234)",
        },
        body: {
          type: "string",
          description: "The SMS message body text (max 1,600 characters)",
        },
        from: {
          type: "string",
          description: "Optional sender phone number in E.164 format. If omitted, uses the first available Twilio number on the account.",
        },
      },
      required: ["to", "body"],
    },
  },
  {
    name: "list_sms_messages",
    dataSource: onDemand("Twilio"),
    description:
      "List recent SMS messages sent and received on the Twilio account. " +
      "Can filter by sender or recipient phone number. Returns message SIDs, bodies, statuses, and timestamps.",
    endpoint: { path: "/communication/sms/messages", queryParams: ["to", "from", "limit"] },
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Filter by destination phone number (E.164 format)",
        },
        from: {
          type: "string",
          description: "Filter by sender phone number (E.164 format)",
        },
        limit: {
          type: "integer",
          description: "Maximum number of messages to return (default: 20, max: 100)",
        },
      },
    },
  },
  {
    name: "get_twilio_account",
    dataSource: onDemand("Twilio"),
    description:
      "Get Twilio account information including account SID, friendly name, status, " +
      "account type, balance, and currency. Useful for checking remaining credits.",
    endpoint: { path: "/communication/account" },
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "lookup_phone_number",
    dataSource: onDemand("Twilio Lookup v2"),
    description:
      "Look up detailed information about a phone number using Twilio Lookup API v2. " +
      "Returns the phone number's country code, national format, validity, carrier info, " +
      "and line type intelligence (mobile, landline, VoIP, etc.).",
    endpoint: { path: "/communication/lookup/:phone", pathParams: ["phone"] },
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Phone number to look up in E.164 format (e.g. +14155551234)",
        },
      },
      required: ["phone"],
    },
  },
  {
    name: "list_twilio_numbers",
    dataSource: onDemand("Twilio"),
    description:
      "List all phone numbers owned by the Twilio account. Returns phone number SIDs, " +
      "formatted numbers, friendly names, and capabilities (SMS, MMS, voice, fax).",
    endpoint: { path: "/communication/numbers" },
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

// ────────────────────────────────────────────────────────────
// Domain Taxonomy — groups tools by functional area
// ────────────────────────────────────────────────────────────

const TOOL_DOMAINS = {
  // Weather & Environment
  get_weather: "Weather & Environment",
  get_local_environment: "Weather & Environment",
  get_weather_forecast: "Weather & Environment",
  get_avalanche_forecast: "Weather & Environment",

  // Events
  get_events: "Events",

  // Markets & Commodities
  get_commodities: "Markets & Commodities",

  // Trends
  get_trends: "Trends",

  // Products
  search_products: "Products",
  get_trending_products: "Products",
  get_product_availability: "Products",
  check_product_availability: "Products",
  get_costco_us_products: "Products",
  get_costco_ca_products: "Products",

  // Finance
  get_stock_data: "Finance",
  get_macro_data: "Finance",
  get_market_news: "Finance",
  get_earnings_calendar: "Finance",

  // Knowledge
  lookup_book: "Knowledge",
  get_country_data: "Knowledge",
  get_element_data: "Knowledge",
  get_exoplanet_data: "Knowledge",
  get_anime: "Knowledge",
  define_word: "Knowledge",
  search_papers: "Knowledge",
  get_wikipedia_summary: "Knowledge",
  get_on_this_day: "Knowledge",
  list_development_indicators: "Knowledge",
  get_youtube_video: "Knowledge",
  get_web_content: "Knowledge",
  get_package_info: "Knowledge",
  read_pdf_url: "Knowledge",
  read_rss_feed: "Knowledge",

  // Movies & TV
  search_media: "Movies & TV",
  get_media_details: "Movies & TV",
  get_media_credits: "Movies & TV",
  get_trending_media: "Movies & TV",
  discover_media: "Movies & TV",
  get_media_genres: "Movies & TV",

  // Health
  rank_foods: "Health",
  search_drugs: "Health",
  get_drug_adverse_events: "Health",
  get_drug_recalls: "Health",
  search_usda_nutrition: "Health",
  rank_foods_by_nutrient: "Health",
  compare_food_nutrition: "Health",
  get_food_categories: "Health",
  get_nutrient_types: "Health",
  list_category_nutrients: "Health",
  search_foods_by_taxonomy: "Health",
  browse_food_taxonomy: "Health",
  list_drug_dosage_forms: "Health",
  search_gym_exercises: "Health",
  get_gym_exercise_categories: "Health",
  get_gym_exercise_by_id: "Health",

  // Transit
  get_next_bus: "Transit",
  get_transit_stop_info: "Transit",
  find_transit_stops_nearby: "Transit",
  get_transit_route_info: "Transit",

  // Utilities
  lookup_airport: "Utilities",
  precise_calculator: "Utilities",
  convert_currency: "Utilities",
  get_time_in_timezone: "Utilities",
  lookup_ip: "Utilities",
  search_nearby_places: "Utilities",
  search_places: "Utilities",
  generate_map: "Utilities",
  generate_chart: "Utilities",
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

  // Agentic — File Operations
  read_file: "Agentic: File Operations",
  write_file: "Agentic: File Operations",
  str_replace_file: "Agentic: File Operations",
  patch_file: "Agentic: File Operations",
  multi_file_read: "Agentic: File Operations",
  file_info: "Agentic: File Operations",
  file_diff: "Agentic: File Operations",
  move_file: "Agentic: File Operations",
  delete_file: "Agentic: File Operations",

  // Agentic — Search & Discovery
  list_directory: "Agentic: Search & Discovery",
  grep_search: "Agentic: Search & Discovery",
  glob_files: "Agentic: Search & Discovery",
  project_summary: "Agentic: Search & Discovery",

  // Agentic — Web
  fetch_url: "Agentic: Web",
  web_search: "Agentic: Web",

  // Agentic — Command Execution
  run_command: "Agentic: Command Execution",

  // Agentic — Git

  git: "Agentic: Git",
  // Agentic — Browser Automation
  browser_action: "Agentic: Browser",

  // Communication (Twilio)
  send_sms: "Communication",
  list_sms_messages: "Communication",
  get_twilio_account: "Communication",
  lookup_phone_number: "Communication",
  list_twilio_numbers: "Communication",
};

// ────────────────────────────────────────────────────────────
// API Key Gating — maps tools to required CONFIG keys
// ────────────────────────────────────────────────────────────
// Tools listed here will be excluded from schema responses
// when their required API keys are missing (falsy) in CONFIG.
// Tools NOT listed here are always available (public APIs,
// in-memory datasets, compute tools, scrapers, etc.).
// ────────────────────────────────────────────────────────────

import CONFIG from "../config.js";

const TOOL_REQUIRED_KEYS = {
  // Movies & TV (all require TMDb API key)
  search_movies: ["TMDB_API_KEY"],
  get_movie_details: ["TMDB_API_KEY"],
  get_movie_credits: ["TMDB_API_KEY"],
  get_trending_movies: ["TMDB_API_KEY"],
  discover_movies: ["TMDB_API_KEY"],
  get_movie_genres: ["TMDB_API_KEY"],
  search_tv_shows: ["TMDB_API_KEY"],
  get_tv_show_details: ["TMDB_API_KEY"],
  get_tv_show_credits: ["TMDB_API_KEY"],
  get_tv_season_details: ["TMDB_API_KEY"],
  get_trending_tv_shows: ["TMDB_API_KEY"],
  discover_tv_shows: ["TMDB_API_KEY"],
  get_tv_genres: ["TMDB_API_KEY"],

  // Finance — Finnhub
  get_stock_quote: ["FINNHUB_API_KEY"],
  get_company_profile: ["FINNHUB_API_KEY"],
  get_market_news: ["FINNHUB_API_KEY"],
  get_earnings_calendar: ["FINNHUB_API_KEY"],
  get_stock_recommendation: ["FINNHUB_API_KEY"],
  get_stock_financials: ["FINNHUB_API_KEY"],

  // Finance — FRED
  get_macro_indicators: ["FRED_API_KEY"],
  search_macro_series: ["FRED_API_KEY"],
  get_macro_series_info: ["FRED_API_KEY"],
  get_macro_observations: ["FRED_API_KEY"],

  // Transit (all require TransLink API key)
  get_next_bus: ["TRANSLINK_API_KEY"],
  get_transit_stop_info: ["TRANSLINK_API_KEY"],
  find_transit_stops_nearby: ["TRANSLINK_API_KEY"],
  get_transit_route_info: ["TRANSLINK_API_KEY"],

  // Places (require Google Places API key)
  search_nearby_places: ["GOOGLE_PLACES_API_KEY"],
  search_places: ["GOOGLE_PLACES_API_KEY"],
  generate_map: ["GOOGLE_API_KEY"],

  // Weather (only specific Google-powered tools)
  get_google_air_quality: ["GOOGLE_API_KEY"],
  get_pollen: ["GOOGLE_API_KEY"],

  // Maritime (all require AIS Stream API key)
  get_tracked_vessels: ["AIS_STREAM_API_KEY"],
  get_vessel_by_mmsi: ["AIS_STREAM_API_KEY"],
  search_vessels: ["AIS_STREAM_API_KEY"],
  get_vessels_in_area: ["AIS_STREAM_API_KEY"],
  get_ais_messages: ["AIS_STREAM_API_KEY"],

  // Energy (all require EIA API key)
  get_energy_indicators: ["EIA_API_KEY"],
  browse_energy_data: ["EIA_API_KEY"],
  get_energy_facets: ["EIA_API_KEY"],
  query_energy_data: ["EIA_API_KEY"],
  get_electricity_retail_sales: ["EIA_API_KEY"],
  get_petroleum_prices: ["EIA_API_KEY"],
  get_natural_gas_prices: ["EIA_API_KEY"],

  // Web Search (Brave primary — whole-web; Google CSE fallback — site-restricted)
  web_search: ["BRAVE_SEARCH_API_KEY"],

  // Communication (Twilio — all require account SID + auth token)
  send_sms: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  list_sms_messages: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  get_twilio_account: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  lookup_phone_number: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  list_twilio_numbers: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
};

/**
 * Check if a tool is available based on its required API keys.
 * Returns true if the tool has no required keys or all keys are configured.
 */
function isToolAvailable(toolName) {
  const keys = TOOL_REQUIRED_KEYS[toolName];
  if (!keys) return true;
  return keys.every((key) => Boolean(CONFIG[key]));
}

// ────────────────────────────────────────────────────────────
// Tool Labels — multi-value categorization for filtering
// ────────────────────────────────────────────────────────────
// Labels are orthogonal to domains. A tool can have multiple
// labels (e.g. ["coding", "web"]). Consumers can filter tools
// by label to surface relevant capabilities per context.
// ────────────────────────────────────────────────────────────

const TOOL_LABELS = {
  get_weather: ["location"],
  get_local_environment: ["location"],
  rank_foods: ["health"],
  search_drugs: ["health"],
  search_media: ["media"],
  get_media_details: ["media"],
  get_media_credits: ["media"],
  get_trending_media: ["media"],
  discover_media: ["media"],
  get_media_genres: ["media"],
  git: ["coding"],
  lookup_book: ["reference"],
  get_country_data: ["reference"],
  get_element_data: ["reference"],
  get_exoplanet_data: ["reference"],
  lookup_airport: ["location"],
  get_events: ["location"],
  get_trends: ["web"],
  get_anime: ["media"],
  get_commodities: ["finance"],
  get_stock_data: ["finance"],
  get_macro_data: ["finance"],
  // ── Weather & Environment ───────────────────────────────
  get_weather_forecast: ["location"],
  get_weather_history: ["location"],
  get_weather_marine: ["location"],
  get_weather_astronomy: ["location"],
  get_weather_alerts: ["location"],
  get_avalanche_forecast: ["location"],

  // ── Sports ───────────────────────────────────────────────
  get_live_scores: ["sports"],
  get_upcoming_matches: ["sports"],
  get_recent_results: ["sports"],
  get_league_standings: ["sports"],
  get_match_details: ["sports"],
  get_head_to_head: ["sports"],
  search_teams: ["sports"],
  search_players: ["sports"],
  get_team_squad: ["sports"],
  get_league_top_scorers: ["sports"],

  // ── Events ───────────────────────────────────────────────

  // ── Markets & Commodities ────────────────────────────────

  // ── Trends ───────────────────────────────────────────────

  // ── Products ─────────────────────────────────────────────
  search_products: ["shopping"],
  get_trending_products: ["shopping"],
  get_product_availability: ["shopping"],
  check_product_availability: ["shopping"],
  get_costco_us_products: ["shopping"],
  get_costco_ca_products: ["shopping"],

  // ── Finance ──────────────────────────────────────────────
  get_market_news: ["finance"],
  get_earnings_calendar: ["finance"],

  // ── Knowledge ────────────────────────────────────────────
  define_word: ["reference"],
  search_papers: ["reference", "coding"],
  get_youtube_video: ["web"],
  get_web_content: ["web", "coding"],
  get_package_info: ["coding"],
  read_pdf_url: ["web"],
  read_rss_feed: ["web"],
  get_wikipedia_summary: ["reference"],
  get_on_this_day: ["reference"],
  list_development_indicators: ["reference"],

  // ── Movies & TV ──────────────────────────────────────────

  // ── Health ───────────────────────────────────────────────
  get_drug_adverse_events: ["health"],
  get_drug_recalls: ["health"],
  search_gym_exercises: ["health"],
  get_gym_exercise_categories: ["health"],
  get_gym_exercise_by_id: ["health"],
  search_usda_nutrition: ["health"],
  rank_foods_by_nutrient: ["health"],
  compare_food_nutrition: ["health"],
  get_food_categories: ["health"],
  get_nutrient_types: ["health"],
  list_category_nutrients: ["health"],
  search_foods_by_taxonomy: ["health"],
  browse_food_taxonomy: ["health"],
  list_drug_dosage_forms: ["health"],

  // ── Transit ──────────────────────────────────────────────
  get_next_bus: ["location"],
  get_transit_stop_info: ["location"],
  find_transit_stops_nearby: ["location"],
  get_transit_route_info: ["location"],

  // ── Utilities ────────────────────────────────────────────
  execute_python: ["coding", "data"],
  precise_calculator: ["data"],
  convert_currency: ["finance", "data"],
  get_time_in_timezone: ["data"],
  lookup_ip: ["data"],
  search_nearby_places: ["location"],
  search_places: ["location"],
  generate_map: ["location"],
  generate_chart: ["data"],
  get_public_webcams: ["location"],

  // ── Compute ──────────────────────────────────────────────
  execute_javascript: ["coding", "data"],
  execute_shell: ["coding"],
  convert_units: ["data"],
  parse_datetime: ["data"],
  transform_json: ["coding", "data"],
  generate_csv: ["data"],
  generate_qr_code: ["data"],
  render_latex: ["data"],
  generate_diagram: ["data"],
  diff_text: ["coding", "data"],
  generate_hash: ["coding", "data"],
  regex_tester: ["coding"],
  encode_decode: ["coding", "data"],
  convert_color: ["data"],

  // ── Maritime ─────────────────────────────────────────────
  get_tracked_vessels: ["maritime"],
  get_vessel_by_mmsi: ["maritime"],
  search_vessels: ["maritime"],
  get_vessels_in_area: ["maritime"],
  get_ais_messages: ["maritime"],

  // ── Energy ───────────────────────────────────────────────
  get_energy_indicators: ["energy"],
  browse_energy_data: ["energy"],
  get_energy_facets: ["energy"],
  query_energy_data: ["energy"],
  get_electricity_retail_sales: ["energy"],
  get_petroleum_prices: ["energy"],
  get_natural_gas_prices: ["energy"],

  // ── Agentic: File Operations ─────────────────────────────
  read_file: ["coding"],
  write_file: ["coding"],
  str_replace_file: ["coding"],
  patch_file: ["coding"],
  multi_file_read: ["coding"],
  file_info: ["coding"],
  file_diff: ["coding"],
  move_file: ["coding"],
  delete_file: ["coding"],

  // ── Agentic: Search & Discovery ──────────────────────────
  list_directory: ["coding"],
  grep_search: ["coding"],
  glob_files: ["coding"],
  project_summary: ["coding"],

  // ── Agentic: Web ─────────────────────────────────────────
  fetch_url: ["web"],
  web_search: ["web"],

  // ── Agentic: Command Execution ───────────────────────────
  run_command: ["coding"],

  // ── Agentic: Git ─────────────────────────────────────────

  // ── Agentic: Browser ─────────────────────────────────────
  browser_action: ["web"],

  // ── Communication ────────────────────────────────────────
  send_sms: ["communication"],
  list_sms_messages: ["communication"],
  get_twilio_account: ["communication"],
  lookup_phone_number: ["communication"],
  list_twilio_numbers: ["communication"],
};

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Get all tool schemas with endpoint metadata.
 * Used by clients (like Retina) to build dynamic executors.
 * Filters out tools whose required API keys are not configured.
 * @returns {Array} Full tool definitions including endpoint info
 */
export function getToolSchemas() {
  return TOOL_DEFINITIONS
    .filter((t) => isToolAvailable(t.name))
    .map((t) => ({
      ...t,
      domain: TOOL_DOMAINS[t.name] || "Other",
      labels: TOOL_LABELS[t.name] || [],
    }));
}

/**
 * Get tool schemas cleaned for LLM consumption.
 * Strips the `endpoint` property since the AI doesn't need routing info.
 * Filters out tools whose required API keys are not configured.
 * @returns {Array} Tool definitions without endpoint metadata
 */
export function getToolSchemasForAI() {
  return TOOL_DEFINITIONS
    .filter((t) => isToolAvailable(t.name))
    .map(
      ({ endpoint: _endpoint, dataSource: _dataSource, ...rest }) => rest,
    );
}

/**
 * Get tools that are disabled due to missing API keys.
 * Useful for admin diagnostics and health checks.
 * @returns {Array<{ name: string, domain: string, missingKeys: string[] }>}
 */
export function getDisabledTools() {
  return TOOL_DEFINITIONS
    .filter((t) => !isToolAvailable(t.name))
    .map((t) => {
      const requiredKeys = TOOL_REQUIRED_KEYS[t.name] || [];
      return {
        name: t.name,
        domain: TOOL_DOMAINS[t.name] || "Other",
        missingKeys: requiredKeys.filter((key) => !CONFIG[key]),
      };
    });
}

/**
 * Get the available fields map.
 * @returns {object} FIELDS enum map
 */
export function getFields() {
  return FIELDS;
}

