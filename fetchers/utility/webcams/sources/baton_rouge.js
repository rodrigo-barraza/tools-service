import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

const API_URL = "https://data.brla.gov/resource/6z6u-ts44.json";

export async function refreshBatonRougeWebcams() {
  const response = await fetch(`${API_URL}?$limit=500`, {
    headers: buildScraperHeaders(),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Baton Rouge webcams: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return;

  const parsedWebcams = data
    .filter((cam) => cam.image_view)
    .map((cam) => ({
      id: `BTR-${cam.device_id || cam._id}`,
      name: cam.device_name || cam.location || `Camera ${cam.device_id}`,
      url: cam.image_view,
      area: cam.location || "Baton Rouge",
      latitude: parseFloat(cam.latitude) || null,
      longitude: parseFloat(cam.longitude) || null,
      city: "Baton Rouge",
      country: "US",
      source: "data.brla.gov",
    }));

  if (parsedWebcams.length > 0) {
    await upsertWebcams(parsedWebcams);
  }
}
