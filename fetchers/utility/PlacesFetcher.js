import CONFIG from "../../config.js";
import { buildLocalUrl } from "../../utilities.js";

const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/**
 * Google Places (New) on-demand POI fetcher.
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * Uses the same GOOGLE_PLACES_API_KEY already in config for the event-venue collector.
 * Results are cached in memory for 30 minutes keyed by normalized params.
 */

// ─── In-Memory Cache ───────────────────────────────────────────────

const placesCache = new Map();
const CACHE_TTL_MS = 1_800_000; // 30 minutes
const MAX_CACHE_SIZE = 500;

function evictStaleEntries() {
  if (placesCache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of placesCache) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      placesCache.delete(key);
    }
  }
  if (placesCache.size > MAX_CACHE_SIZE) {
    const entries = [...placesCache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt,
    );
    const toRemove = Math.floor(entries.length / 2);
    for (let i = 0; i < toRemove; i++) {
      placesCache.delete(entries[i][0]);
    }
  }
}

// ─── Shared Field Mask ─────────────────────────────────────────────

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.currentOpeningHours",
  "places.editorialSummary",
  "places.nationalPhoneNumber",
].join(",");

// ─── Normalize Response ───────────────────────────────────────────

function normalizePlace(place) {
  return {
    id: place.id,
    name: place.displayName?.text || null,
    type: place.primaryTypeDisplayName?.text || place.primaryType || null,
    types: (place.types || []).slice(0, 8),
    address: place.formattedAddress || null,
    shortAddress: place.shortFormattedAddress || null,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    priceLevel: place.priceLevel || null,
    phone: place.nationalPhoneNumber || null,
    website: place.websiteUri || null,
    googleMapsUrl: place.googleMapsUri || null,
    description: place.editorialSummary?.text || null,
    openNow: place.currentOpeningHours?.openNow ?? null,
  };
}

// ─── Static Map URL Builder ───────────────────────────────────────

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
const MARKER_COLORS = ["red", "blue", "green", "purple", "orange", "yellow"];

/**
 * Build a Google Maps Static API URL with labeled markers for each place.
 * https://developers.google.com/maps/documentation/maps-static/start
 *
 * @param {object[]} places - Array of normalized place objects
 * @param {object}   center - { latitude, longitude }
 * @param {object}  [opts]
 * @param {string}  [opts.size]    - Image dimensions (default: "800x400")
 * @param {number}  [opts.zoom]    - Zoom level (omit to let Google auto-fit)
 * @param {string}  [opts.maptype] - roadmap | satellite | terrain | hybrid
 * @returns {string|null} Static map URL or null if no places
 */
export function buildStaticMapUrl(places, center, { size = "800x400", zoom, maptype = "roadmap" } = {}) {
  if (!places.length || !CONFIG.GOOGLE_API_KEY) return null;

  const params = new URLSearchParams({
    size,
    maptype,
    scale: "2", // Retina/HiDPI
    key: CONFIG.GOOGLE_API_KEY,
  });

  if (zoom != null) {
    params.set("zoom", String(zoom));
  }

  // Add numbered markers
  const markerParams = places
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p, i) => {
      const color = MARKER_COLORS[i % MARKER_COLORS.length];
      const label = String(i + 1);
      return `markers=color:${color}|label:${label}|${p.latitude},${p.longitude}`;
    })
    .join("&");

  return `${STATIC_MAP_URL}?${params.toString()}&${markerParams}`;
}

/**
 * Build the embed URL for the interactive map served by UtilityRoutes.
 * @param {object[]} places - Array of normalized place objects
 * @returns {string|null}
 */
export function buildMapEmbedUrl(places) {
  if (!places.length || !CONFIG.GOOGLE_API_KEY) return null;
  const markers = places
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      name: p.name || null,
      address: p.shortAddress || p.address || null,
    }));
  return buildLocalUrl("utility/map/embed", { markers: JSON.stringify(markers) });
}

// ─── Nearby Search ────────────────────────────────────────────────

/**
 * Search for nearby places by type.
 * @param {object} opts
 * @param {string}   opts.type     - Google Places type (e.g. "restaurant", "cafe", "gas_station")
 * @param {number}  [opts.latitude]  - Center latitude (defaults to CONFIG)
 * @param {number}  [opts.longitude] - Center longitude (defaults to CONFIG)
 * @param {number}  [opts.radius]    - Radius in meters (default: 5000, max: 50000)
 * @param {number}  [opts.limit]     - Max results (default: 20, max: 20)
 * @returns {Promise<object>}
 */
export async function searchNearbyPlaces({
  type,
  latitude,
  longitude,
  radius = 5000,
  limit = 20,
} = {}) {
  if (!CONFIG.GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  }
  if (!type) {
    throw new Error("'type' is required for nearby search");
  }

  const lat = latitude ?? CONFIG.LATITUDE;
  const lng = longitude ?? CONFIG.LONGITUDE;
  const rad = Math.min(Math.max(radius, 100), 50000);
  const max = Math.min(Math.max(limit, 1), 20);

  // Cache check
  const cacheKey = `nearby:${type}:${lat}:${lng}:${rad}:${max}`;
  const cached = placesCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const body = {
    includedTypes: [type],
    maxResultCount: max,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: rad,
      },
    },
  };

  const response = await fetch(NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": CONFIG.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Google Places Nearby API → ${response.status}: ${errText}`,
    );
  }

  const data = await response.json();
  const places = (data.places || []).map(normalizePlace);

  const result = {
    count: places.length,
    type,
    center: { latitude: lat, longitude: lng },
    radiusMeters: rad,
    places,
    fetchedAt: new Date().toISOString(),
  };

  evictStaleEntries();
  placesCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

// ─── Text Search ──────────────────────────────────────────────────

/**
 * Search for places using a natural language text query.
 * @param {object} opts
 * @param {string}   opts.query      - Text query (e.g. "best sushi in Vancouver")
 * @param {number}  [opts.latitude]  - Bias towards this lat (defaults to CONFIG)
 * @param {number}  [opts.longitude] - Bias towards this lng (defaults to CONFIG)
 * @param {number}  [opts.radius]    - Bias radius in meters (default: 10000)
 * @param {number}  [opts.limit]     - Max results (default: 10, max: 20)
 * @returns {Promise<object>}
 */
export async function searchPlacesByText({
  query,
  latitude,
  longitude,
  radius = 10000,
  limit = 10,
} = {}) {
  if (!CONFIG.GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  }
  if (!query) {
    throw new Error("'query' is required for text search");
  }

  const lat = latitude ?? CONFIG.LATITUDE;
  const lng = longitude ?? CONFIG.LONGITUDE;
  const rad = Math.min(Math.max(radius, 100), 50000);
  const max = Math.min(Math.max(limit, 1), 20);

  // Cache check
  const cacheKey = `text:${query.toLowerCase().trim()}:${lat}:${lng}:${rad}:${max}`;
  const cached = placesCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const body = {
    textQuery: query,
    maxResultCount: max,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: rad,
      },
    },
  };

  const response = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": CONFIG.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Google Places Text Search API → ${response.status}: ${errText}`,
    );
  }

  const data = await response.json();
  const places = (data.places || []).map(normalizePlace);

  const result = {
    count: places.length,
    query,
    center: { latitude: lat, longitude: lng },
    radiusMeters: rad,
    places,
    fetchedAt: new Date().toISOString(),
  };

  evictStaleEntries();
  placesCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}
