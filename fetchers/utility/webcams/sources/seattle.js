import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

export async function refreshSeattleWebcams() {
  // SDOT Travelers API (Seattle Live Webcams)
  const url = `https://web.seattle.gov/Travelers/api/Map/Data?zoomId=13&type=2`;
  const response = await fetch(url, { headers: buildScraperHeaders() });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Seattle webcams: ${response.status}`);
  }
  
  const data = await response.json();
  const parsedWebcams = [];

  for (const feature of data.Features) {
    const lat = feature.PointCoordinate[0];
    const lon = feature.PointCoordinate[1];
    
    for (const cam of feature.Cameras) {
      let imageUrl = cam.ImageUrl;
      if (!imageUrl.startsWith("http")) {
        imageUrl = `https://www.seattle.gov/trafficcams/images/${imageUrl}`;
      }

      parsedWebcams.push({
        id: cam.Id,
        name: cam.Description,
        url: imageUrl,
        area: "Seattle",
        latitude: lat,
        longitude: lon,
        city: "Seattle",
        country: "US",
        source: "web.seattle.gov"
      });
    }
  }

  await upsertWebcams(parsedWebcams);
}
