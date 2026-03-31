import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

export async function refreshAustinWebcams() {
  // City of Austin Open Data (Socrata SODA API)
  // Limited to 1000 since there are only ~500 cameras.
  const url = `https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=1000`;
  const response = await fetch(url, { headers: buildScraperHeaders() });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Austin webcams: ${response.status}`);
  }
  
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    return;
  }

  const parsedWebcams = data.map((cam) => {
    const lat = cam.location?.coordinates ? cam.location.coordinates[1] : null;
    const lon = cam.location?.coordinates ? cam.location.coordinates[0] : null;

    // Filter out turned off cameras or ones missing images
    if (cam.camera_status !== "TURNED_ON" || !cam.screenshot_address) {
      return null;
    }
    
    return {
      id: `AUS-${cam.camera_id || cam.id}`,
      name: (cam.location_name || `Austin Camera ${cam.camera_id}`).trim(),
      url: cam.screenshot_address,
      area: cam.signal_eng_area || "Austin",
      latitude: lat,
      longitude: lon,
      city: "Austin",
      country: "US",
      source: "data.austintexas.gov"
    };
  }).filter(c => c && c.url);

  await upsertWebcams(parsedWebcams);
}
