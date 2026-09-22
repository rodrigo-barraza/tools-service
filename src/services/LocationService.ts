import { getDatabase } from "@rodrigo-barraza/utilities-library/service/mongo";
import { lookupIp } from "../fetchers/utility/IpInfoFetcher.ts";
import logger from "../logger.ts";
import { errorMessage } from "../utilities.ts";
import type {
  ResolvedLocation,
  LocationDocument,
  TideStation,
} from "../types/agentic.ts";

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

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const VALUE = 6371; // Earth's radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const haversineA =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return VALUE * 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));
}

// ─── NOAA: Find Nearest Tide Station ───────────────────────────

interface RawNoaaStation {
  id: string | number;
  name: string;
  state?: string | null;
  lat: number | null;
  lng: number | null;
}

async function findNearestTideStation(
  latitude: number,
  longitude: number,
): Promise<TideStation | null> {
  try {
    const response = await fetch(NOAA_STATIONS_URL);
    if (!response.ok) {
      logger.warn(`[Location] ⚠️ NOAA stations API → ${response.status}`);
      return null;
    }

    const json = (await response.json()) as { stations?: RawNoaaStation[] };
    const stations = json.stations || [];
    if (!stations.length) return null;

    let closest: TideStation | null = null;
    let minDist = Infinity;

    for (const station of stations) {
      if (station.lat == null || station.lng == null) continue;
      const distance = haversineDistanceKm(
        latitude,
        longitude,
        station.lat,
        station.lng,
      );
      if (distance < minDist) {
        minDist = distance;
        closest = {
          id: String(station.id),
          name: station.name,
          state: station.state || null,
          latitude: station.lat,
          longitude: station.lng,
          distanceKm: Math.round(distance * 100) / 100,
        };
      }
    }

    return closest;
  } catch (error: unknown) {
    logger.warn(
      `[Location] ⚠️ NOAA station lookup failed: ${errorMessage(error)}`,
    );
    return null;
  }
}

// ─── Resolve Location from IP ──────────────────────────────────

async function resolveLocationFromIp(): Promise<ResolvedLocation> {
  logger.info("[Location] 🌍 Resolving server location from public IP…");
  const ipData = await lookupIp("self");

  const { latitude, longitude } = ipData;

  if (latitude == null || longitude == null) {
    throw new Error(
      "IP geolocation did not return coordinates — cannot resolve location",
    );
  }

  logger.info(
    `[Location] 📍 IP resolved → ${ipData.city || "Unknown"}, ${ipData.region || ""} ` +
      `(${latitude}, ${longitude}) tz=${ipData.timezone}`,
  );

  // Find nearest NOAA tide prediction station
  const tideStation = await findNearestTideStation(latitude, longitude);

  if (tideStation) {
    logger.info(
      `[Location] 🌊 Nearest tide station → ${tideStation.name} ` +
        `(${tideStation.id}) — ${tideStation.distanceKm} km away`,
    );
  } else {
    logger.warn("[Location] ⚠️ No NOAA tide station found nearby");
  }

  return {
    latitude,
    longitude,
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

async function loadCachedLocation(): Promise<LocationDocument | null> {
  try {
    const database = getDatabase();
    return await database
      .collection<LocationDocument>(COLLECTION)
      .findOne({ _id: "current" });
  } catch {
    return null;
  }
}

async function saveCachedLocation(location: ResolvedLocation) {
  try {
    const database = getDatabase();
    const document: LocationDocument = {
      _id: "current",
      ...location,
      updatedAt: new Date(),
    };
    await database
      .collection<LocationDocument>(COLLECTION)
      .replaceOne({ _id: "current" }, document, { upsert: true });
  } catch (error: unknown) {
    logger.error(`[Location] ⚠️ Failed to persist: ${errorMessage(error)}`);
  }
}

// ─── Public: Initialise on Startup ─────────────────────────────

let resolvedLocation: ResolvedLocation | null = null;

/**
 * Initialise the location config.
 * - If a cached document exists and is < 24h old, use it.
 * - Otherwise, resolve from IP + NOAA and persist.
 *
 * Must be called after connectDatabase() and before the server starts listening.
 */
export async function initLocation() {
  const cached = await loadCachedLocation();

  if (cached?.updatedAt) {
    const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
    if (ageMs < MAX_AGE_MS) {
      const { _id, updatedAt: _updatedAt, ...rest } = cached;
      resolvedLocation = rest as ResolvedLocation;
      const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10;
      logger.info(
        `[Location] ✅ Using cached location (${ageHours}h old) → ` +
          `${(rest as ResolvedLocation).source?.city || "Unknown"} ` +
          `(${rest.latitude}, ${rest.longitude})`,
      );
      return resolvedLocation;
    }
    logger.info("[Location] 🔄 Cached location expired — refreshing…");
  }

  try {
    const fresh = await resolveLocationFromIp();
    await saveCachedLocation(fresh);
    resolvedLocation = fresh;
    logger.info("[Location] ✅ Location resolved and persisted");
    return resolvedLocation;
  } catch (error: unknown) {
    // Fall back to cached data even if expired (better than nothing)
    if (cached) {
      const { _id, updatedAt: _updatedAt, ...rest } = cached;
      resolvedLocation = rest as ResolvedLocation;
      logger.warn(
        `[Location] ⚠️ Refresh failed (${errorMessage(error)}), using stale cache`,
      );
      return resolvedLocation;
    }
    throw new Error(`Location resolution failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
