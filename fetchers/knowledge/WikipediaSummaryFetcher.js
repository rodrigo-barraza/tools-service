import { WIKIPEDIA_SUMMARY_BASE_URL } from "../../constants.js";

/**
 * Wikipedia REST API fetcher (on-demand summaries).
 * https://en.wikipedia.org/api/rest_v1/ — no auth, fully open.
 * Distinct from the existing WikipediaFetcher (trending pages poller).
 * This fetcher provides on-demand article summaries and "On This Day" data.
 */

// ─── Get Article Summary ───────────────────────────────────────────

/**
 * Get a summary of a Wikipedia article by title.
 * Returns the lead section with extract text, thumbnail, and content URLs.
 * @param {string} title - Article title (spaces or underscores)
 * @returns {Promise<object>}
 */
export async function getArticleSummary(title) {
  const encoded = encodeURIComponent(title.replace(/\s+/g, "_"));
  const url = `${WIKIPEDIA_SUMMARY_BASE_URL}/page/summary/${encoded}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (res.status === 404) {
    return { found: false, title, message: "Article not found" };
  }
  if (!res.ok) {
    throw new Error(`Wikipedia REST API → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    found: true,
    title: data.title,
    displayTitle: data.displaytitle || data.title,
    extract: data.extract || null,
    description: data.description || null,
    thumbnail: data.thumbnail?.source || null,
    originalImage: data.originalimage?.source || null,
    pageUrl: data.content_urls?.desktop?.page || null,
    lastModified: data.timestamp || null,
    type: data.type || null,
    language: data.lang || "en",
  };
}

// ─── On This Day ───────────────────────────────────────────────────

/**
 * Get historical events that happened on this day.
 * @param {string} [type="selected"] - "selected", "births", "deaths", "events", "holidays"
 * @param {number} [month] - Month (1-12), defaults to today
 * @param {number} [day] - Day (1-31), defaults to today
 * @returns {Promise<object>}
 */
export async function getOnThisDay(type = "selected", month, day) {
  const now = new Date();
  const m = month || now.getMonth() + 1;
  const d = day || now.getDate();
  const padM = String(m).padStart(2, "0");
  const padD = String(d).padStart(2, "0");

  const url = `${WIKIPEDIA_SUMMARY_BASE_URL}/feed/onthisday/${type}/${padM}/${padD}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Wikipedia On This Day → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const key = Object.keys(data)[0]; // "selected", "births", etc.
  const entries = data[key] || [];

  return {
    date: `${padM}-${padD}`,
    type,
    count: entries.length,
    events: entries.slice(0, 20).map((e) => ({
      year: e.year || null,
      text: e.text || null,
      pages: (e.pages || []).slice(0, 3).map((p) => ({
        title: p.title,
        description: p.description || null,
        extract: p.extract || null,
        thumbnail: p.thumbnail?.source || null,
        url: p.content_urls?.desktop?.page || null,
      })),
    })),
  };
}
