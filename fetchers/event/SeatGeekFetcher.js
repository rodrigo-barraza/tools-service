import { days } from "@rodrigo-barraza/utilities-library";
import CONFIG from "../../config.js";
import {
  EVENT_SOURCES,
  SEATGEEK_CATEGORY_MAP,
  EVENT_CATEGORIES,
} from "../../constants.js";

const BASE_URL = "https://api.seatgeek.com/2/events";

/**
 * Map SeatGeek taxonomy name to our normalized category.
 */
function normalizeCategory(taxonomies) {
  if (!taxonomies || taxonomies.length === 0) {
    return EVENT_CATEGORIES.OTHER;
  }

  // Check parent taxonomy first, then specific
  for (const tax of taxonomies) {
    const parentName = tax.parent_id ? null : tax.name?.toLowerCase();
    if (parentName && SEATGEEK_CATEGORY_MAP[parentName]) {
      return SEATGEEK_CATEGORY_MAP[parentName];
    }
  }

  // Fallback: check any taxonomy name
  for (const tax of taxonomies) {
    const name = tax.name?.toLowerCase();
    if (name && SEATGEEK_CATEGORY_MAP[name]) {
      return SEATGEEK_CATEGORY_MAP[name];
    }
  }

  return EVENT_CATEGORIES.OTHER;
}

/**
 * Extract genre strings from SeatGeek taxonomies and performers.
 */
function extractGenres(event) {
  const genres = new Set();

  if (event.taxonomies) {
    for (const tax of event.taxonomies) {
      if (tax.name) genres.add(tax.name);
    }
  }

  if (event.performers) {
    for (const performer of event.performers) {
      if (performer.genres) {
        for (const genre of performer.genres) {
          if (genre.name) genres.add(genre.name);
        }
      }
    }
  }

  return [...genres];
}

/**
 * Extract venue info from SeatGeek event.
 */
function extractVenue(venue) {
  if (!venue) {
    return {
      name: null,
      address: null,
      city: null,
      state: null,
      country: null,
      latitude: null,
      longitude: null,
    };
  }

  return {
    name: venue.name || null,
    address: venue.address || null,
    city: venue.city || null,
    state: venue.state || null,
    country: venue.country || null,
    latitude: venue.location?.lat ?? null,
    longitude: venue.location?.lon ?? null,
  };
}

/**
 * Extract price range from SeatGeek event stats.
 */
function extractPriceRange(event) {
  const stats = event.stats;
  if (!stats) return null;

  const min = stats.lowest_price ?? stats.lowest_sg_base_price;
  const max = stats.highest_price ?? null;

  if (min === null && max === null) return null;

  return {
    min: min ?? null,
    max: max ?? null,
    currency: "USD",
  };
}

/**
 * Normalize a single SeatGeek event to our unified schema.
 */
function normalizeEvent(event) {
  const performers = event.performers || [];
  const bestImage = performers[0]?.image || performers[0]?.images?.huge || null;

  return {
    sourceId: String(event.id),
    source: EVENT_SOURCES.SEATGEEK,
    name: event.title || event.short_title,
    description: event.description || null,
    url: event.url || null,
    imageUrl: bestImage,
    startDate: event.datetime_utc ? new Date(event.datetime_utc + "Z") : null,
    endDate: event.enddatetime_utc
      ? new Date(event.enddatetime_utc + "Z")
      : null,
    venue: extractVenue(event.venue),
    category: normalizeCategory(event.taxonomies),
    genres: extractGenres(event),
    priceRange: extractPriceRange(event),
    status: event.announce_date ? "onsale" : "onsale",
    fetchedAt: new Date(),
  };
}

/**
 * Fetch events from SeatGeek API v2.
 * Searches within the configured radius of the configured lat/lng.
 * Paginates through all available pages.
 */
export async function fetchSeatGeekEvents() {
  if (!CONFIG.SEATGEEK_CLIENT_ID) {
    throw new Error("SEATGEEK_CLIENT_ID is not configured");
  }

  const now = new Date();
  const endDate = new Date(now.getTime() + days(30));

  const params = new URLSearchParams({
    client_id: CONFIG.SEATGEEK_CLIENT_ID,
    lat: String(CONFIG.LATITUDE),
    lon: String(CONFIG.LONGITUDE),
    range: `${CONFIG.RADIUS_MILES}mi`,
    per_page: "100",
    sort: "datetime_utc.asc",
    "datetime_utc.gte": now.toISOString(),
    "datetime_utc.lte": endDate.toISOString(),
  });

  const allEvents = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    params.set("page", String(page));

    const response = await fetch(`${BASE_URL}?${params}`);

    if (!response.ok) {
      throw new Error(`SeatGeek API returned ${response.status}`);
    }

    const data = await response.json();
    const events = data.events || [];
    allEvents.push(...events.map(normalizeEvent));

    const meta = data.meta || {};
    const total = meta.total || 0;
    hasMore = allEvents.length < total && events.length > 0;
    page++;

    // Small delay between pages
    if (hasMore) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return allEvents;
}
