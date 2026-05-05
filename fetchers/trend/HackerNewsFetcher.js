import { normalizeName } from "@rodrigo-barraza/utilities";
import {
  TREND_SOURCES as SOURCES,
  HACKERNEWS_TOP_STORY_LIMIT,
  TREND_CATEGORIES,
} from "../../constants.js";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";

/**
 * Fetches a single Hacker News item by ID.
 * @param {number} id - Item ID
 * @returns {Promise<object|null>} Item data or null
 */
async function fetchItem(id) {
  const res = await fetch(`${HN_API_BASE}/item/${id}.json`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetches the top stories from Hacker News.
 * Uses the Firebase-based HN API (completely free, no auth required).
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchHackerNewsTrends() {
  const res = await fetch(`${HN_API_BASE}/topstories.json`);
  if (!res.ok) {
    throw new Error(`HN API returned ${res.status}: ${res.statusText}`);
  }

  const storyIds = await res.json();
  const topIds = storyIds.slice(0, HACKERNEWS_TOP_STORY_LIMIT);

  // Fetch all stories in parallel
  const stories = await Promise.all(topIds.map(fetchItem));

  return stories
    .filter((s) => s && s.title)
    .map((story, index) => ({
      name: story.title,
      normalizedName: normalizeName(story.title),
      source: SOURCES.HACKERNEWS,
      volume: story.score || 0,
      url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
      context: {
        hnId: story.id,
        hnUrl: `https://news.ycombinator.com/item?id=${story.id}`,
        author: story.by,
        commentCount: story.descendants || 0,
        rank: index + 1,
        created: new Date((story.time || 0) * 1000).toISOString(),
      },
      category: TREND_CATEGORIES.TECHNOLOGY,
      timestamp: new Date().toISOString(),
    }));
}
