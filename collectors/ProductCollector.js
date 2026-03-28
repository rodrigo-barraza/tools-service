import {
  BESTBUY_INTERVAL_MS,
  AMAZON_INTERVAL_MS,
  PRODUCTHUNT_PRODUCT_INTERVAL_MS,
  EBAY_INTERVAL_MS,
  ETSY_INTERVAL_MS,
  BESTBUY_CA_AVAILABILITY_INTERVAL_MS,
  COSTCO_INTERVAL_MS,
} from "../constants.js";
import { upsertProducts } from "../models/Product.js";
import { fetchAllBestBuyTrending } from "../fetchers/product/BestBuyFetcher.js";
import { fetchAllAmazonBestSellers } from "../fetchers/product/AmazonFetcher.js";
import { fetchProductHuntTrending } from "../fetchers/product/ProductHuntFetcher.js";
import { fetchAllEbayTrending } from "../fetchers/product/EbayFetcher.js";
import { fetchEtsyTrending } from "../fetchers/product/EtsyFetcher.js";
import { fetchBestBuyCAAvailability } from "../fetchers/product/BestBuyCAAvailabilityFetcher.js";
import {
  fetchAllCostcoUS,
  fetchAllCostcoCA,
} from "../fetchers/product/CostcoFetcher.js";
import { updateProducts, setProductError } from "../caches/ProductCache.js";
import {
  getWatchedSkus,
  getWatchlistMetadata,
  updateStatuses,
  setAvailabilityError,
} from "../caches/BestBuyCAAvailabilityCache.js";

// ─── Collector Factory ─────────────────────────────────────────────

/**
 * Create a standard product collector that fetches, caches, and persists.
 * @param {string} label - Log label (e.g. "[BestBuy]")
 * @param {string} source - Cache source key (e.g. "bestbuy")
 * @param {Function} fetchFn - Async function returning product array
 */
function createProductCollector(label, source, fetchFn) {
  return async function () {
    try {
      const products = await fetchFn();
      updateProducts(source, products);
      const result = await upsertProducts(products);
      console.log(
        `[${label}] ✅ ${products.length} products | ${result.upserted} new, ${result.modified} updated`,
      );
    } catch (error) {
      setProductError(source, error);
      console.error(`[${label}] ❌ ${error.message}`);
    }
  };
}

// ─── Collectors ────────────────────────────────────────────────────

const collectBestBuy = createProductCollector(
  "BestBuy",
  "bestbuy",
  fetchAllBestBuyTrending,
);
const collectAmazon = createProductCollector(
  "Amazon",
  "amazon",
  fetchAllAmazonBestSellers,
);
const collectProductHunt = createProductCollector(
  "ProductHunt",
  "producthunt",
  fetchProductHuntTrending,
);
const collectEbay = createProductCollector(
  "eBay",
  "ebay",
  fetchAllEbayTrending,
);
const collectEtsy = createProductCollector("Etsy", "etsy", fetchEtsyTrending);
const collectCostcoUS = createProductCollector(
  "Costco US",
  "costco_us",
  fetchAllCostcoUS,
);
const collectCostcoCA = createProductCollector(
  "Costco CA",
  "costco_ca",
  fetchAllCostcoCA,
);

// Best Buy CA Availability — unique pattern (watchlist-driven, not standard product flow)
async function collectBestBuyCAAvailability() {
  try {
    const skus = getWatchedSkus();
    if (!skus.length) return;
    const metadata = getWatchlistMetadata();
    const { results, errors } = await fetchBestBuyCAAvailability(
      skus,
      metadata,
    );
    updateStatuses(results);
    const inStock = results.filter((r) => r.inStock).length;
    console.log(
      `[BestBuy CA] ✅ ${results.length} SKUs checked | ${inStock} in stock`,
    );
    if (errors.length) {
      console.warn(
        `[BestBuy CA] ⚠️ ${errors.length} batch error(s): ${errors[0]}`,
      );
    }
  } catch (error) {
    setAvailabilityError(error);
    console.error(`[BestBuy CA] ❌ ${error.message}`);
  }
}

export function startProductCollectors() {
  collectBestBuy();
  setTimeout(collectAmazon, 15_000);
  setTimeout(collectProductHunt, 20_000);
  setTimeout(collectEbay, 25_000);
  setTimeout(collectEtsy, 30_000);
  setTimeout(collectBestBuyCAAvailability, 35_000);
  setTimeout(collectCostcoUS, 40_000);
  setTimeout(collectCostcoCA, 45_000);

  setInterval(collectBestBuy, BESTBUY_INTERVAL_MS);
  setInterval(collectAmazon, AMAZON_INTERVAL_MS);
  setInterval(collectProductHunt, PRODUCTHUNT_PRODUCT_INTERVAL_MS);
  setInterval(collectEbay, EBAY_INTERVAL_MS);
  setInterval(collectEtsy, ETSY_INTERVAL_MS);
  setInterval(
    collectBestBuyCAAvailability,
    BESTBUY_CA_AVAILABILITY_INTERVAL_MS,
  );
  setInterval(collectCostcoUS, COSTCO_INTERVAL_MS);
  setInterval(collectCostcoCA, COSTCO_INTERVAL_MS);

  console.log("📦 Product collectors started");
}
