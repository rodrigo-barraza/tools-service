import { upsertSolarFlares } from "../models/SolarFlare.js";
import { upsertCmes } from "../models/Cme.js";
import { upsertGeomagneticStorms } from "../models/GeomagneticStorm.js";
import { SOLAR_FLARE_CLASSES } from "../constants.js";

const cache = {
  flares: [],
  cmes: [],
  storms: [],
  lastFetch: null,
  error: null,
};

/**
 * Update all space weather caches and persist to DB.
 */
export async function updateSpaceWeather({ flares, cmes, storms }) {
  cache.flares = flares;
  cache.cmes = cmes;
  cache.storms = storms;
  cache.lastFetch = new Date();
  cache.error = null;

  const [flrResult, cmeResult, gstResult] = await Promise.all([
    upsertSolarFlares(flares),
    upsertCmes(cmes),
    upsertGeomagneticStorms(storms),
  ]);

  return { flares: flrResult, cmes: cmeResult, storms: gstResult };
}

export function setSpaceWeatherError(error) {
  cache.error = { message: error.message, time: new Date() };
}

/**
 * Restore space weather data from a DB snapshot.
 * Memory-only — no MongoDB upserts.
 */
export function restoreSpaceWeather({ flares, cmes, storms }) {
  cache.flares = flares || [];
  cache.cmes = cmes || [];
  cache.storms = storms || [];
  cache.lastFetch = new Date();
  cache.error = null;
}

export function getLatestFlares() {
  return [...cache.flares];
}

export function getLatestCmes() {
  return [...cache.cmes];
}

export function getLatestStorms() {
  return [...cache.storms];
}

/**
 * Get all space weather data from cache.
 */
export function getLatestSpaceWeather() {
  return {
    flares: cache.flares,
    cmes: cache.cmes,
    storms: cache.storms,
    lastFetch: cache.lastFetch,
  };
}

/**
 * Summary: strongest flare, fastest CME, Earth-directed CMEs, storm count.
 */
export function getSpaceWeatherSummary() {
  // Find strongest flare by class
  const strongestFlare = cache.flares.reduce((strongest, flr) => {
    if (!strongest) return flr;
    const currentClass = flr.classType?.[0] || "";
    const bestClass = strongest.classType?.[0] || "";
    const currentIdx = SOLAR_FLARE_CLASSES.indexOf(currentClass);
    const bestIdx = SOLAR_FLARE_CLASSES.indexOf(bestClass);
    if (currentIdx > bestIdx) return flr;
    if (currentIdx === bestIdx) {
      const currentNum = parseFloat(flr.classType?.slice(1) || "0");
      const bestNum = parseFloat(strongest.classType?.slice(1) || "0");
      return currentNum > bestNum ? flr : strongest;
    }
    return strongest;
  }, null);

  const fastestCme = cache.cmes.reduce(
    (fastest, cme) =>
      (cme.speed ?? 0) > (fastest?.speed ?? 0) ? cme : fastest,
    null,
  );

  const earthDirectedCmes = cache.cmes.filter((c) => c.isEarthDirected);

  return {
    flareCount: cache.flares.length,
    cmeCount: cache.cmes.length,
    stormCount: cache.storms.length,
    strongestFlare,
    fastestCme,
    earthDirectedCmes: earthDirectedCmes.length,
    earthDirectedDetails: earthDirectedCmes,
    lastFetch: cache.lastFetch,
  };
}

export function getSpaceWeatherHealth() {
  return {
    lastFetch: cache.lastFetch,
    error: cache.error,
    flareCount: cache.flares.length,
    cmeCount: cache.cmes.length,
    stormCount: cache.storms.length,
  };
}
