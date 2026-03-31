import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

/**
 * Shared fetcher for 511-style camera APIs (Ontario, Alberta, etc.).
 * These APIs return JSON arrays of camera objects with Views arrays
 * containing CCTV page URLs.
 *
 * @param {Object} options
 * @param {string} options.apiUrl       - Base API URL (e.g. https://511on.ca/api/v2/get/cameras)
 * @param {string} options.city         - City name for tagging (e.g. "Ottawa")
 * @param {string} options.country      - Country code (e.g. "CA")
 * @param {string} options.source       - Source identifier (e.g. "511on.ca")
 * @param {string} options.idPrefix     - ID prefix for uniqueness (e.g. "ON")
 * @param {Object} options.bounds       - Geographic bounding box { minLat, maxLat, minLon, maxLon }
 */
export async function fetch511Cameras({ apiUrl, city, country, source, idPrefix, bounds }) {
  const url = `${apiUrl}?format=json`;
  const response = await fetch(url, {
    headers: buildScraperHeaders(),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${city} webcams from ${source}: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    return;
  }

  const parsedWebcams = [];

  for (const cam of data) {
    const lat = cam.Latitude;
    const lon = cam.Longitude;

    // Filter by geographic bounding box
    if (bounds) {
      if (lat < bounds.minLat || lat > bounds.maxLat || lon < bounds.minLon || lon > bounds.maxLon) {
        continue;
      }
    }

    // Each camera can have multiple views
    if (!cam.Views || cam.Views.length === 0) continue;

    for (const view of cam.Views) {
      if (view.Status !== "Enabled") continue;

      parsedWebcams.push({
        id: `${idPrefix}-${view.Id}`,
        name: `${cam.Location || cam.Roadway || `Camera ${cam.Id}`}${view.Description ? ` (${view.Description})` : ""}`.trim(),
        url: view.Url,
        area: cam.Roadway || city,
        latitude: lat,
        longitude: lon,
        city,
        country,
        source,
      });
    }
  }

  if (parsedWebcams.length > 0) {
    await upsertWebcams(parsedWebcams);
  }
}
