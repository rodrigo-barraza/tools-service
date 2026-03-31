import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

const API_URL = "https://511ny.org/api/getcameras?key=public&format=json";

/**
 * Shared fetcher for New York 511 cameras.
 * Filters by geographic bounding box and upserts results.
 *
 * @param {Object} options
 * @param {string} options.city
 * @param {string} options.idPrefix
 * @param {Object} options.bounds - { minLat, maxLat, minLon, maxLon }
 */
export async function fetchNY511Cameras({ city, idPrefix, bounds }) {
  const response = await fetch(API_URL, {
    headers: buildScraperHeaders(),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch NY511 cameras for ${city}: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return;

  const parsedWebcams = [];

  for (const cam of data) {
    if (cam.Disabled || cam.Blocked) continue;

    const lat = cam.Latitude;
    const lon = cam.Longitude;
    if (!lat || !lon) continue;

    if (lat < bounds.minLat || lat > bounds.maxLat || lon < bounds.minLon || lon > bounds.maxLon) {
      continue;
    }

    parsedWebcams.push({
      id: `${idPrefix}-${cam.ID}`,
      name: cam.Name || `Camera ${cam.ID}`,
      url: cam.VideoUrl || cam.Url,
      area: cam.RoadwayName || city,
      latitude: lat,
      longitude: lon,
      city,
      country: "US",
      source: "511ny.org",
    });
  }

  if (parsedWebcams.length > 0) {
    await upsertWebcams(parsedWebcams);
  }
}
