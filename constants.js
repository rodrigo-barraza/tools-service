// ============================================================
// Tools API — Unified Constants
// ============================================================
// Merged from event-api, market-api, product-api, trend-api, weather-api.
// ============================================================

// ═══════════════════════════════════════════════════════════════
//  EVENT DOMAIN
// ═══════════════════════════════════════════════════════════════

// Fetch intervals
export const TICKETMASTER_INTERVAL_MS = 3_600_000; // 1 hour
export const SEATGEEK_INTERVAL_MS = 3_600_000; // 1 hour
export const CRAIGSLIST_INTERVAL_MS = 3_600_000; // 1 hour
export const UNIVERSITY_INTERVAL_MS = 7_200_000; // 2 hours
export const CITY_OF_VANCOUVER_INTERVAL_MS = 7_200_000; // 2 hours
export const SPORTS_INTERVAL_MS = 3_600_000; // 1 hour
export const MOVIE_INTERVAL_MS = 14_400_000; // 4 hours
export const GOOGLE_PLACES_INTERVAL_MS = 86_400_000; // 24 hours

// Event sources
export const EVENT_SOURCES = {
  TICKETMASTER: "ticketmaster",
  SEATGEEK: "seatgeek",
  CRAIGSLIST: "craigslist",
  UBC: "ubc",
  SFU: "sfu",
  CITY_OF_VANCOUVER: "city_of_vancouver",
  NHL: "nhl",
  WHITECAPS: "whitecaps",
  BC_LIONS: "bc_lions",
  TMDB: "tmdb",
  GOOGLE_PLACES: "google_places",
};

// Normalized event categories
export const EVENT_CATEGORIES = {
  MUSIC: "music",
  SPORTS: "sports",
  ARTS: "arts",
  COMEDY: "comedy",
  FAMILY: "family",
  FILM: "film",
  FOOD: "food",
  TECH: "tech",
  OTHER: "other",
};

// Ticketmaster segment → normalized category mapping
export const TICKETMASTER_CATEGORY_MAP = {
  Music: EVENT_CATEGORIES.MUSIC,
  Sports: EVENT_CATEGORIES.SPORTS,
  "Arts & Theatre": EVENT_CATEGORIES.ARTS,
  Film: EVENT_CATEGORIES.FILM,
  Miscellaneous: EVENT_CATEGORIES.OTHER,
  Undefined: EVENT_CATEGORIES.OTHER,
};

// SeatGeek taxonomy → normalized category mapping
export const SEATGEEK_CATEGORY_MAP = {
  concert: EVENT_CATEGORIES.MUSIC,
  sports: EVENT_CATEGORIES.SPORTS,
  theater: EVENT_CATEGORIES.ARTS,
  comedy: EVENT_CATEGORIES.COMEDY,
  film: EVENT_CATEGORIES.FILM,
  family: EVENT_CATEGORIES.FAMILY,
  literary: EVENT_CATEGORIES.ARTS,
  dance_performance_tour: EVENT_CATEGORIES.ARTS,
  classical: EVENT_CATEGORIES.MUSIC,
  broadway_tickets_national: EVENT_CATEGORIES.ARTS,
};

// Event status values
export const EVENT_STATUSES = {
  ON_SALE: "onsale",
  OFF_SALE: "offsale",
  CANCELLED: "cancelled",
  POSTPONED: "postponed",
  RESCHEDULED: "rescheduled",
};

// ═══════════════════════════════════════════════════════════════
//  MARKET DOMAIN
// ═══════════════════════════════════════════════════════════════

export const ASSET_CATEGORIES = {
  ENERGY: "energy",
  PRECIOUS_METALS: "precious_metals",
  INDUSTRIAL_METALS: "industrial_metals",
  AGRICULTURE: "agriculture",
  SOFTS: "softs",
  LIVESTOCK: "livestock",
  LUMBER: "lumber",
  INDEX_FUTURES: "index_futures",
  INDICES: "indices",
  BONDS: "bonds",
  FOREX: "forex",
  CRYPTO: "crypto",
  VOLATILITY: "volatility",
};

