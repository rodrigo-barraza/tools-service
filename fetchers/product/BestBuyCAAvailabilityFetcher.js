import { chunk } from "@rodrigo-barraza/utilities-library";
import {
  BESTBUY_CA_AVAILABILITY_BASE_URL,
  BESTBUY_CA_MAX_SKUS_PER_REQUEST,
} from "../../constants.js";
import { randomUserAgent } from "../../utilities.js";
import rateLimiter from "../../services/RateLimiterService.js";
/**
 * Build the Best Buy CA availability URL for a batch of SKUs.
 * SKUs are pipe-delimited and URL-encoded.
 */
function buildAvailabilityUrl(skus) {
  const skuParam = skus.join("%7C"); // pipe = %7C
  return `${BESTBUY_CA_AVAILABILITY_BASE_URL}?accept=application%2Fvnd.bestbuy.standardproduct.v1%2Bjson&skus=${skuParam}`;
}
/**
 * Normalize a single availability entry from the Best Buy CA API.
 * @param {object} availability - Raw availability object from the API
 * @param {object|null} metadata - Optional SKU metadata { name, brand, category }
 */
function normalizeAvailability(availability, metadata = null) {
  const sku = availability.sku;
  return {
    sku,
    name: metadata?.name || null,
    brand: metadata?.brand || null,
    category: metadata?.category || null,
    shipping: {
      purchasable: availability.shipping?.purchasable ?? false,
      status: availability.shipping?.status || null,
      quantityRemaining: availability.shipping?.quantityRemaining ?? null,
      orderLimit: availability.shipping?.orderLimit ?? null,
      isFreeShippingEligible:
        availability.shipping?.isFreeShippingEligible ?? false,
      isBackorderable: availability.shipping?.isBackorderable ?? false,
      hasActiveCountdown: availability.shipping?.hasActiveCountdown ?? false,
    },
    pickup: {
      purchasable: availability.pickup?.purchasable ?? false,
      status: availability.pickup?.status || null,
    },
    sellerId: availability.sellerId || null,
    saleChannelExclusivity: availability.saleChannelExclusivity || null,
    inStock:
      availability.shipping?.purchasable === true ||
      availability.pickup?.purchasable === true,
    url: `https://www.bestbuy.ca/en-ca/product/${sku}`,
    checkedAt: new Date(),
  };
}
/**
 * Fetch availability for an array of SKUs from Best Buy Canada.
 * Automatically batches to stay within URL / request limits.
 * @param {string[]} skus - Array of SKU strings
 * @param {object} skuMetadata - Map of SKU → { name, brand, category }
 * @returns {{ results: object[], errors: string[] }}
 */
export async function fetchBestBuyCAAvailability(skus, skuMetadata = {}) {
  if (!skus.length) return { results: [], errors: [] };
  const batches = chunk(skus, BESTBUY_CA_MAX_SKUS_PER_REQUEST);
  const allResults = [];
  const errors = [];
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await rateLimiter.wait("BESTBUY_CA");
    const batch = batches[i];
    const url = buildAvailabilityUrl(batch);
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": randomUserAgent(),
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        const text = await response.text();
        errors.push(
          `Batch ${i + 1}/${batches.length}: HTTP ${response.status} — ${text.slice(0, 200)}`,
        );
        continue;
      }
      const data = await response.json();
      const availabilities = data.availabilities || [];
      for (const avail of availabilities) {
        allResults.push(normalizeAvailability(avail, skuMetadata[avail.sku]));
      }
    } catch (error) {
      errors.push(`Batch ${i + 1}/${batches.length}: ${error.message}`);
    }
  }
  return { results: allResults, errors };
}
