import { normalizeName } from "@rodrigo-barraza/utilities-library";
import CONFIG from "../../config.js";
import { TREND_SOURCES as SOURCES, X_WOEIDS } from "../../constants.js";

/**
 * Fetches trending topics from X (Twitter) for a given WOEID.
 * Uses X API v1.1 trends/place endpoint (available on free tier, 100 reads/month).
 * Called once per day to stay within free tier limits.
 *
 * @param {number} woeid - Where On Earth ID (default: worldwide)
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchXTrends(woeid = X_WOEIDS.WORLDWIDE) {
  if (!CONFIG.X_BEARER_TOKEN) {
    throw new Error("X_BEARER_TOKEN not configured");
  }

  const url = `https://api.x.com/1.1/trends/place.json?id=${woeid}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CONFIG.X_BEARER_TOKEN}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`X API returned ${res.status}: ${body}`);
  }

  const data = await res.json();
  const trendData = data?.[0];
  if (!trendData) {
    throw new Error("X API returned empty response");
  }

  const location = trendData.locations?.[0]?.name || "Unknown";
  const asOf = trendData.as_of || new Date().toISOString();

  return (trendData.trends || []).map((trend) => ({
    name: trend.name,
    normalizedName: normalizeName(trend.name.replace(/^#/, "")),
    source: SOURCES.X,
    volume: trend.tweet_volume || 0,
    url:
      trend.url || `https://x.com/search?q=${encodeURIComponent(trend.name)}`,
    context: {
      location,
      woeid,
      asOf,
      promotedContent: trend.promoted_content || null,
    },
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Fetches trends from multiple locations and deduplicates.
 * Uses 1 API call per location — keep locations minimal on free tier.
 * @returns {Promise<Array>} Combined normalized trend objects
 */
export async function fetchAllXTrends() {
  if (!CONFIG.X_BEARER_TOKEN) {
    throw new Error("X_BEARER_TOKEN not configured");
  }

  // On free tier (100/month), just fetch worldwide to conserve reads
  const allTrends = [];

  try {
    const trends = await fetchXTrends(X_WOEIDS.WORLDWIDE);
    allTrends.push(...trends);
  } catch (error) {
    console.error(`[X] ❌ Worldwide: ${error.message}`);
  }

  return allTrends;
}
