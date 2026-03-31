import { getDB } from "../db.js";
import { lookupIp } from "../fetchers/utility/IpInfoFetcher.js";

// ═══════════════════════════════════════════════════════════════
//  Location Service — Dynamic Geolocation Resolution
// ═══════════════════════════════════════════════════════════════
// Resolves latitude, longitude, timezone, radiusMiles, and NOAA
// tide station from the server's public IP via ipinfo.io + NOAA
// Metadata API.  Persists results in MongoDB `location_config`
// and refreshes if the cached document is older than 24 hours.
// ═══════════════════════════════════════════════════════════════

const COLLECTION = "location_config";
const MAX_AGE_MS = 86_400_000; // 24 hours
const DEFAULT_RADIUS_MILES = 50;

const NOAA_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english";

// ─── Haversine Distance ────────────────────────────────────────

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── NOAA: Find Nearest Tide Station ───────────────────────────

async function findNearestTideStation(latitude, longitude) {
  try {
    const res = await fetch(NOAA_STATIONS_URL);
    if (!res.ok) {
      console.warn(`[Location] ⚠️ NOAA stations API → ${res.status}`);
      return null;
    }

    const json = await res.json();
    const stations = json.stations || [];
    if (!stations.length) return null;

    let closest = null;
    let minDist = Infinity;

    for (const s of stations) {
      if (s.lat == null || s.lng == null) continue;
      const d = haversineDistanceKm(latitude, longitude, s.lat, s.lng);
      if (d < minDist) {
        minDist = d;
        closest = {
          id: String(s.id),
          name: s.name,
          state: s.state || null,
          latitude: s.lat,
          longitude: s.lng,
          distanceKm: Math.round(d * 100) / 100,
        };
      }
    }

    return closest;
  } catch (err) {
    console.warn(`[Location] ⚠️ NOAA station lookup failed: ${err.message}`);
    return null;
  }
}

// ─── Resolve Location from IP ──────────────────────────────────

async function resolveLocationFromIp() {
  console.log("[Location] 🌍 Resolving server location from public IP…");
  const ipData = await lookupIp("self");

  if (!ipData.latitude || !ipData.longitude) {
    throw new Error(
      "IP geolocation did not return coordinates — cannot resolve location",
    );
  }

  console.log(
    `[Location] 📍 IP resolved → ${ipData.city || "Unknown"}, ${ipData.region || ""} ` +
      `(${ipData.latitude}, ${ipData.longitude}) tz=${ipData.timezone}`,
  );

  // Find nearest NOAA tide prediction station
  const tideStation = await findNearestTideStation(
    ipData.latitude,
    ipData.longitude,
  );

  if (tideStation) {
    console.log(
      `[Location] 🌊 Nearest tide station → ${tideStation.name} ` +
        `(${tideStation.id}) — ${tideStation.distanceKm} km away`,
    );
  } else {
    console.warn("[Location] ⚠️ No NOAA tide station found nearby");
  }

  return {
    latitude: ipData.latitude,
    longitude: ipData.longitude,
    timezone: ipData.timezone || "UTC",
    radiusMiles: DEFAULT_RADIUS_MILES,
    tideStationId: tideStation?.id || null,
    tideStationName: tideStation?.name || null,
    tideStationDistanceKm: tideStation?.distanceKm || null,
    source: {
      ip: ipData.ip,
      city: ipData.city,
      region: ipData.region,
      country: ipData.country,
    },
  };
}

// ─── Load / Save ───────────────────────────────────────────────

async function loadCachedLocation() {
  try {
    const db = getDB();
    return await db.collection(COLLECTION).findOne({ _id: "current" });
  } catch {
    return null;
  }
}

async function saveCachedLocation(location) {
  try {
    const db = getDB();
    const doc = {
      _id: "current",
      ...location,
      updatedAt: new Date(),
    };
    await db
      .collection(COLLECTION)
      .replaceOne({ _id: "current" }, doc, { upsert: true });
  } catch (err) {
    console.error(`[Location] ⚠️ Failed to persist: ${err.message}`);
  }
}

// ─── Public: Initialise on Startup ─────────────────────────────

/** @type {{ latitude: number, longitude: number, timezone: string, radiusMiles: number, tideStationId: string | null }} */
let resolvedLocation = null;

/**
 * Initialise the location config.
 * - If a cached document exists and is < 24h old, use it.
 * - Otherwise, resolve from IP + NOAA and persist.
 *
 * Must be called after connectDB() and before the server starts listening.
 * @returns {Promise<object>} The resolved location data.
 */
export async function initLocation() {
  const cached = await loadCachedLocation();

  if (cached?.updatedAt) {
    const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
    if (ageMs < MAX_AGE_MS) {
      const { _id, updatedAt: _updatedAt, ...rest } = cached;
      resolvedLocation = rest;
      const ageHours = Math.round(ageMs / 3_600_000 * 10) / 10;
      console.log(
        `[Location] ✅ Using cached location (${ageHours}h old) → ` +
          `${rest.source?.city || "Unknown"} ` +
          `(${rest.latitude}, ${rest.longitude})`,
      );
      return resolvedLocation;
    }
    console.log("[Location] 🔄 Cached location expired — refreshing…");
  }

  try {
    const fresh = await resolveLocationFromIp();
    await saveCachedLocation(fresh);
    resolvedLocation = fresh;
    console.log("[Location] ✅ Location resolved and persisted");
    return resolvedLocation;
  } catch (err) {
    // Fall back to cached data even if expired (better than nothing)
    if (cached) {
      const { _id, updatedAt: _updatedAt, ...rest } = cached;
      resolvedLocation = rest;
      console.warn(
        `[Location] ⚠️ Refresh failed (${err.message}), using stale cache`,
      );
      return resolvedLocation;
    }
    throw new Error(`Location resolution failed: ${err.message}`);
  }
}

/**
 * Get the currently resolved location.
 * @returns {object}
 */
export function getLocation() {
  if (!resolvedLocation) {
    throw new Error("Location not initialised — call initLocation() first");
  }
  return resolvedLocation;
}
