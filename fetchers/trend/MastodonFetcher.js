import { stripHtml } from "@rodrigo-barraza/utilities";
import {
  TREND_SOURCES as SOURCES,
  MASTODON_INSTANCES,
} from "../../constants.js";
import { normalizeName } from "../../utilities.js";
/**
 * Fetches trending tags from a single Mastodon instance.
 * @param {string} instance - Instance base URL (e.g. "https://mastodon.social")
 * @returns {Promise<Array>} Trending tag objects
 */
async function fetchTrendingTags(instance) {
  const res = await fetch(`${instance}/api/v1/trends/tags?limit=20`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  return res.json();
}
/**
 * Fetches trending statuses (posts) from a single Mastodon instance.
 * @param {string} instance - Instance base URL
 * @returns {Promise<Array>} Trending status objects
 */
async function fetchTrendingStatuses(instance) {
  const res = await fetch(`${instance}/api/v1/trends/statuses?limit=20`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  return res.json();
}
/**
 * Fetches trending content from Mastodon instances.
 * Aggregates both trending hashtags and trending statuses from
 * multiple instances, deduplicates, and normalizes.
 * No API key required — all public endpoints.
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchMastodonTrends() {
  const allTrends = [];
  const seenTags = new Set();
  const seenStatuses = new Set();
  for (const instance of MASTODON_INSTANCES) {
    // ── Trending Tags ──
    try {
      const tags = await fetchTrendingTags(instance);
      for (const tag of tags) {
        const name = `#${tag.name}`;
        const key = tag.name.toLowerCase();
        if (seenTags.has(key)) continue;
        seenTags.add(key);
        // Calculate total recent usage from the history array
        const recentUses = (tag.history || [])
          .slice(0, 2)
          .reduce((sum, day) => sum + parseInt(day.uses || 0, 10), 0);
        const recentAccounts = (tag.history || [])
          .slice(0, 2)
          .reduce((sum, day) => sum + parseInt(day.accounts || 0, 10), 0);
        allTrends.push({
          name,
          normalizedName: tag.name.toLowerCase(),
          source: SOURCES.MASTODON,
          volume: recentUses,
          url: tag.url || `${instance}/tags/${tag.name}`,
          context: {
            type: "hashtag",
            instance,
            accounts: recentAccounts,
            uses: recentUses,
          },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.warn(
        `[Mastodon] ⚠️ Tags from ${instance} failed: ${error.message}`,
      );
    }
    // ── Trending Statuses ──
    try {
      const statuses = await fetchTrendingStatuses(instance);
      for (const status of statuses) {
        if (seenStatuses.has(status.id)) continue;
        seenStatuses.add(status.id);
        const plainText = stripHtml(status.content || "");
        const name =
          plainText.length > 120 ? plainText.slice(0, 117) + "..." : plainText;
        if (!name) continue;
        const engagement =
          (status.favourites_count || 0) +
          (status.reblogs_count || 0) +
          (status.replies_count || 0);
        allTrends.push({
          name,
          normalizedName: normalizeName(name),
          source: SOURCES.MASTODON,
          volume: engagement,
          url: status.url || status.uri,
          context: {
            type: "status",
            instance,
            author: status.account?.display_name || status.account?.username,
            authorHandle: status.account?.acct,
            favourites: status.favourites_count || 0,
            reblogs: status.reblogs_count || 0,
            replies: status.replies_count || 0,
            createdAt: status.created_at,
          },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.warn(
        `[Mastodon] ⚠️ Statuses from ${instance} failed: ${error.message}`,
      );
    }
  }
  return allTrends.sort((a, b) => (b.volume || 0) - (a.volume || 0));
}
