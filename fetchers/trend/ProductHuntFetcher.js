import { normalizeName } from "@rodrigo-barraza/utilities-library";
import { TREND_SOURCES as SOURCES, TREND_CATEGORIES } from "../../constants.js";
import { randomUserAgent } from "../../utilities.js";

const PRODUCT_HUNT_URL = "https://www.producthunt.com";

/**
 * Scrapes Product Hunt's homepage for today's top products.
 * No API key required — HTML scraping.
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchProductHuntTrends() {
  const res = await fetch(PRODUCT_HUNT_URL, {
    headers: {
      "User-Agent": randomUserAgent(),
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`Product Hunt returned ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  return parseProductHunt(html);
}

/**
 * Parses Product Hunt HTML for product listings.
 * Falls back to JSON-LD structured data if available.
 */
function parseProductHunt(html) {
  const trends = [];

  // Try to extract from JSON-LD or Next.js __NEXT_DATA__
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );

  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const posts =
        nextData?.props?.pageProps?.posts ||
        nextData?.props?.pageProps?.data?.posts ||
        [];

      for (const post of posts.slice(0, 20)) {
        trends.push({
          name: post.name || post.title || "Unknown Product",
          normalizedName: normalizeName(post.name || post.title || ""),
          source: SOURCES.PRODUCTHUNT,
          volume: post.votesCount || post.votes_count || 0,
          url: post.url
            ? `${PRODUCT_HUNT_URL}${post.url}`
            : `${PRODUCT_HUNT_URL}/posts/${post.slug || ""}`,
          context: {
            tagline: post.tagline || null,
            description: (post.description || "").substring(0, 200) || null,
            votesCount: post.votesCount || post.votes_count || 0,
            commentsCount: post.commentsCount || post.comments_count || 0,
            thumbnail: post.thumbnail?.url || null,
            topics: (post.topics || []).map((t) => t.name || t).slice(0, 5),
          },
          category: TREND_CATEGORIES.TECHNOLOGY,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Fall through to HTML parsing
    }
  }

  // If no results from JSON, try HTML patterns
  if (trends.length === 0) {
    // Look for product links with data attributes
    const productRegex =
      /data-test="post-name"[^>]*>([^<]+)<|class="[^"]*styles_title[^"]*"[^>]*>([^<]+)</g;
    let match;

    while ((match = productRegex.exec(html)) !== null) {
      const name = (match[1] || match[2] || "").trim();
      if (!name) continue;

      trends.push({
        name,
        normalizedName: normalizeName(name),
        source: SOURCES.PRODUCTHUNT,
        volume: 0,
        url: PRODUCT_HUNT_URL,
        context: {},
        category: TREND_CATEGORIES.TECHNOLOGY,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return trends;
}
