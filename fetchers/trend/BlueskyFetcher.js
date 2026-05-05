import { normalizeName } from "@rodrigo-barraza/utilities";
import { TREND_SOURCES as SOURCES, TREND_CATEGORIES } from "../../constants.js";

const BLUESKY_API = "https://public.api.bsky.app/xrpc";

/**
 * Fetches trending content from Bluesky's public API.
 * No authentication needed for public endpoints.
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchBlueskyTrends() {
  // Fetch trending topics via the public search endpoint
  const trends = [];

  try {
    // Use getSuggestions for popular feeds (public endpoint)
    const feedRes = await fetch(
      `${BLUESKY_API}/app.bsky.unspecced.getPopularFeedGenerators?limit=25`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; Sun/Trends; github.com/rodrigo-barraza)",
        },
      },
    );

    if (feedRes.ok) {
      const feedData = await feedRes.json();
      const feeds = feedData.feeds || [];

      for (const feed of feeds) {
        trends.push({
          name: feed.displayName || feed.name || "Unknown Feed",
          normalizedName: normalizeName(feed.displayName || feed.name || ""),
          source: SOURCES.BLUESKY,
          volume: feed.likeCount || 0,
          url: `https://bsky.app/profile/${feed.creator?.handle || "unknown"}/feed/${feed.uri?.split("/").pop() || ""}`,
          context: {
            uri: feed.uri,
            description: feed.description || null,
            creator: feed.creator?.handle || null,
            creatorDisplayName: feed.creator?.displayName || null,
            likeCount: feed.likeCount || 0,
            avatar: feed.avatar || null,
          },
          category: TREND_CATEGORIES.CULTURE,
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    console.error(`[Bluesky] ❌ Feeds: ${error.message}`);
  }

  // Also try to get trending search terms
  try {
    const searchRes = await fetch(
      `${BLUESKY_API}/app.bsky.unspecced.getTaggedSuggestions`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; Sun/Trends; github.com/rodrigo-barraza)",
        },
      },
    );

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const suggestions = searchData.suggestions || [];

      for (const suggestion of suggestions) {
        if (suggestion.tag === "feed" || suggestion.tag === "user") continue;
        trends.push({
          name: suggestion.subject || suggestion.tag || "Unknown",
          normalizedName: normalizeName(
            suggestion.subject || suggestion.tag || "",
          ),
          source: SOURCES.BLUESKY,
          volume: 0,
          url: `https://bsky.app/search?q=${encodeURIComponent(suggestion.subject || suggestion.tag || "")}`,
          context: {
            tag: suggestion.tag,
            type: "suggested_topic",
          },
          category: null,
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    console.error(`[Bluesky] ❌ Suggestions: ${error.message}`);
  }

  return trends;
}
