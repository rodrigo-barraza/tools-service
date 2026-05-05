import { stripHtml, normalizeName } from "@rodrigo-barraza/utilities";
import { TREND_SOURCES as SOURCES, TREND_CATEGORIES } from "../../constants.js";
const TVMAZE_SCHEDULE_URL = "https://api.tvmaze.com/schedule";
/**
 * Fetches today's TV schedule from TVMaze for US and CA.
 * Free API, no key required. Groups shows by popularity.
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchTVMazeTrends() {
  const today = new Date().toISOString().split("T")[0];
  const countries = ["US", "CA"];
  const allShows = [];
  for (const country of countries) {
    try {
      const url = `${TVMAZE_SCHEDULE_URL}?country=${country}&date=${today}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[TVMaze] ❌ ${country}: ${res.status}`);
        continue;
      }
      const episodes = await res.json();
      allShows.push(...episodes.map((ep) => ({ ...ep, country })));
    } catch (error) {
      console.error(`[TVMaze] ❌ ${country}: ${error.message}`);
    }
  }
  // Deduplicate shows by show ID (same show airs in both countries)
  const showMap = new Map();
  for (const ep of allShows) {
    const show = ep.show || ep._embedded?.show;
    if (!show) continue;
    const showId = show.id;
    if (!showMap.has(showId)) {
      showMap.set(showId, {
        show,
        episodes: [],
        rating: show.rating?.average || 0,
        weight: show.weight || 0,
      });
    }
    showMap.get(showId).episodes.push(ep);
  }
  // Sort by weight (TVMaze's popularity metric), take top 30
  const topShows = Array.from(showMap.values())
    .sort((a, b) => b.weight - a.weight || b.rating - a.rating)
    .slice(0, 30);
  return topShows.map((entry) => {
    const show = entry.show;
    const ep = entry.episodes[0];
    return {
      name: show.name,
      normalizedName: normalizeName(show.name),
      source: SOURCES.TVMAZE,
      volume: entry.weight,
      url:
        show.officialSite ||
        show.url ||
        `https://www.tvmaze.com/shows/${show.id}`,
      context: {
        tvmazeId: show.id,
        tvmazeUrl: show.url,
        network: show.network?.name || show.webChannel?.name || null,
        genres: show.genres || [],
        rating: show.rating?.average || null,
        status: show.status,
        episode: ep
          ? {
              season: ep.season,
              number: ep.number,
              name: ep.name,
              airtime: ep.airtime,
            }
          : null,
        image: show.image?.medium || null,
        summary: show.summary
          ? stripHtml(show.summary).substring(0, 200)
          : null,
      },
      category: TREND_CATEGORIES.ENTERTAINMENT,
      timestamp: new Date().toISOString(),
    };
  });
}