export const COMMODITY_TICKERS = {
  // Energy
  "CL=F": {
    name: "Crude Oil WTI",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/barrel",
  },
  "BZ=F": {
    name: "Brent Crude",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/barrel",
  },
  "NG=F": {
    name: "Natural Gas",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/MMBtu",
  },
  "HO=F": {
    name: "Heating Oil",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/gallon",
  },
  "RB=F": {
    name: "Gasoline (RBOB)",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/gallon",
  },
  "QM=F": {
    name: "E-mini Crude Oil",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/barrel",
  },
  "EH=F": {
    name: "Ethanol",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/gallon",
  },
  "MTF=F": {
    name: "Micro WTI Crude Oil",
    category: ASSET_CATEGORIES.ENERGY,
    unit: "USD/barrel",
  },
  // Precious Metals
  "GC=F": {
    name: "Gold",
    category: ASSET_CATEGORIES.PRECIOUS_METALS,
    unit: "USD/oz",
  },
  "SI=F": {
    name: "Silver",
    category: ASSET_CATEGORIES.PRECIOUS_METALS,
    unit: "USD/oz",
  },
  "PL=F": {
    name: "Platinum",
    category: ASSET_CATEGORIES.PRECIOUS_METALS,
    unit: "USD/oz",
  },
  "PA=F": {
    name: "Palladium",
    category: ASSET_CATEGORIES.PRECIOUS_METALS,
    unit: "USD/oz",
  },
  "MGC=F": {
    name: "Micro Gold",
    category: ASSET_CATEGORIES.PRECIOUS_METALS,
    unit: "USD/oz",
  },
  "SIL=F": {
    name: "Micro Silver",
    category: ASSET_CATEGORIES.PRECIOUS_METALS,
    unit: "USD/oz",
  },
  // Industrial Metals
  "HG=F": {
    name: "Copper",
    category: ASSET_CATEGORIES.INDUSTRIAL_METALS,
    unit: "USD/lb",
  },
  "ALI=F": {
    name: "Aluminum",
    category: ASSET_CATEGORIES.INDUSTRIAL_METALS,
    unit: "USD/ton",
  },
  // Agriculture
  "ZC=F": {
    name: "Corn",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USc/bushel",
  },
  "ZW=F": {
    name: "Wheat (SRW)",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USc/bushel",
  },
  "KE=F": {
    name: "Wheat (HRW)",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USc/bushel",
  },
  "ZS=F": {
    name: "Soybeans",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USc/bushel",
  },
  "ZL=F": {
    name: "Soybean Oil",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USc/lb",
  },
  "ZM=F": {
    name: "Soybean Meal",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USD/ton",
  },
  "ZO=F": {
    name: "Oats",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USc/bushel",
  },
  "ZR=F": {
    name: "Rough Rice",
    category: ASSET_CATEGORIES.AGRICULTURE,
    unit: "USD/cwt",
  },
  // Softs
  "KC=F": { name: "Coffee", category: ASSET_CATEGORIES.SOFTS, unit: "USc/lb" },
  "CT=F": { name: "Cotton", category: ASSET_CATEGORIES.SOFTS, unit: "USc/lb" },
  "SB=F": {
    name: "Sugar #11",
    category: ASSET_CATEGORIES.SOFTS,
    unit: "USc/lb",
  },
  "CC=F": { name: "Cocoa", category: ASSET_CATEGORIES.SOFTS, unit: "USD/ton" },
  "OJ=F": {
    name: "Orange Juice",
    category: ASSET_CATEGORIES.SOFTS,
    unit: "USc/lb",
  },
  "DC=F": {
    name: "Milk (Class III)",
    category: ASSET_CATEGORIES.SOFTS,
    unit: "USD/cwt",
  },
  // Livestock
  "LE=F": {
    name: "Live Cattle",
    category: ASSET_CATEGORIES.LIVESTOCK,
    unit: "USc/lb",
  },
  "HE=F": {
    name: "Lean Hogs",
    category: ASSET_CATEGORIES.LIVESTOCK,
    unit: "USc/lb",
  },
  "GF=F": {
    name: "Feeder Cattle",
    category: ASSET_CATEGORIES.LIVESTOCK,
    unit: "USc/lb",
  },
  // Lumber
  "LBS=F": {
    name: "Lumber",
    category: ASSET_CATEGORIES.LUMBER,
    unit: "USD/1000 board feet",
  },
  // Index Futures
  "ES=F": {
    name: "S&P 500 E-mini",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "NQ=F": {
    name: "Nasdaq 100 E-mini",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "YM=F": {
    name: "Dow Jones E-mini",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "RTY=F": {
    name: "Russell 2000 E-mini",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "NKD=F": {
    name: "Nikkei 225",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "FTSEMIB.MI": {
    name: "FTSE MIB",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "MES=F": {
    name: "Micro S&P 500",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "MNQ=F": {
    name: "Micro Nasdaq 100",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "MYM=F": {
    name: "Micro Dow Jones",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  "M2K=F": {
    name: "Micro Russell 2000",
    category: ASSET_CATEGORIES.INDEX_FUTURES,
    unit: "points",
  },
  // Indices (spot)
  "^GSPC": {
    name: "S&P 500",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^DJI": {
    name: "Dow Jones Industrial",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^IXIC": {
    name: "Nasdaq Composite",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^RUT": {
    name: "Russell 2000",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^GSPTSE": {
    name: "S&P/TSX Composite",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^FTSE": {
    name: "FTSE 100",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^GDAXI": { name: "DAX", category: ASSET_CATEGORIES.INDICES, unit: "points" },
  "^FCHI": {
    name: "CAC 40",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^N225": {
    name: "Nikkei 225",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^HSI": {
    name: "Hang Seng",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "000001.SS": {
    name: "Shanghai Composite",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^STOXX50E": {
    name: "Euro Stoxx 50",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^BSESN": {
    name: "BSE Sensex",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^BVSP": {
    name: "Bovespa",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^AORD": {
    name: "ASX All Ordinaries",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  "^KS11": {
    name: "KOSPI",
    category: ASSET_CATEGORIES.INDICES,
    unit: "points",
  },
  // Bonds
  "ZB=F": {
    name: "30-Year Treasury Bond",
    category: ASSET_CATEGORIES.BONDS,
    unit: "points",
  },
  "ZN=F": {
    name: "10-Year Treasury Note",
    category: ASSET_CATEGORIES.BONDS,
    unit: "points",
  },
  "ZF=F": {
    name: "5-Year Treasury Note",
    category: ASSET_CATEGORIES.BONDS,
    unit: "points",
  },
  "ZT=F": {
    name: "2-Year Treasury Note",
    category: ASSET_CATEGORIES.BONDS,
    unit: "points",
  },
  "^TNX": {
    name: "10-Year Yield",
    category: ASSET_CATEGORIES.BONDS,
    unit: "%",
  },
  "^TYX": {
    name: "30-Year Yield",
    category: ASSET_CATEGORIES.BONDS,
    unit: "%",
  },
  "^FVX": { name: "5-Year Yield", category: ASSET_CATEGORIES.BONDS, unit: "%" },
  "^IRX": {
    name: "13-Week T-Bill",
    category: ASSET_CATEGORIES.BONDS,
    unit: "%",
  },
  // Forex
  "DX-Y.NYB": {
    name: "US Dollar Index",
    category: ASSET_CATEGORIES.FOREX,
    unit: "index",
  },
  "EURUSD=X": {
    name: "EUR/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "GBPUSD=X": {
    name: "GBP/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "JPY=X": { name: "USD/JPY", category: ASSET_CATEGORIES.FOREX, unit: "rate" },
  "AUDUSD=X": {
    name: "AUD/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "NZDUSD=X": {
    name: "NZD/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "CADUSD=X": {
    name: "CAD/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "CHFUSD=X": {
    name: "CHF/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "CNYUSD=X": {
    name: "CNY/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "SEKUSD=X": {
    name: "SEK/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "NOKUSD=X": {
    name: "NOK/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "MXNUSD=X": {
    name: "MXN/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "SGDUSD=X": {
    name: "SGD/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "HKDUSD=X": {
    name: "HKD/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "KRWUSD=X": {
    name: "KRW/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "TRYUSD=X": {
    name: "TRY/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "INRUSD=X": {
    name: "INR/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "BRLUSD=X": {
    name: "BRL/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "ZARUSD=X": {
    name: "ZAR/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "PLNUSD=X": {
    name: "PLN/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "THBUSD=X": {
    name: "THB/USD",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "EURGBP=X": {
    name: "EUR/GBP",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "EURJPY=X": {
    name: "EUR/JPY",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "GBPJPY=X": {
    name: "GBP/JPY",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  "AUDJPY=X": {
    name: "AUD/JPY",
    category: ASSET_CATEGORIES.FOREX,
    unit: "rate",
  },
  // Crypto
  "BTC-USD": {
    name: "Bitcoin",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "ETH-USD": {
    name: "Ethereum",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "BNB-USD": { name: "BNB", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "SOL-USD": { name: "Solana", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "XRP-USD": { name: "XRP", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "ADA-USD": {
    name: "Cardano",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "DOGE-USD": {
    name: "Dogecoin",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "AVAX-USD": {
    name: "Avalanche",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "DOT-USD": {
    name: "Polkadot",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "MATIC-USD": {
    name: "Polygon",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "LINK-USD": {
    name: "Chainlink",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "UNI-USD": {
    name: "Uniswap",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "LTC-USD": {
    name: "Litecoin",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "ATOM-USD": {
    name: "Cosmos",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "XLM-USD": {
    name: "Stellar",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "NEAR-USD": {
    name: "NEAR Protocol",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "APT-USD": { name: "Aptos", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "SUI-USD": { name: "Sui", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "ARB-USD": {
    name: "Arbitrum",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "OP-USD": {
    name: "Optimism",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "FIL-USD": {
    name: "Filecoin",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "AAVE-USD": { name: "Aave", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "ALGO-USD": {
    name: "Algorand",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "ETC-USD": {
    name: "Ethereum Classic",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "RENDER-USD": {
    name: "Render",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "FET-USD": {
    name: "Fetch.ai",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "TRX-USD": { name: "Tron", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  "SHIB-USD": {
    name: "Shiba Inu",
    category: ASSET_CATEGORIES.CRYPTO,
    unit: "USD",
  },
  "PEPE-USD": { name: "Pepe", category: ASSET_CATEGORIES.CRYPTO, unit: "USD" },
  // Volatility
  "^VIX": {
    name: "CBOE Volatility Index",
    category: ASSET_CATEGORIES.VOLATILITY,
    unit: "index",
  },
  "^VVIX": {
    name: "VIX of VIX",
    category: ASSET_CATEGORIES.VOLATILITY,
    unit: "index",
  },
};

export const COMMODITIES_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
export const SNAPSHOT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// ═══════════════════════════════════════════════════════════════
//  PRODUCT DOMAIN
// ═══════════════════════════════════════════════════════════════

export const BESTBUY_INTERVAL_MS = 1_800_000; // 30 minutes
export const AMAZON_INTERVAL_MS = 7_200_000; // 2 hours
export const PRODUCTHUNT_PRODUCT_INTERVAL_MS = 3_600_000; // 1 hour
export const EBAY_INTERVAL_MS = 3_600_000; // 1 hour
export const ETSY_INTERVAL_MS = 3_600_000; // 1 hour
export const COSTCO_INTERVAL_MS = 7_200_000; // 2 hours
export const COSTCO_MAX_PRODUCTS_PER_CATEGORY = 24; // Costco shows 24 per page

// Best Buy Canada — stock availability checker (public ecomm-api, no key required)
export const BESTBUY_CA_AVAILABILITY_INTERVAL_MS = 300_000; // 5 minutes
export const BESTBUY_CA_AVAILABILITY_BASE_URL =
  "https://www.bestbuy.ca/ecomm-api/availability/products";
export const BESTBUY_CA_MAX_SKUS_PER_REQUEST = 100;
export const BESTBUY_CA_REQUEST_DELAY_MS = 2_000; // 2 seconds between batches
export const BESTBUY_CA_DEFAULT_SKUS = {
  // ─── GPUs (Current Gen — RTX 50 Series) ──────────────────────────
  18931348: {
    name: "GeForce RTX 5090 32GB FE",
    brand: "NVIDIA",
    category: "gpu",
  },
  18931347: {
    name: "GeForce RTX 5080 16GB FE",
    brand: "NVIDIA",
    category: "gpu",
  },
  18934178: { name: "GeForce RTX 5080 16GB", brand: "PNY", category: "gpu" },
  18931628: {
    name: "GeForce RTX 5080 Solid 16GB",
    brand: "ZOTAC",
    category: "gpu",
  },
  19193219: {
    name: "GeForce RTX 5070 12GB FE",
    brand: "NVIDIA",
    category: "gpu",
  },
  18934180: {
    name: "GeForce RTX 5070 Ti OC 16GB",
    brand: "PNY",
    category: "gpu",
  },
  18934179: {
    name: "GeForce RTX 5070 Ti ARGB 16GB",
    brand: "PNY",
    category: "gpu",
  },
  19183867: {
    name: "GeForce RTX 5070 Ti Ventus 3X OC",
    brand: "MSI",
    category: "gpu",
  },
  6632193: {
    name: "GeForce RTX 5060 8GB PRIME",
    brand: "ASUS",
    category: "gpu",
  },

  // ─── GPUs (Previous Gen) ─────────────────────────────────────────
  6548653: {
    name: "GeForce RTX 4060 Ventus 2X OC 8GB",
    brand: "MSI",
    category: "gpu",
  },
  6562422: { name: "GeForce RTX 4060 OC 8GB", brand: "PNY", category: "gpu" },
  6528730: {
    name: "Radeon RX 7900 XTX 24GB",
    brand: "Gigabyte",
    category: "gpu",
  },

  // ─── CPUs ────────────────────────────────────────────────────────
  12339550: { name: "Ryzen 9 9950X 16-Core", brand: "AMD", category: "cpu" },
  6602200: {
    name: "Core Ultra 9 285K 24-Core",
    brand: "Intel",
    category: "cpu",
  },

  // ─── Consoles ────────────────────────────────────────────────────
  11028232: {
    name: "PlayStation 5 Pro Console",
    brand: "Sony",
    category: "console",
  },
  17477495: {
    name: "PlayStation 5 Slim Digital Edition",
    brand: "Sony",
    category: "console",
  },
  19422128: {
    name: "Xbox Series X 1TB Console",
    brand: "Microsoft",
    category: "console",
  },

  // ─── Phones ──────────────────────────────────────────────────────
  18925575: {
    name: "Galaxy S25 Ultra 256GB Titanium Black",
    brand: "Samsung",
    category: "phone",
  },
  18925576: {
    name: "Galaxy S25 Ultra 256GB Titanium Grey",
    brand: "Samsung",
    category: "phone",
  },
  18925577: {
    name: "Galaxy S25 Ultra 256GB Titanium Silverblue",
    brand: "Samsung",
    category: "phone",
  },
  18925578: {
    name: "Galaxy S25 Ultra 256GB Titanium Silverwhite",
    brand: "Samsung",
    category: "phone",
  },
  18925580: {
    name: "Galaxy S25 Ultra 512GB Titanium Grey",
    brand: "Samsung",
    category: "phone",
  },
  17906300: {
    name: "Galaxy S24 128GB Onyx Black",
    brand: "Samsung",
    category: "phone",
  },
  19321527: {
    name: "Pixel 9 Pro XL 256GB Obsidian",
    brand: "Google",
    category: "phone",
  },
  17306965: { name: "Pixel 8 128GB Hazel", brand: "Google", category: "phone" },
  18911504: {
    name: "OnePlus 13 512GB Black Eclipse",
    brand: "OnePlus",
    category: "phone",
  },
  19659711: {
    name: "OnePlus 12R 256GB Iron Grey",
    brand: "OnePlus",
    category: "phone",
  },

  // ─── Laptops (Apple) ─────────────────────────────────────────────
  15952669: {
    name: 'MacBook Pro 16" M4 Max 36GB/1TB',
    brand: "Apple",
    category: "laptop",
  },
  18619913: {
    name: 'MacBook Pro 14" M4 Pro 24GB/512GB',
    brand: "Apple",
    category: "laptop",
  },
  18619927: {
    name: 'MacBook Pro 16" M4 Pro 24GB/512GB',
    brand: "Apple",
    category: "laptop",
  },
  16556743: {
    name: 'MacBook Air 13" M4 16GB/256GB Sky Blue',
    brand: "Apple",
    category: "laptop",
  },
  19205126: {
    name: 'MacBook Air 15" M4 24GB/512GB Silver',
    brand: "Apple",
    category: "laptop",
  },
  19205151: {
    name: 'MacBook Air 15" M4 16GB/256GB Midnight',
    brand: "Apple",
    category: "laptop",
  },
  19205116: {
    name: 'MacBook Air 13" M4 16GB/512GB Silver',
    brand: "Apple",
    category: "laptop",
  },
  19205135: {
    name: 'MacBook Air 15" M4 16GB/512GB Sky Blue',
    brand: "Apple",
    category: "laptop",
  },

  // ─── Laptops (Windows) ───────────────────────────────────────────
  19350687: {
    name: 'Galaxy Book4 Pro 16" AMOLED i7/16GB/1TB',
    brand: "Samsung",
    category: "laptop",
  },
  19186485: {
    name: 'Zenbook DUO 14" OLED Ultra 9/16GB/1TB',
    brand: "ASUS",
    category: "laptop",
  },
  17721198: {
    name: 'Swift Go 16" OLED Ultra 7/16GB/1TB',
    brand: "Acer",
    category: "laptop",
  },
  17862174: {
    name: 'Inspiron 16" Core 7/16GB/1TB',
    brand: "Dell",
    category: "laptop",
  },

  // ─── Tablets ─────────────────────────────────────────────────────
  17978053: {
    name: 'iPad Pro 13" M4 256GB Wi-Fi+5G',
    brand: "Apple",
    category: "tablet",
  },
  19204241: {
    name: 'iPad Air 11" M3 128GB Wi-Fi Space Grey',
    brand: "Apple",
    category: "tablet",
  },
  19204243: {
    name: 'iPad Air 11" M3 128GB Wi-Fi Blue',
    brand: "Apple",
    category: "tablet",
  },
  17933203: {
    name: 'iPad Air 11" 256GB Wi-Fi Blue (6th Gen)',
    brand: "Apple",
    category: "tablet",
  },
  17167495: {
    name: 'Galaxy Tab S9 11" 256GB',
    brand: "Samsung",
    category: "tablet",
  },

  // ─── Headphones ──────────────────────────────────────────────────
  16162187: {
    name: "WH-1000XM5 Over-Ear NC Black",
    brand: "Sony",
    category: "audio",
  },
  16162186: {
    name: "WH-1000XM5 Over-Ear NC Silver",
    brand: "Sony",
    category: "audio",
  },
  17543757: {
    name: "AirPods Pro 2nd Gen USB-C",
    brand: "Apple",
    category: "audio",
  },
  18885243: {
    name: "QuietComfort Ultra Earbuds White Smoke",
    brand: "Bose",
    category: "audio",
  },
  18189367: {
    name: "QuietComfort Ultra Over-Ear Lunar Blue",
    brand: "Bose",
    category: "audio",
  },

  // ─── Speakers ────────────────────────────────────────────────────
  19185706: {
    name: "Charge 5 Portable Bluetooth Speaker",
    brand: "JBL",
    category: "speaker",
  },
  16688928: {
    name: "Era 300 Spatial Audio Speaker Black",
    brand: "Sonos",
    category: "speaker",
  },
  17064533: {
    name: "Stanmore III Bluetooth Speaker Black",
    brand: "Marshall",
    category: "speaker",
  },
  17064532: {
    name: "Acton III Bluetooth Speaker Black",
    brand: "Marshall",
    category: "speaker",
  },

  // ─── Wearables ───────────────────────────────────────────────────
  18470943: {
    name: "Apple Watch Ultra 2 49mm Tan Alpine",
    brand: "Apple",
    category: "wearable",
  },
  19399851: {
    name: "Galaxy Watch Ultra 47mm LTE Silver",
    brand: "Samsung",
    category: "wearable",
  },
  18245819: {
    name: "fēnix 8 43mm Sapphire AMOLED",
    brand: "Garmin",
    category: "wearable",
  },
  18245812: {
    name: "fēnix 8 51mm Sapphire AMOLED Black",
    brand: "Garmin",
    category: "wearable",
  },

  // ─── VR ──────────────────────────────────────────────────────────
  18473493: { name: "Quest 3 512GB VR Headset", brand: "Meta", category: "vr" },
  17162202: { name: "Quest 3 128GB VR Headset", brand: "Meta", category: "vr" },

  // ─── Monitors ────────────────────────────────────────────────────
  10924894: {
    name: '32" Odyssey OLED G8 4K 240Hz',
    brand: "Samsung",
    category: "monitor",
  },

  // ─── TVs ─────────────────────────────────────────────────────────
  17921979: {
    name: 'C4 65" 4K OLED evo Smart TV (2024)',
    brand: "LG",
    category: "tv",
  },
  17921980: {
    name: 'C4 77" 4K OLED evo Smart TV (2024)',
    brand: "LG",
    category: "tv",
  },
  17729155: {
    name: 'S95D 65" 4K OLED Smart TV (2024)',
    brand: "Samsung",
    category: "tv",
  },
  17230339: {
    name: 'A95L 65" 4K QD-OLED Smart TV',
    brand: "Sony",
    category: "tv",
  },
  17230341: {
    name: 'A95L 77" 4K QD-OLED Smart TV',
    brand: "Sony",
    category: "tv",
  },

  // ─── Cameras & Drones ────────────────────────────────────────────
  18622226: {
    name: "HERO13 Black Essential Bundle",
    brand: "GoPro",
    category: "camera",
  },
  19741372: {
    name: "Mini 4 Pro Drone with RC2",
    brand: "DJI",
    category: "drone",
  },
  19457080: {
    name: "Mavic 3 Cine Premium Combo",
    brand: "DJI",
    category: "drone",
  },

  // ─── E-Readers ───────────────────────────────────────────────────
  18596809: {
    name: 'Kindle Scribe 16GB 10.2"',
    brand: "Amazon",
    category: "e-reader",
  },
  18596812: {
    name: 'Kindle Scribe 32GB 10.2"',
    brand: "Amazon",
    category: "e-reader",
  },
  19377032: {
    name: "reMarkable 2 Paper Tablet + Marker Plus",
    brand: "reMarkable",
    category: "e-reader",
  },

  // ─── Home & Appliances ───────────────────────────────────────────
  17183862: {
    name: "V15 Detect Cordless Stick Vacuum",
    brand: "Dyson",
    category: "appliance",
  },

  // ─── Gaming Accessories ──────────────────────────────────────────
  17668451: {
    name: "DualSense Wireless Controller White",
    brand: "Sony",
    category: "gaming-accessory",
  },
  16571772: {
    name: "DualSense Edge Wireless Controller",
    brand: "Sony",
    category: "gaming-accessory",
  },
  13702316: {
    name: "Elite Series 2 Wireless Controller Black",
    brand: "Xbox",
    category: "gaming-accessory",
  },
};

export const PRODUCT_CATEGORIES = {
  ELECTRONICS: "electronics",
  COMPUTERS: "computers",
  PHONES: "phones",
  TV_HOME_THEATER: "tv-home-theater",
  AUDIO: "audio",
  GAMING: "gaming",
  CAMERAS: "cameras",
  HOME: "home",
  KITCHEN: "kitchen",
  APPLIANCES: "appliances",
  FASHION: "fashion",
  BEAUTY: "beauty",
  SPORTS: "sports",
  TOYS: "toys",
  BOOKS: "books",
  AUTOMOTIVE: "automotive",
  OFFICE: "office",
  SOFTWARE: "software",
  TECH: "tech",
  OTHER: "other",
};

export const BESTBUY_CATEGORIES = [
  {
    id: "abcat0100000",
    name: "TV & Home Theater",
    unified: PRODUCT_CATEGORIES.TV_HOME_THEATER,
  },
  { id: "abcat0200000", name: "Audio", unified: PRODUCT_CATEGORIES.AUDIO },
  {
    id: "abcat0400000",
    name: "Cameras & Camcorders",
    unified: PRODUCT_CATEGORIES.CAMERAS,
  },
  {
    id: "abcat0500000",
    name: "Computers & Tablets",
    unified: PRODUCT_CATEGORIES.COMPUTERS,
  },
  {
    id: "abcat0800000",
    name: "Cell Phones",
    unified: PRODUCT_CATEGORIES.PHONES,
  },
  {
    id: "abcat0700000",
    name: "Video Games",
    unified: PRODUCT_CATEGORIES.GAMING,
  },
  {
    id: "abcat0900000",
    name: "Appliances",
    unified: PRODUCT_CATEGORIES.APPLIANCES,
  },
  { id: "pcmcat312300050015", name: "Home", unified: PRODUCT_CATEGORIES.HOME },
  {
    id: "pcmcat248700050021",
    name: "Office & School Supplies",
    unified: PRODUCT_CATEGORIES.OFFICE,
  },
  {
    id: "pcmcat138100050018",
    name: "Software",
    unified: PRODUCT_CATEGORIES.SOFTWARE,
  },
];

export const AMAZON_CATEGORIES = [
  {
    slug: "electronics",
    name: "Electronics",
    unified: PRODUCT_CATEGORIES.ELECTRONICS,
  },
  {
    slug: "computers-accessories",
    name: "Computers",
    unified: PRODUCT_CATEGORIES.COMPUTERS,
  },
  {
    slug: "cell-phones-accessories",
    name: "Cell Phones",
    unified: PRODUCT_CATEGORIES.PHONES,
  },
  {
    slug: "videogames",
    name: "Video Games",
    unified: PRODUCT_CATEGORIES.GAMING,
  },
  {
    slug: "home-garden",
    name: "Home & Kitchen",
    unified: PRODUCT_CATEGORIES.HOME,
  },
  {
    slug: "kitchen",
    name: "Kitchen & Dining",
    unified: PRODUCT_CATEGORIES.KITCHEN,
  },
  { slug: "beauty", name: "Beauty", unified: PRODUCT_CATEGORIES.BEAUTY },
  {
    slug: "fashion",
    name: "Clothing & Fashion",
    unified: PRODUCT_CATEGORIES.FASHION,
  },
  {
    slug: "sporting-goods",
    name: "Sports & Outdoors",
    unified: PRODUCT_CATEGORIES.SPORTS,
  },
  {
    slug: "toys-and-games",
    name: "Toys & Games",
    unified: PRODUCT_CATEGORIES.TOYS,
  },
  { slug: "books", name: "Books", unified: PRODUCT_CATEGORIES.BOOKS },
  {
    slug: "automotive",
    name: "Automotive",
    unified: PRODUCT_CATEGORIES.AUTOMOTIVE,
  },
];

export const PRODUCT_SOURCES = {
  BESTBUY: "bestbuy",
  AMAZON: "amazon",
  PRODUCTHUNT: "producthunt",
  EBAY: "ebay",
  ETSY: "etsy",
  COSTCO_US: "costco_us",
  COSTCO_CA: "costco_ca",
};

// Costco — shared base categories (US and CA differ only in 2 slugs)
const COSTCO_BASE_CATEGORIES = [
  { slug: "laptops.html", name: "Laptops", unified: PRODUCT_CATEGORIES.COMPUTERS },
  { slug: "desktop-computers.html", name: "Desktops", unified: PRODUCT_CATEGORIES.COMPUTERS },
  { slug: "computer-monitors.html", name: "Monitors", unified: PRODUCT_CATEGORIES.ELECTRONICS },
  { slug: "tvs.html", name: "TVs", unified: PRODUCT_CATEGORIES.TV_HOME_THEATER },
  { slug: "cell-phones.html", name: "Cell Phones", unified: PRODUCT_CATEGORIES.PHONES },
  { slug: "tablets.html", name: "Tablets", unified: PRODUCT_CATEGORIES.COMPUTERS },
  { slug: "headphones.html", name: "Headphones", unified: PRODUCT_CATEGORIES.AUDIO },
  { slug: "speakers.html", name: "Speakers", unified: PRODUCT_CATEGORIES.AUDIO },
  { slug: "cameras-camcorders.html", name: "Cameras", unified: PRODUCT_CATEGORIES.CAMERAS },
  { slug: "video-games.html", name: "Video Games", unified: PRODUCT_CATEGORIES.GAMING },
  { slug: "major-appliances.html", name: "Major Appliances", unified: PRODUCT_CATEGORIES.APPLIANCES },
  { slug: "small-appliances.html", name: "Small Appliances", unified: PRODUCT_CATEGORIES.APPLIANCES },
];

// Country-specific slug overrides (CA site uses different URL slugs for 2 categories)
const COSTCO_CA_SLUG_OVERRIDES = {
  "headphones.html": "headphones-earbuds.html",
  "cameras-camcorders.html": "cameras-camcorders-drones.html",
};

export const COSTCO_US_CATEGORIES = COSTCO_BASE_CATEGORIES;

export const COSTCO_CA_CATEGORIES = COSTCO_BASE_CATEGORIES.map((cat) => ({
  ...cat,
  slug: COSTCO_CA_SLUG_OVERRIDES[cat.slug] || cat.slug,
}));

export const AMAZON_REQUEST_DELAY_MS = 3_000;
export const AMAZON_MAX_PRODUCTS_PER_CATEGORY = 20;

// ═══════════════════════════════════════════════════════════════
//  FINANCE DOMAIN (Finnhub)
// ═══════════════════════════════════════════════════════════════

export const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

// Polling intervals for general (non-symbol-specific) data
export const FINNHUB_NEWS_INTERVAL_MS = 1_800_000; // 30 minutes
export const FINNHUB_EARNINGS_INTERVAL_MS = 21_600_000; // 6 hours

// On-demand cache TTLs (ms) — all symbol-specific data is fetched on request
export const FINNHUB_QUOTE_TTL_MS = 60_000; // 1 minute
export const FINNHUB_PROFILE_TTL_MS = 86_400_000; // 24 hours
export const FINNHUB_RECOMMENDATION_TTL_MS = 3_600_000; // 1 hour
export const FINNHUB_FINANCIALS_TTL_MS = 3_600_000; // 1 hour

// Request pacing for any sequential batch calls
export const FINNHUB_REQUEST_DELAY_MS = 200; // 200ms between sequential calls

// ═══════════════════════════════════════════════════════════════
//  FINANCE DOMAIN (FRED — Federal Reserve Economic Data)
// ═══════════════════════════════════════════════════════════════

export const FRED_BASE_URL = "https://api.stlouisfed.org/fred";

// Curated default series for the key indicators snapshot.
// These cover the core macroeconomic metrics an LLM might reference.
export const FRED_DEFAULT_SERIES = {
  // ─── Inflation ────────────────────────────────────────────────
  CPIAUCSL: {
    name: "CPI (All Urban Consumers)",
    category: "inflation",
    unit: "index (1982-84=100)",
  },
  CPILFESL: {
    name: "Core CPI (Ex Food & Energy)",
    category: "inflation",
    unit: "index (1982-84=100)",
  },
  PCEPI: {
    name: "PCE Price Index",
    category: "inflation",
    unit: "index (2017=100)",
  },
  T10YIE: {
    name: "10-Year Breakeven Inflation Rate",
    category: "inflation",
    unit: "%",
  },

  // ─── Interest Rates ──────────────────────────────────────────
  FEDFUNDS: {
    name: "Federal Funds Rate",
    category: "interest_rates",
    unit: "%",
  },
  DFF: {
    name: "Effective Federal Funds Rate (Daily)",
    category: "interest_rates",
    unit: "%",
  },
  DGS10: {
    name: "10-Year Treasury Yield",
    category: "interest_rates",
    unit: "%",
  },
  DGS2: {
    name: "2-Year Treasury Yield",
    category: "interest_rates",
    unit: "%",
  },
  T10Y2Y: {
    name: "10Y-2Y Treasury Spread",
    category: "interest_rates",
    unit: "%",
  },
  SOFR: {
    name: "Secured Overnight Financing Rate",
    category: "interest_rates",
    unit: "%",
  },

  // ─── Employment ──────────────────────────────────────────────
  UNRATE: {
    name: "Unemployment Rate",
    category: "employment",
    unit: "%",
  },
  PAYEMS: {
    name: "Total Nonfarm Payrolls",
    category: "employment",
    unit: "thousands of persons",
  },
  ICSA: {
    name: "Initial Jobless Claims",
    category: "employment",
    unit: "number",
  },

  // ─── GDP & Output ────────────────────────────────────────────
  GDP: {
    name: "Gross Domestic Product",
    category: "gdp",
    unit: "billions of dollars",
  },
  GDPC1: {
    name: "Real GDP",
    category: "gdp",
    unit: "billions of chained 2017 dollars",
  },
  A191RL1Q225SBEA: {
    name: "Real GDP Growth Rate",
    category: "gdp",
    unit: "% change (annualized)",
  },

  // ─── Money Supply & Debt ─────────────────────────────────────
  M2SL: {
    name: "M2 Money Supply",
    category: "money_supply",
    unit: "billions of dollars",
  },
  GFDEBTN: {
    name: "Federal Debt: Total Public Debt",
    category: "fiscal",
    unit: "millions of dollars",
  },

  // ─── Housing ─────────────────────────────────────────────────
  MORTGAGE30US: {
    name: "30-Year Fixed Mortgage Rate",
    category: "housing",
    unit: "%",
  },
  CSUSHPINSA: {
    name: "Case-Shiller Home Price Index",
    category: "housing",
    unit: "index (Jan 2000=100)",
  },

  // ─── Consumer & Sentiment ────────────────────────────────────
  UMCSENT: {
    name: "Consumer Sentiment",
    category: "sentiment",
    unit: "index (1966 Q1=100)",
  },
  RSAFS: {
    name: "Retail Sales",
    category: "consumer",
    unit: "millions of dollars",
  },
};

// ═══════════════════════════════════════════════════════════════
//  TREND DOMAIN
// ═══════════════════════════════════════════════════════════════

export const GOOGLE_TRENDS_INTERVAL_MS = 900_000; // 15 minutes
export const REDDIT_INTERVAL_MS = 600_000; // 10 minutes
export const WIKIPEDIA_INTERVAL_MS = 1_800_000; // 30 minutes
export const HACKERNEWS_INTERVAL_MS = 600_000; // 10 minutes
export const X_TRENDS_INTERVAL_MS = 86_400_000; // 24 hours
export const GOOGLE_NEWS_INTERVAL_MS = 900_000; // 15 minutes
export const MASTODON_INTERVAL_MS = 600_000; // 10 minutes
export const TVMAZE_INTERVAL_MS = 3_600_000; // 1 hour
export const BLUESKY_INTERVAL_MS = 600_000; // 10 minutes
export const GITHUB_TRENDING_INTERVAL_MS = 1_800_000; // 30 minutes
export const PRODUCTHUNT_TREND_INTERVAL_MS = 3_600_000; // 1 hour

export const TREND_SOURCES = {
  GOOGLE_TRENDS: "google-trends",
  REDDIT: "reddit",
  WIKIPEDIA: "wikipedia",
  HACKERNEWS: "hackernews",
  X: "x",
  GOOGLE_NEWS: "google-news",
  MASTODON: "mastodon",
  TVMAZE: "tvmaze",
  BLUESKY: "bluesky",
  GITHUB: "github",
  PRODUCTHUNT: "producthunt",
};

export const TREND_CATEGORIES = {
  TECHNOLOGY: "technology",
  ENTERTAINMENT: "entertainment",
  SPORTS: "sports",
  POLITICS: "politics",
  SCIENCE: "science",
  BUSINESS: "business",
  CULTURE: "culture",
  GAMING: "gaming",
  HEALTH: "health",
  WORLD: "world",
  OTHER: "other",
};

export const REDDIT_SUBREDDITS = [
  { name: "popular", category: null },
  { name: "all", category: null },
  { name: "technology", category: TREND_CATEGORIES.TECHNOLOGY },
  { name: "worldnews", category: TREND_CATEGORIES.WORLD },
  { name: "science", category: TREND_CATEGORIES.SCIENCE },
  { name: "movies", category: TREND_CATEGORIES.ENTERTAINMENT },
  { name: "gaming", category: TREND_CATEGORIES.GAMING },
  { name: "sports", category: TREND_CATEGORIES.SPORTS },
  { name: "business", category: TREND_CATEGORIES.BUSINESS },
];

export const X_WOEIDS = {
  WORLDWIDE: 1,
  UNITED_STATES: 23424977,
  CANADA: 23424775,
  UNITED_KINGDOM: 23424975,
};

export const WIKIPEDIA_EXCLUDED_PAGES = [
  "Main_Page",
  "Special:Search",
  "Wikipedia:Featured_pictures",
  "-",
  "undefined",
];

export const HACKERNEWS_TOP_STORY_LIMIT = 30;
export const REDDIT_POSTS_PER_SUBREDDIT = 25;
export const WIKIPEDIA_TOP_ARTICLES_LIMIT = 50;
export const GOOGLE_NEWS_ARTICLE_LIMIT = 80;

export const MASTODON_INSTANCES = [
  "https://mastodon.social",
  "https://mastodon.world",
  "https://fosstodon.org",
];

// ═══════════════════════════════════════════════════════════════
//  WEATHER DOMAIN
// ═══════════════════════════════════════════════════════════════

export const OPEN_METEO_INTERVAL_MS = 300_000; // 5 minutes
export const AIR_QUALITY_INTERVAL_MS = 300_000; // 5 minutes
export const TOMORROWIO_REALTIME_INTERVAL_MS = 600_000; // 10 minutes
export const TOMORROWIO_FORECAST_INTERVAL_MS = 3_600_000; // 1 hour
export const EARTHQUAKE_INTERVAL_MS = 60_000; // 1 minute
export const NEO_INTERVAL_MS = 3_600_000; // 1 hour
export const DONKI_INTERVAL_MS = 900_000; // 15 minutes
export const ISS_POSITION_INTERVAL_MS = 30_000; // 30 seconds
export const ISS_ASTROS_INTERVAL_MS = 3_600_000; // 1 hour
export const KP_INDEX_INTERVAL_MS = 900_000; // 15 minutes
export const WILDFIRE_INTERVAL_MS = 900_000; // 15 minutes
export const TIDE_INTERVAL_MS = 1_800_000; // 30 minutes
export const SOLAR_WIND_INTERVAL_MS = 300_000; // 5 minutes
export const GOOGLE_AIR_QUALITY_INTERVAL_MS = 3_600_000; // 1 hour
export const GOOGLE_POLLEN_INTERVAL_MS = 7_200_000; // 2 hours
export const APOD_INTERVAL_MS = 86_400_000; // 24 hours
export const LAUNCH_INTERVAL_MS = 1_800_000; // 30 minutes
export const TWILIGHT_INTERVAL_MS = 3_600_000; // 1 hour
export const ENV_CANADA_INTERVAL_MS = 300_000; // 5 minutes
export const AVALANCHE_INTERVAL_MS = 3_600_000; // 1 hour

export const SOLAR_FLARE_CLASSES = ["A", "B", "C", "M", "X"];

export const KP_STORM_SCALE = [
  { min: 0, max: 4, level: "Quiet", storm: null },
  { min: 4, max: 5, level: "Active", storm: null },
  { min: 5, max: 6, level: "Minor Storm", storm: "G1" },
  { min: 6, max: 7, level: "Moderate Storm", storm: "G2" },
  { min: 7, max: 8, level: "Strong Storm", storm: "G3" },
  { min: 8, max: 9, level: "Severe Storm", storm: "G4" },
  { min: 9, max: Infinity, level: "Extreme Storm", storm: "G5" },
];

export const EARTHQUAKE_ALERT_LEVELS = {
  green: "Limited casualties and damage",
  yellow: "Some casualties and damage",
  orange: "Significant casualties and damage",
  red: "Extensive casualties and damage",
};

export const EARTHQUAKE_MAGNITUDE_SCALE = [
  { min: 0, max: 2, label: "Micro" },
  { min: 2, max: 4, label: "Minor" },
  { min: 4, max: 5, label: "Light" },
  { min: 5, max: 6, label: "Moderate" },
  { min: 6, max: 7, label: "Strong" },
  { min: 7, max: 8, label: "Major" },
  { min: 8, max: Infinity, label: "Great" },
];

export const WMO_WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Drizzle: Light intensity",
  53: "Drizzle: Moderate intensity",
  55: "Drizzle: Dense intensity",
  56: "Freezing Drizzle: Light intensity",
  57: "Freezing Drizzle: Dense intensity",
  61: "Rain: Slight intensity",
  63: "Rain: Moderate intensity",
  65: "Rain: Heavy intensity",
  66: "Freezing Rain: Light intensity",
  67: "Freezing Rain: Heavy intensity",
  71: "Snow fall: Slight intensity",
  73: "Snow fall: Moderate intensity",
  75: "Snow fall: Heavy intensity",
  77: "Snow grains",
  80: "Rain showers: Slight intensity",
  81: "Rain showers: Moderate intensity",
  82: "Rain showers: Heavy intensity",
  85: "Snow showers: Slight intensity",
  86: "Snow showers: Heavy intensity",
  95: "Thunderstorm: Slight or moderate",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export const TOMORROWIO_WEATHER_CODES = {
  0: "Unknown",
  1000: "Clear, Sunny",
  1100: "Mostly Clear",
  1101: "Partly Cloudy",
  1102: "Mostly Cloudy",
  1001: "Cloudy",
  2000: "Fog",
  2100: "Light Fog",
  4000: "Drizzle",
  4001: "Rain",
  4200: "Light Rain",
  4201: "Heavy Rain",
  5000: "Snow",
  5001: "Flurries",
  5100: "Light Snow",
  5101: "Heavy Snow",
  6000: "Freezing Drizzle",
  6001: "Freezing Rain",
  6200: "Light Freezing Rain",
  6201: "Heavy Freezing Rain",
  7000: "Ice Pellets",
  7101: "Heavy Ice Pellets",
  7102: "Light Ice Pellets",
  8000: "Thunderstorm",
};

// ═══════════════════════════════════════════════════════════════
//  API RATE LIMITS
// ═══════════════════════════════════════════════════════════════
// Single source of truth for all external API rate limits.
// qps = queries per second, qpm = queries per minute, qpd = queries per day.
// requestDelayMs = minimum ms between sequential requests (derived from qps/qpm).
// null = unlimited or not documented.
// ═══════════════════════════════════════════════════════════════

export const API_RATE_LIMITS = {
  // ─── Event Domain ──────────────────────────────────────────────────
  TICKETMASTER: {
    qps: 5,
    qpm: null,
    qpd: 5_000,
    requestDelayMs: 200, // 1000 / 5 QPS
  },
  SEATGEEK: {
    qps: null,
    qpm: null,
    qpd: 1_000,
    requestDelayMs: 100,
  },
  TMDB: {
    qps: 50,
    qpm: null,
    qpd: null, // no daily limit; old 40/10s limit retired Dec 2019
    requestDelayMs: 20, // 1000 / 50 QPS
  },
  GOOGLE_PLACES: {
    qps: 10,
    qpm: null,
    qpd: null,
    requestDelayMs: 100, // 1000 / 10 QPS
  },

  // ─── Market Domain ────────────────────────────────────────────────
  YAHOO_FINANCE: {
    qps: null,
    qpm: null,
    qpd: null, // yahoo-finance2 library, no official rate limit
    requestDelayMs: 500, // conservative
  },

  // ─── Finance Domain ───────────────────────────────────────────────
  FINNHUB: {
    qps: 1,
    qpm: 60,
    qpd: null,
    requestDelayMs: 200, // padded from 1000 / 1 QPS
  },

  // ─── Product Domain ───────────────────────────────────────────────
  BESTBUY: {
    qps: 5,
    qpm: null,
    qpd: 50_000,
    requestDelayMs: 1_000, // conservative 1s between requests
  },
  BESTBUY_CA: {
    qps: null,
    qpm: null,
    qpd: null, // public ecomm-api, no documented limit
    requestDelayMs: 2_000, // polite 2s between batches
  },
  PRODUCTHUNT: {
    qps: null,
    qpm: 30,
    qpd: null, // 450 requests per 15-min window = 30 QPM
    requestDelayMs: 2_000, // 60000 / 30 QPM
  },
  EBAY: {
    qps: 5,
    qpm: null,
    qpd: 5_000,
    requestDelayMs: 200, // 1000 / 5 QPS
  },
  ETSY: {
    qps: 5,
    qpm: null,
    qpd: 5_000,
    requestDelayMs: 200, // 1000 / 5 QPS
  },
  AMAZON: {
    qps: null,
    qpm: null,
    qpd: null, // scraping, no official API
    requestDelayMs: 3_000, // conservative scrape pacing
  },
  COSTCO: {
    qps: null,
    qpm: null,
    qpd: null, // scraping, no official API — Akamai WAF protected
    requestDelayMs: 5_000, // conservative 5s between requests to avoid blocks
  },

  // ─── Trend Domain ─────────────────────────────────────────────────
  REDDIT: {
    qps: null,
    qpm: 100,
    qpd: null,
    requestDelayMs: 600, // 60000 / 100 QPM
  },
  HACKERNEWS: {
    qps: null,
    qpm: null,
    qpd: null, // public API, generous
    requestDelayMs: 100,
  },
  WIKIPEDIA: {
    qps: null,
    qpm: null,
    qpd: null, // public API
    requestDelayMs: 100,
  },
  MASTODON: {
    qps: null,
    qpm: 60,
    qpd: null, // 300 requests per 5-min window = 60 QPM
    requestDelayMs: 1_000, // 60000 / 60 QPM
  },
  BLUESKY: {
    qps: null,
    qpm: 600,
    qpd: null, // 3000 requests per 5-min window = 600 QPM
    requestDelayMs: 100, // 60000 / 600 QPM
  },
  GITHUB: {
    qps: null,
    qpm: 60,
    qpd: null,
    requestDelayMs: 1_000, // 60000 / 60 QPM
  },
  X: {
    qps: null,
    qpm: 450,
    qpd: null,
    requestDelayMs: 150,
  },
  GOOGLE_TRENDS: {
    qps: null,
    qpm: null,
    qpd: null, // scraping
    requestDelayMs: 2_000,
  },
  GOOGLE_NEWS: {
    qps: null,
    qpm: null,
    qpd: null, // RSS scraping
    requestDelayMs: 1_000,
  },
  TVMAZE: {
    qps: 2,
    qpm: null,
    qpd: null, // 20 calls per 10 seconds = 2 QPS
    requestDelayMs: 500, // 1000 / 2 QPS
  },

  // ─── Weather Domain ───────────────────────────────────────────────
  OPEN_METEO: {
    qps: 10,
    qpm: 600,
    qpd: 10_000, // 600 QPM, 5000/hr, 10000/day
    requestDelayMs: 100, // 1000 / 10 QPS
  },
  TOMORROWIO: {
    qps: 3,
    qpm: 25,
    qpd: 500,
    requestDelayMs: 2_400, // 60000 / 25 QPM
  },
  NASA: {
    qps: null,
    qpm: 16,
    qpd: 1_000, // 1000 req/hr with API key ≈ 16 QPM
    requestDelayMs: 3_750, // 60000 / 16 QPM
  },
  USGS: {
    qps: null,
    qpm: null,
    qpd: null, // public API
    requestDelayMs: 200,
  },
  NOAA: {
    qps: null,
    qpm: null,
    qpd: null, // public API
    requestDelayMs: 200,
  },
  GOOGLE_AIR_QUALITY: {
    qps: null,
    qpm: 6_000,
    qpd: 500, // 6000 QPM default; qpd is self-imposed budget cap
    requestDelayMs: 1_000,
  },
  GOOGLE_POLLEN: {
    qps: null,
    qpm: 6_000,
    qpd: 500, // 6000 QPM default; qpd is self-imposed budget cap
    requestDelayMs: 1_000,
  },
  ENV_CANADA: {
    qps: null,
    qpm: null,
    qpd: null, // public RSS
    requestDelayMs: 1_000,
  },
  LAUNCH_LIBRARY: {
    qps: null,
    qpm: 15,
    qpd: null,
    requestDelayMs: 4_000, // 60000 / 15 QPM
  },

  // ─── Knowledge Domain ─────────────────────────────────────────────
  DICTIONARY: {
    qps: null,
    qpm: null,
    qpd: null, // fully open, no documented limits
    requestDelayMs: 500,
  },
  OPEN_LIBRARY: {
    qps: null,
    qpm: 100,
    qpd: null, // ~100 req/min recommended
    requestDelayMs: 600,
  },
  REST_COUNTRIES: {
    qps: null,
    qpm: null,
    qpd: null, // fully open
    requestDelayMs: 200,
  },
  ARXIV: {
    qps: null,
    qpm: 20,
    qpd: null, // 3-second wait between requests
    requestDelayMs: 3_000,
  },
  WIKIPEDIA_SUMMARY: {
    qps: 200,
    qpm: null,
    qpd: null, // REST API, very generous
    requestDelayMs: 100,
  },
  JIKAN: {
    qps: 3,
    qpm: 60,
    qpd: null, // strict 3/sec, 60/min limit
    requestDelayMs: 350,
  },

  // ─── Health Domain ────────────────────────────────────────────────
  OPEN_FDA: {
    qps: 4,
    qpm: 240,
    qpd: null, // 240/min with key, 40/min without
    requestDelayMs: 250,
  },

  // ─── Transit Domain ───────────────────────────────────────────────
  TRANSLINK: {
    qps: null,
    qpm: null,
    qpd: 1_000, // ~1000 req/day
    requestDelayMs: 500,
  },

  // ─── Utility Domain ───────────────────────────────────────────────
  EXCHANGE_RATE: {
    qps: null,
    qpm: null,
    qpd: 1_500, // 1500/month on free tier ≈ 50/day
    requestDelayMs: 1_000,
  },
  TIMEZONE: {
    qps: 1,
    qpm: null,
    qpd: null,
    requestDelayMs: 1_000,
  },
  IPINFO: {
    qps: null,
    qpm: null,
    qpd: 1_666, // 50000/month ≈ 1666/day
    requestDelayMs: 200,
  },

  // ─── Finance Domain (FRED) ────────────────────────────────────────
  FRED: {
    qps: 2,
    qpm: 120,
    qpd: null, // no daily limit
    requestDelayMs: 500, // 60000 / 120 QPM
  },

  // ─── Maritime Domain (AIS Stream) ─────────────────────────────────
  AIS_STREAM: {
    qps: 1,
    qpm: null,
    qpd: null, // WebSocket — 1 subscription update/second; persistent connection
    requestDelayMs: 1_000, // only applies to subscription updates
  },

  // ─── Energy Domain (EIA) ──────────────────────────────────────────
  EIA: {
    qps: null,
    qpm: null,
    qpd: null, // undocumented; key auto-suspended if exceeded
    requestDelayMs: 500, // conservative pacing
  },
};

// ═══════════════════════════════════════════════════════════════
//  EBAY — Category Mappings
// ═══════════════════════════════════════════════════════════════

export const EBAY_CATEGORIES = [
  { id: "9355", name: "Cell Phones", unified: "phones" },
  { id: "175673", name: "Computers & Tablets", unified: "computers" },
  { id: "293", name: "Consumer Electronics", unified: "electronics" },
  { id: "1249", name: "Video Games & Consoles", unified: "gaming" },
  { id: "11450", name: "Clothing & Accessories", unified: "fashion" },
  { id: "26395", name: "Health & Beauty", unified: "beauty" },
  { id: "11700", name: "Home & Garden", unified: "home" },
  { id: "888", name: "Sporting Goods", unified: "sports" },
  { id: "220", name: "Toys & Hobbies", unified: "toys" },
  { id: "6000", name: "Motors Parts & Accessories", unified: "automotive" },
];

// ═══════════════════════════════════════════════════════════════
//  ETSY — Taxonomy → Unified Category Mapping
// ═══════════════════════════════════════════════════════════════

export const ETSY_CATEGORY_MAP = {
  electronics_and_accessories: "electronics",
  computers_and_peripherals: "computers",
  video_games: "gaming",
  home_and_living: "home",
  kitchen_and_dining: "kitchen",
  clothing: "fashion",
  jewelry: "fashion",
  bath_and_beauty: "beauty",
  toys_and_games: "toys",
  books_movies_and_music: "books",
  sports_and_outdoors: "sports",
  craft_supplies_and_tools: "other",
  art_and_collectibles: "other",
  bags_and_purses: "fashion",
  shoes: "fashion",
  accessories: "fashion",
  pet_supplies: "other",
  weddings: "other",
};

// ═══════════════════════════════════════════════════════════════
//  GOOGLE TRENDS — Geographic Regions
// ═══════════════════════════════════════════════════════════════

export const GOOGLE_TRENDS_GEOS = [
  "US",
  "CA",
  "GB",
  "AU",
  "IN",
  "DE",
  "JP",
  "FR",
  "BR",
];

// ═══════════════════════════════════════════════════════════════
//  SHARED
// ═══════════════════════════════════════════════════════════════

export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

// ═══════════════════════════════════════════════════════════════
//  KNOWLEDGE DOMAIN
// ═══════════════════════════════════════════════════════════════

export const DICTIONARY_BASE_URL =
  "https://api.dictionaryapi.dev/api/v2/entries/en";
export const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";
export const REST_COUNTRIES_BASE_URL = "https://restcountries.com/v3.1";
export const ARXIV_BASE_URL = "http://export.arxiv.org/api/query";
export const WIKIPEDIA_SUMMARY_BASE_URL =
  "https://en.wikipedia.org/api/rest_v1";
export const JIKAN_BASE_URL = "https://api.jikan.moe/v4";
export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

export const ARXIV_CATEGORIES = [
  { id: "cs.AI", name: "Artificial Intelligence" },
  { id: "cs.CL", name: "Computation & Language (NLP)" },
  { id: "cs.CV", name: "Computer Vision" },
  { id: "cs.LG", name: "Machine Learning" },
  { id: "cs.SE", name: "Software Engineering" },
  { id: "cs.CR", name: "Cryptography & Security" },
  { id: "cs.DC", name: "Distributed Computing" },
  { id: "cs.RO", name: "Robotics" },
  { id: "physics", name: "Physics" },
  { id: "math", name: "Mathematics" },
  { id: "q-bio", name: "Quantitative Biology" },
  { id: "econ", name: "Economics" },
  { id: "stat", name: "Statistics" },
];

// ═══════════════════════════════════════════════════════════════
//  HEALTH DOMAIN
// ═══════════════════════════════════════════════════════════════


export const OPEN_FDA_BASE_URL = "https://api.fda.gov";

// ═══════════════════════════════════════════════════════════════
//  TRANSIT DOMAIN
// ═══════════════════════════════════════════════════════════════

export const TRANSLINK_BASE_URL = "https://api.translink.ca/rttiapi/v1";

// ═══════════════════════════════════════════════════════════════
//  UTILITY DOMAIN
// ═══════════════════════════════════════════════════════════════

export const EXCHANGE_RATE_BASE_URL = "https://open.er-api.com/v6/latest";
export const TIMEZONE_BASE_URL = "https://worldtimeapi.org/api";
export const IPINFO_BASE_URL = "https://ipinfo.io";


// ═══════════════════════════════════════════════════════════════
//  MARITIME DOMAIN (AIS Stream)
// ═══════════════════════════════════════════════════════════════

export const AIS_STREAM_WS_URL = "wss://stream.aisstream.io/v0/stream";
export const AIS_STREAM_MAX_BUFFER_SIZE = 5_000; // ring buffer of recent messages
export const AIS_STREAM_RECONNECT_DELAY_MS = 10_000; // 10s between reconnect attempts
export const AIS_STREAM_BBOX_RADIUS_DEG = 2; // ~220km radius around configured lat/lng

// Default message types to subscribe to
export const AIS_STREAM_MESSAGE_TYPES = [
  "PositionReport",
  "ShipStaticData",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "SafetyBroadcastMessage",
  "StandardSearchAndRescueAircraftReport",
  "BaseStationReport",
];

// ═══════════════════════════════════════════════════════════════
//  ENERGY DOMAIN (EIA — U.S. Energy Information Administration)
// ═══════════════════════════════════════════════════════════════

export const EIA_BASE_URL = "https://api.eia.gov";

// Curated default series for the key energy indicators snapshot.
export const EIA_DEFAULT_SERIES = {
  // ─── Petroleum ────────────────────────────────────────────────
  GAS_PRICE_REGULAR: {
    name: "U.S. Regular Gasoline Price",
    category: "petroleum",
    route: "petroleum/pri/gnd",
    dataColumn: "value",
    facets: { product: ["EPM0"], duoarea: ["NUS"] },
    frequency: "weekly",
    unit: "$/gallon",
    description: "U.S. regular conventional retail gasoline price",
  },
  GAS_PRICE_DIESEL: {
    name: "U.S. No 2 Diesel Price",
    category: "petroleum",
    route: "petroleum/pri/gnd",
    dataColumn: "value",
    facets: { product: ["EPD2DXL0"], duoarea: ["NUS"] },
    frequency: "weekly",
    unit: "$/gallon",
    description: "U.S. No 2 diesel retail price",
  },
  CRUDE_OIL_PRICE: {
    name: "Crude Oil (WTI) Spot Price",
    category: "petroleum",
    route: "petroleum/pri/spt",
    dataColumn: "value",
    facets: { product: ["EPCBRENT"] },
    frequency: "daily",
    unit: "$/barrel",
    description: "Europe Brent crude oil spot price FOB",
  },

  // ─── Natural Gas ──────────────────────────────────────────────
  NATURAL_GAS_PRICE: {
    name: "Henry Hub Natural Gas Spot Price",
    category: "natural_gas",
    route: "natural-gas/pri/fut",
    dataColumn: "value",
    facets: { process: ["FRC"] },
    frequency: "daily",
    unit: "$/MMBtu",
    description: "Henry Hub natural gas futures contract 1 price",
  },
  NATURAL_GAS_STORAGE: {
    name: "U.S. Working Gas in Underground Storage",
    category: "natural_gas",
    route: "natural-gas/stor/wkly",
    dataColumn: "value",
    frequency: "weekly",
    unit: "Bcf",
    description: "Weekly working gas in underground storage",
  },

  // ─── Electricity ──────────────────────────────────────────────
  ELECTRICITY_PRICE: {
    name: "U.S. Average Electricity Price",
    category: "electricity",
    route: "electricity/retail-sales",
    dataColumn: "price",
    facets: { stateid: ["US"], sectorid: ["ALL"] },
    frequency: "monthly",
    unit: "cents/kWh",
    description: "Average U.S. retail electricity price, all sectors",
  },

  // ─── Coal ─────────────────────────────────────────────────────
  COAL_PRODUCTION: {
    name: "U.S. Coal Production",
    category: "coal",
    route: "coal/aggregate-production",
    dataColumn: "production",
    frequency: "quarterly",
    unit: "short tons (thousands)",
    description: "U.S. quarterly coal production",
  },

  // ─── Nuclear ──────────────────────────────────────────────────
  NUCLEAR_OUTAGES: {
    name: "U.S. Nuclear Outage Percentage",
    category: "nuclear",
    route: "nuclear-outages/us-nuclear-outages",
    dataColumn: "outage",
    frequency: "daily",
    unit: "%",
    description: "Percentage of U.S. nuclear capacity currently offline",
  },
};

// ═══════════════════════════════════════════════════════════════
//  DATASET REGISTRY — Static Data Manifests
// ═══════════════════════════════════════════════════════════════
// Tracks provenance for all static datasets loaded into memory.
// Every new dataset (CSV, XLSX, JSON, etc.) must be registered
// here with its source, version, year, and file path.
// ═══════════════════════════════════════════════════════════════

export const DATASET_REGISTRY = [
  {
    id: "usda-sr-legacy",
    name: "USDA SR Legacy",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food.csv",
    source: "U.S. Department of Agriculture",
    url: "https://fdc.nal.usda.gov/",
    version: "SR Legacy (April 2018)",
    dataYear: 2018,
    ingestedYear: 2026,
    foods: 1346,
    region: "USA",
    notes: "Curated raw whole foods subset from USDA SR legacy release.",
  },
  {
    id: "health-canada-cnf",
    name: "Health Canada CNF",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food_canada.csv",
    source: "Health Canada",
    url: "https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/nutrient-data.html",
    version: "Canadian Nutrient File (CNF 2015)",
    dataYear: 2015,
    ingestedYear: 2026,
    foods: 3570,
    region: "Canada",
    notes:
      "Filtered to 13 real-food groups. Includes French food names. ETL from relational CSV.",
  },
  {
    id: "fao-infoods-biofoodcomp",
    name: "FAO/INFOODS BioFoodComp",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food_fao.csv",
    source: "Food and Agriculture Organization of the United Nations",
    url: "https://www.fao.org/infoods/infoods/tables-and-databases/en/",
    version: "BioFoodComp v4.0",
    dataYear: 2017,
    ingestedYear: 2026,
    foods: 5849,
    region: "Global",
    notes:
      "Biodiversity food composition database. Filtered to raw foods only. Includes local/indigenous names and per-row country/region provenance.",
  },
  {
    id: "digest-nutrient-metadata",
    name: "Digest Nutrient Metadata",
    domain: "nutrition",
    file: "fetchers/health/data/digest_nutrient.csv",
    source: "Internal (derived from USDA tagnames)",
    url: null,
    version: "1.0",
    dataYear: 2026,
    ingestedYear: 2026,
    foods: null,
    region: null,
    notes:
      "Maps internal nutrient IDs to human-readable names, units, categories, and types.",
  },
  {
    id: "uk-cofid",
    name: "UK CoFID (McCance & Widdowson)",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food_uk.csv",
    source: "Public Health England",
    url: "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid",
    version: "CoFID 2021",
    dataYear: 2021,
    ingestedYear: 2026,
    foods: 1334,
    region: "United Kingdom",
    notes:
      "Multi-sheet Excel joined by food code (Proximates + Inorganics + Vitamins + Vitamin Fractions). Filtered to exclude recipes, beverages, and confectionery.",
  },
  {
    id: "india-ifct",
    name: "India IFCT",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food_india.csv",
    source: "National Institute of Nutrition, India",
    url: "https://ifct2017.com/",
    version: "IFCT 2017",
    dataYear: 2017,
    ingestedYear: 2026,
    foods: 538,
    region: "India",
    notes:
      "528 key Indian foods with 151 nutrients. Includes names in 14+ Indian languages. Energy converted from kJ, amino acids from mg to g.",
  },
  {
    id: "australia-afcd",
    name: "Australia AFCD",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food_australia.csv",
    source: "Food Standards Australia New Zealand (FSANZ)",
    url: "https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files",
    version: "Release 3",
    dataYear: 2025,
    ingestedYear: 2026,
    foods: 1072,
    region: "Australia",
    notes:
      "1,588 foods with 272 nutrient columns. Filtered to real foods (excludes beverages, confectionery, snack foods, sauces, soups). 79 nutrients mapped to digest schema.",
  },
  {
    id: "japan-mext",
    name: "Japan MEXT Standard Tables",
    domain: "nutrition",
    file: "fetchers/health/data/digest_food_japan.csv",
    source: "Ministry of Education, Culture, Sports, Science and Technology (MEXT), Japan",
    url: "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_01110.html",
    version: "8th Revision (2020)",
    dataYear: 2020,
    ingestedYear: 2026,
    foods: 1758,
    region: "Japan",
    notes:
      "2,490 foods with 65 nutrient columns. Food names in Japanese. INFOODS tagnames used for column mapping. Filtered to exclude confectionery, beverages, condiments, and ready meals.",
  },

  // ─── Chemistry ──────────────────────────────────────────────────

  {
    id: "periodic-table",
    name: "Periodic Table of Elements",
    domain: "chemistry",
    file: "fetchers/knowledge/data/digest_elements.csv",
    source: "Bowserinator/Periodic-Table-JSON (IUPAC data)",
    url: "https://github.com/Bowserinator/Periodic-Table-JSON",
    version: "2024",
    dataYear: 2024,
    ingestedYear: 2026,
    records: 119,
    region: null,
    notes:
      "All 118 confirmed elements + Oganesson. Includes atomic mass, density, melting/boiling points, electronegativity, electron configuration, ionization energy, discovery info, and summaries. CC BY-SA 3.0.",
  },

  // ─── Development / Economics ─────────────────────────────────────

  {
    id: "world-bank-indicators",
    name: "World Bank Development Indicators",
    domain: "economics",
    file: "fetchers/knowledge/data/digest_world_indicators.csv",
    source: "World Bank Open Data",
    url: "https://data.worldbank.org/",
    version: "2024 (most recent available year per indicator)",
    dataYear: 2024,
    ingestedYear: 2026,
    records: 217,
    region: "Global",
    notes:
      "15 key indicators (GDP, population, life expectancy, CO2, literacy, internet, unemployment, inflation, forest, renewables, Gini, electricity, health expenditure) for 217 countries. Most recent value per indicator (2018-2024). CC BY 4.0.",
  },

  // ─── Aviation / Utility ────────────────────────────────────────────

  {
    id: "airport-codes",
    name: "Airport Codes (OurAirports)",
    domain: "utility",
    file: "fetchers/utility/data/digest_airports.csv",
    source: "OurAirports",
    url: "https://ourairports.com/data/",
    version: "2026-03",
    dataYear: 2026,
    ingestedYear: 2026,
    records: 4555,
    region: "Global",
    notes:
      "Medium and large airports with IATA codes. Includes IATA/ICAO codes, city, country, coordinates, elevation, and type. Public Domain.",
  },

  // ─── Astronomy / Knowledge ─────────────────────────────────────────

  {
    id: "nasa-exoplanets",
    name: "NASA Exoplanet Archive",
    domain: "knowledge",
    file: "fetchers/knowledge/data/digest_exoplanets.csv",
    source: "NASA Exoplanet Archive (Planetary Systems table)",
    url: "https://exoplanetarchive.ipac.caltech.edu/",
    version: "2026-03",
    dataYear: 2026,
    ingestedYear: 2026,
    records: 6153,
    region: null,
    notes:
      "All confirmed exoplanets (default_flag=1). 18 columns: planet name, host star, discovery method/year/facility, orbital period, radius, mass, semi-major axis, eccentricity, equilibrium temp, stellar mass/radius/temp, distance, coordinates. Public Domain.",
  },

  // ─── Pharmaceuticals / Health ──────────────────────────────────────

  {
    id: "fda-drug-ndc",
    name: "FDA Drug NDC Directory",
    domain: "health",
    file: "fetchers/health/data/digest_fda_drugs.csv",
    source: "FDA openFDA NDC API",
    url: "https://open.fda.gov/apis/drug/ndc/",
    version: "2026-03",
    dataYear: 2026,
    ingestedYear: 2026,
    records: 26000,
    region: "United States",
    notes:
      "FDA-registered drug products with NDC codes, generic/brand names, dosage forms, routes, active ingredients, pharmacological classes, and marketing categories. Public Domain.",
  },
  {
    id: "free-exercise-db",
    name: "Free Exercise DB",
    domain: "health",
    file: "fetchers/health/data/digest_exercises.csv",
    source: "Community/Yuhonas",
    url: "https://github.com/yuhonas/free-exercise-db",
    version: "2026-03",
    dataYear: 2026,
    ingestedYear: 2026,
    records: 873,
    region: "Global",
    notes:
      "Comprehensive list of gym exercises including mechanic, force, level, equipment, and primary/secondary muscles involved. Public Domain.",
  },
  {
    id: "wger-exercise-db",
    name: "Wger Exercise DB",
    domain: "health",
    file: "fetchers/health/data/digest_exercises_wger.csv",
    source: "Wger",
    url: "https://wger.de",
    version: "2026-03",
    dataYear: 2026,
    ingestedYear: 2026,
    records: 895,
    region: "Global",
    notes:
      "Extensive community-driven exercise database with translations, category, equipment, and targeted muscles.",
  },
];

// ═══════════════════════════════════════════════════════════════
//  NUTRITION DOMAIN — Multi-Source Whole Foods Database
// ═══════════════════════════════════════════════════════════════

/** Nutrient type categories for filtering */
export const NUTRITION_NUTRIENT_TYPES = [
  {
    key: "macros",
    label: "Macronutrients",
    description: "Protein, fat, carbs, fiber, calories, water",
  },
  {
    key: "minerals",
    label: "Minerals",
    description: "Calcium, iron, magnesium, potassium, zinc, etc.",
  },
  {
    key: "vitamins",
    label: "Vitamins",
    description: "Vitamin A, B-complex, C, D, E, K, folate, etc.",
  },
  {
    key: "amino_acids",
    label: "Amino Acids",
    description: "Essential & non-essential amino acids",
  },
  {
    key: "lipids",
    label: "Lipid Profile",
    description: "Saturated, mono/polyunsaturated fats, omega-3/6",
  },
  {
    key: "carbs",
    label: "Carbohydrate Detail",
    description: "Sugars (glucose, fructose, sucrose), starch, fiber",
  },
  {
    key: "sterols",
    label: "Sterols",
    description: "Cholesterol, phytosterol, campesterol, stigmasterol",
  },
];

/** CSV column → human-readable label map for macronutrients */
export const NUTRITION_MACRO_FIELDS = {
  kilocalories: "calories_kcal",
  kilojoules: "energy_kj",
  protein: "protein_g",
  lipid: "totalFat_g",
  carbohydrate: "carbohydrate_g",
  fiber: "fiber_g",
  sugar: "totalSugar_g",
  water: "water_g",
  mineral: "ash_g",
  ethanol: "alcohol_g",
};

/** CSV column → human-readable label map for minerals (values in mg unless noted) */
export const NUTRITION_MINERAL_FIELDS = {
  calcium: "calcium_mg",
  iron: "iron_mg",
  magnesium: "magnesium_mg",
  phosphorus: "phosphorus_mg",
  potassium: "potassium_mg",
  sodium: "sodium_mg",
  zinc: "zinc_mg",
  copper: "copper_mg",
  manganese: "manganese_mg",
  selenium: "selenium_mcg",
  fluoride: "fluoride_mcg",
};

/** CSV column → human-readable label map for vitamins */
export const NUTRITION_VITAMIN_FIELDS = {
  ascorbic_acid: "vitaminC_mg",
  thiamin: "vitaminB1_mg",
  riboflavin: "vitaminB2_mg",
  niacin: "vitaminB3_mg",
  pantothenic_acid: "vitaminB5_mg",
  vitamin_b6: "vitaminB6_mg",
  folate_total: "folate_mcg",
  cyanocobalamin: "vitaminB12_mcg",
  choline: "choline_mg",
  vitamin_a_rae: "vitaminA_RAE_mcg",
  vitamin_a_ui: "vitaminA_IU",
  retinol: "retinol_mcg",
  beta_carotene: "betaCarotene_mcg",
  alpha_carotene: "alphaCarotene_mcg",
  alpha_tocopherol: "vitaminE_mg",
  vitamin_d: "vitaminD_mcg",
  ergocalciferol: "vitaminD2_mcg",
  cholecalciferol: "vitaminD3_mcg",
  phylloquinone: "vitaminK1_mcg",
  menaquinone_4: "vitaminK2_mcg",
  lycopene: "lycopene_mcg",
  lutein_and_zeaxanthin: "luteinZeaxanthin_mcg",
  beta_cryptoxanthin: "betaCryptoxanthin_mcg",
};

/** CSV column → human-readable label map for amino acids (values in g) */
export const NUTRITION_AMINO_ACID_FIELDS = {
  tryptophan: "tryptophan_g",
  threonine: "threonine_g",
  isoleucine: "isoleucine_g",
  leucine: "leucine_g",
  lysine: "lysine_g",
  methionine: "methionine_g",
  cystine: "cystine_g",
  phenylalanine: "phenylalanine_g",
  tyrosine: "tyrosine_g",
  valine: "valine_g",
  arginine: "arginine_g",
  histidine: "histidine_g",
  alanine: "alanine_g",
  aspartic_acid: "asparticAcid_g",
  glutamic_acid: "glutamicAcid_g",
  glycine: "glycine_g",
  proline: "proline_g",
  serine: "serine_g",
  hydroxyproline: "hydroxyproline_g",
};

/** CSV column → human-readable label map for lipid profile (values in g) */
export const NUTRITION_LIPID_FIELDS = {
  saturated_fat: "saturatedFat_g",
  monounsaturated_fat: "monounsaturatedFat_g",
  polyunsaturated_fat: "polyunsaturatedFat_g",
  trans_monoenoic_fat: "transMonoenoicFat_g",
  trans_polyenoic_fat: "transPolyenoicFat_g",
  c18_d3_n3_cis_cis_cis: "omega3_ALA_g",
  c20_d5_n3: "omega3_EPA_g",
  c22_d6_n3_dha: "omega3_DHA_g",
  c22_d5_n3: "omega3_DPA_g",
  c18_d2_n6_cis_cis: "omega6_linoleic_g",
  c20_d4_undifferentiated: "omega6_arachidonic_g",
};

/** CSV column → human-readable label map for carbohydrate details */
export const NUTRITION_CARB_DETAIL_FIELDS = {
  starch: "starch_g",
  sucrose: "sucrose_g",
  glucose: "glucose_g",
  fructose: "fructose_g",
  lactose: "lactose_g",
  maltose: "maltose_g",
  galactose: "galactose_g",
  fiber: "fiber_g",
  sugar: "totalSugar_g",
};

/** CSV column → human-readable label map for sterols (values in mg) */
export const NUTRITION_STEROL_FIELDS = {
  cholesterol: "cholesterol_mg",
  phytosterol: "phytosterol_mg",
  stigmasterol: "stigmasterol_mg",
  campesterol: "campesterol_mg",
  beta_sitosterol: "betaSitosterol_mg",
};

// ═══════════════════════════════════════════════════════════════
//  SHARED COMPUTE / ROUTE CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Default TTL for in-memory ephemeral stores (CSV, QR, LaTeX, Diagrams, Maps). */
export const EPHEMERAL_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Maximum entries before triggering lazy cleanup in ephemeral stores. */
export const EPHEMERAL_MAX_SIZE = 200;

/** Maximum length for user-submitted code (JavaScript, Python). */
export const MAX_CODE_LENGTH = 100_000;

/** Maximum length for user-submitted shell commands. */
export const MAX_COMMAND_LENGTH = 10_000;
