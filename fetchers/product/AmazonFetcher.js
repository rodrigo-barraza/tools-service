import * as cheerio from "cheerio";
import {
  AMAZON_CATEGORIES,
  PRODUCT_SOURCES,
  AMAZON_MAX_PRODUCTS_PER_CATEGORY,
} from "../../constants.js";
import { parsePrice } from "@rodrigo-barraza/utilities-library";
import {
  randomUserAgent,
  computeTrendingScore,
} from "../../utilities.js";
import rateLimiter from "../../services/RateLimiterService.js";

const BASE_URL = "https://www.amazon.com/Best-Sellers/zgbs";

/**
 * Scrape Amazon Best Sellers for a single category.
 */
async function scrapeCategory(slug, categoryName, unifiedCategory) {
  const url = `${BASE_URL}/${slug}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": randomUserAgent(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Amazon returned ${response.status} for ${categoryName}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const products = [];

  // Amazon Best Sellers grid items
  $("[data-asin]").each((_i, el) => {
    if (products.length >= AMAZON_MAX_PRODUCTS_PER_CATEGORY) return false;

    const $el = $(el);
    const asin = $el.attr("data-asin");
    if (!asin) return;

    // Extract product name — multiple possible selectors
    const name =
      $el.find(".p13n-sc-truncate-desktop-type2").text().trim() ||
      $el.find("._cDEzb_p13n-sc-css-line-clamp-3_g3dy1").text().trim() ||
      $el.find(".a-link-normal span div").first().text().trim() ||
      $el.find("[class*='truncate']").first().text().trim();

    if (!name) return;

    // Extract rank from the rank number badge
    const rankText =
      $el.find(".zg-bdg-text").text().trim() ||
      $el.find("[class*='zg-badge-text']").text().trim();
    const rank = rankText
      ? parseInt(rankText.replace("#", ""), 10)
      : products.length + 1;

    // Extract price
    const priceText = $el
      .find(
        ".p13n-sc-price, ._cDEzb_p13n-sc-price_3mJ9Z, .a-price .a-offscreen",
      )
      .first()
      .text()
      .trim();
    const price = parsePrice(priceText);

    // Extract rating
    const ratingText =
      $el.find(".a-icon-alt").first().text().trim() ||
      $el.find("[class*='a-star']").attr("class") ||
      "";
    const ratingMatch = ratingText.match(/([\d.]+)\s*out of/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Extract review count
    const reviewText =
      $el.find(".a-size-small .a-link-normal").text().trim() ||
      $el.find("[class*='review'] .a-size-small").text().trim();
    const reviewCount = reviewText
      ? parseInt(reviewText.replace(/[^0-9]/g, ""), 10) || null
      : null;

    // Extract image
    const imageUrl =
      $el.find("img.a-dynamic-image, img[data-a-dynamic-image]").attr("src") ||
      $el.find("img").first().attr("src") ||
      null;

    // Build product URL
    const productUrl = `https://www.amazon.com/dp/${asin}`;

    const product = {
      sourceId: asin,
      source: PRODUCT_SOURCES.AMAZON,
      name,
      category: unifiedCategory,
      sourceCategory: categoryName,
      rank,
      price,
      currency: "USD",
      rating,
      reviewCount,
      imageUrl,
      productUrl,
      description: null,
      trendingScore: 0,
      fetchedAt: new Date(),
    };
    product.trendingScore = computeTrendingScore(product);
    products.push(product);
  });

  return products;
}

/**
 * Fetch Amazon Best Sellers across all configured categories.
 * Rate-limited to respect Amazon's servers.
 */
export async function fetchAllAmazonBestSellers() {
  const allProducts = [];

  for (const cat of AMAZON_CATEGORIES) {
    try {
      const products = await scrapeCategory(cat.slug, cat.name, cat.unified);
      allProducts.push(...products);
      console.log(`[Amazon] ✅ ${cat.name}: ${products.length} products`);
    } catch (error) {
      console.error(`[Amazon] ❌ ${cat.name}: ${error.message}`);
    }

    // Rate limit between category requests
    await rateLimiter.wait("AMAZON");
  }

  return allProducts;
}
