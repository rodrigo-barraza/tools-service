import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

export async function refreshAustinWebcams() {
  // City of Austin Open Data (Socrata SODA API)
  let allParsedWebcams = [];
  let offset = 0;
  const limitPerPage = 1000;
  let hasMore = true;

  while (hasMore) {
    const url = `https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=${limitPerPage}&$offset=${offset}`;
    const response = await fetch(url, { headers: buildScraperHeaders() });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Austin webcams (offset: ${offset}): ${response.status}`);
    }
    
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
      break;
    }

    const parsedWebcams = data.map((cam) => {
      const lat = cam.location?.coordinates ? cam.location.coordinates[1] : null;
      const lon = cam.location?.coordinates ? cam.location.coordinates[0] : null;

      // Filter out turned off cameras or ones missing images
      if (cam.camera_status !== "TURNED_ON" || !cam.screenshot_address) {
        return null; // filtered out below
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

    allParsedWebcams = allParsedWebcams.concat(parsedWebcams);
    
    if (data.length < limitPerPage) {
      hasMore = false;
    } else {
      offset += limitPerPage;
    }
  }

  await upsertWebcams(allParsedWebcams);
}
