import { upsertNeos } from "../models/Neo.js";

const cache = {
  neos: [],
  lastFetch: null,
  error: null,
};

/**
 * Update the cache with freshly fetched NEO data and persist to DB.
 */
export async function updateNeos(neos) {
  cache.neos = neos;
  cache.lastFetch = new Date();
  cache.error = null;
  return await upsertNeos(neos);
}

/**
 * Restore NEOs from a DB snapshot into the in-memory cache.
 * Memory-only — no MongoDB upsert.
 */
export function restoreNeos(neos) {
  cache.neos = neos;
  cache.lastFetch = new Date();
  cache.error = null;
}

export function setNeoError(error) {
  cache.error = { message: error.message, time: new Date() };
}

/**
 * Get today's near-Earth objects from cache.
 */
export function getLatestNeos() {
  return [...cache.neos];
}

/**
 * Summary: total count, hazardous count, closest approach, largest object.
 */
export function getNeoSummary() {
  const hazardous = cache.neos.filter((n) => n.isPotentiallyHazardous);
  const closest = cache.neos[0] || null; // already sorted by miss distance
  const largest = cache.neos.reduce(
    (max, n) =>
      (n.estimatedDiameterMaxKm ?? 0) > (max?.estimatedDiameterMaxKm ?? 0)
        ? n
        : max,
    null,
  );

  return {
    total: cache.neos.length,
    hazardousCount: hazardous.length,
    closest,
    largest,
    lastFetch: cache.lastFetch,
  };
}

export function getNeoHealth() {
  return {
    lastFetch: cache.lastFetch,
    error: cache.error,
    neoCount: cache.neos.length,
  };
}
