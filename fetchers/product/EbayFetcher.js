import { TokenManager } from "@rodrigo-barraza/utilities-library/node";
import CONFIG from "../../config.js";
import { PRODUCT_SOURCES, EBAY_CATEGORIES } from "../../constants.js";
import { computeTrendingScore } from "../../utilities.js";
import rateLimiter from "../../services/RateLimiterService.js";
const BASE_URL = "https://api.ebay.com/buy/browse/v1";
// ─── OAuth2 Token Management ──────────────────────────────────────
const ebayTokenManager = new TokenManager(async () => {
  const credentials = Buffer.from(
    `${CONFIG.EBAY_CLIENT_ID}:${CONFIG.EBAY_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    },
  );
  if (!response.ok) {
    throw new Error(`eBay OAuth failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    token: data.access_token,
    expiresInMs: 7_000_000, // ~2 hours (eBay tokens last ~2hrs)
  };
});
/**
 * Search eBay for popular items in a category, sorted by most watched.
 */
async function fetchEbayCategoryTrending(token, category) {
  const params = new URLSearchParams({
    category_ids: category.id,
    sort: "-price",
    limit: "20",
    filter: "buyingOptions:{FIXED_PRICE},conditionIds:{1000}",
  });
  const response = await fetch(`${BASE_URL}/item_summary/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `eBay Browse API returned ${response.status} for ${category.name}`,
    );
  }
  const data = await response.json();
  const items = data.itemSummaries || [];
  return items.slice(0, 15).map((item, index) => {
    const product = {
      sourceId: item.itemId,
      source: PRODUCT_SOURCES.EBAY,
      name: item.title,
      category: category.unified,
      sourceCategory: category.name,
      rank: index + 1,
      price: item.price ? parseFloat(item.price.value) : null,
      currency: item.price?.currency || "USD",
      rating: null,
      reviewCount: null,
      imageUrl:
        item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
      productUrl: item.itemWebUrl || null,
      description: item.shortDescription || null,
      trendingScore: 0,
      fetchedAt: new Date(),
    };
    product.trendingScore = computeTrendingScore(product);
    return product;
  });
}
/**
 * Fetch trending products across all eBay categories.
 */
export async function fetchAllEbayTrending() {
  if (!CONFIG.EBAY_CLIENT_ID || !CONFIG.EBAY_CLIENT_SECRET) {
    throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET not configured");
  }
  const token = await ebayTokenManager.getToken();
  const allProducts = [];
  for (const cat of EBAY_CATEGORIES) {
    await rateLimiter.wait("EBAY");
    try {
      const products = await fetchEbayCategoryTrending(token, cat);
      allProducts.push(...products);
      console.log(`[eBay] ✅ ${cat.name}: ${products.length} products`);
    } catch (error) {
      console.error(`[eBay] ❌ ${cat.name}: ${error.message}`);
    }
  }
  return allProducts;
}
