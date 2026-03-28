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

export const COMMODITY_CATEGORIES = ASSET_CATEGORIES;

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

// Best Buy Canada — stock availability checker (public ecomm-api, no key required)
export const BESTBUY_CA_AVAILABILITY_INTERVAL_MS = 300_000; // 5 minutes
export const BESTBUY_CA_AVAILABILITY_BASE_URL =
  "https://www.bestbuy.ca/ecomm-api/availability/products";
export const BESTBUY_CA_MAX_SKUS_PER_REQUEST = 100;
export const BESTBUY_CA_REQUEST_DELAY_MS = 2_000; // 2 seconds between batches
export const BESTBUY_CA_DEFAULT_SKUS = {
  // ─── GPUs ────────────────────────────────────────────────────────
  18931348: { name: "GeForce RTX 5090 32GB", brand: "NVIDIA", category: "gpu" },
  18931347: { name: "GeForce RTX 5080 16GB", brand: "NVIDIA", category: "gpu" },
  18934178: { name: "GeForce RTX 5080 16GB", brand: "PNY", category: "gpu" },
  18931628: { name: "GeForce RTX 5080 Solid 16GB", brand: "ZOTAC", category: "gpu" },
  19193219: { name: "GeForce RTX 5070 12GB", brand: "NVIDIA", category: "gpu" },
  18934180: { name: "GeForce RTX 5070 Ti OC 16GB", brand: "PNY", category: "gpu" },
  18934179: { name: "GeForce RTX 5070 Ti ARGB 16GB", brand: "PNY", category: "gpu" },
  19183867: { name: "GeForce RTX 5070 Ti Ventus 3X OC 16GB", brand: "MSI", category: "gpu" },

  // ─── Consoles ────────────────────────────────────────────────────
  11028232: { name: "PlayStation 5 Pro Console", brand: "Sony", category: "console" },
  17477495: { name: "PlayStation 5 Slim Digital Edition", brand: "Sony", category: "console" },
  19422128: { name: "Xbox Series X 1TB Console", brand: "Microsoft", category: "console" },

  // ─── Phones ──────────────────────────────────────────────────────
  18925575: { name: "Galaxy S25 Ultra 256GB Titanium Black", brand: "Samsung", category: "phone" },
  18925576: { name: "Galaxy S25 Ultra 256GB Titanium Grey", brand: "Samsung", category: "phone" },
  18925577: { name: "Galaxy S25 Ultra 256GB Titanium Silverblue", brand: "Samsung", category: "phone" },
  18925578: { name: "Galaxy S25 Ultra 256GB Titanium Silverwhite", brand: "Samsung", category: "phone" },
  18925580: { name: "Galaxy S25 Ultra 512GB Titanium Grey", brand: "Samsung", category: "phone" },
  19321527: { name: "Pixel 9 Pro XL 256GB Obsidian", brand: "Google", category: "phone" },

  // ─── Laptops ─────────────────────────────────────────────────────
  15952669: { name: "MacBook Pro 16\" M4 Max 36GB/1TB", brand: "Apple", category: "laptop" },
  18619913: { name: "MacBook Pro 14\" M4 Pro 24GB/512GB", brand: "Apple", category: "laptop" },
  18619927: { name: "MacBook Pro 16\" M4 Pro 24GB/512GB", brand: "Apple", category: "laptop" },

  // ─── Tablets ─────────────────────────────────────────────────────
  17978053: { name: "iPad Pro 13\" M4 256GB Wi-Fi+5G", brand: "Apple", category: "tablet" },

  // ─── Headphones & Audio ──────────────────────────────────────────
  16162187: { name: "WH-1000XM5 Over-Ear NC Black", brand: "Sony", category: "audio" },
  16162186: { name: "WH-1000XM5 Over-Ear NC Silver", brand: "Sony", category: "audio" },
  17543757: { name: "AirPods Pro 2nd Gen USB-C", brand: "Apple", category: "audio" },

  // ─── VR ──────────────────────────────────────────────────────────
  18473493: { name: "Quest 3 512GB VR Headset", brand: "Meta", category: "vr" },
  17162202: { name: "Quest 3 128GB VR Headset", brand: "Meta", category: "vr" },

  // ─── Monitors & TVs ──────────────────────────────────────────────
  10924894: { name: "32\" Odyssey OLED G8 4K 240Hz", brand: "Samsung", category: "monitor" },

  // ─── Gaming Accessories ──────────────────────────────────────────
  17668451: { name: "DualSense Wireless Controller White", brand: "Sony", category: "gaming-accessory" },
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
};

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
//  SHARED
// ═══════════════════════════════════════════════════════════════

export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];
