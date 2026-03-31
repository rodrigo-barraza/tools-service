import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

export async function refreshTorontoWebcams() {
  // Toronto Open Data CKAN API
  let allParsedWebcams = [];
  let offset = 0;
  const limitPerPage = 100;
  let totalCount = 1;

  while (offset < totalCount) {
    const url = `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?id=824d2986-2fe0-4513-bdfb-e37e2499e7a9&limit=${limitPerPage}&offset=${offset}`;
    const response = await fetch(url, { headers: buildScraperHeaders() });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Toronto webcams (offset: ${offset}): ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error("Toronto CKAN API returned success: false");
    }

    totalCount = data.result.total;

    const parsedWebcams = data.result.records.map((cam) => {
      let lat = null, lon = null;
      if (cam.geometry) {
        try {
          const geo = JSON.parse(cam.geometry);
          if (geo.type === "Point" && geo.coordinates) {
            lon = geo.coordinates[0];
            lat = geo.coordinates[1];
          }
        } catch {
          // ignore parsing error
        }
      }

      const name = [cam.MAINROAD, cam.CROSSROAD].filter(Boolean).join(" & ");

      return {
        id: `TOR-${cam.REC_ID}`, // Ensure uniqueness across cities just in case
        name: name || `Camera ${cam.REC_ID}`,
        url: cam.IMAGEURL,
        area: "Toronto", // Could be parsed if more detail is needed, but just Toronto works for now
        latitude: lat,
        longitude: lon,
        city: "Toronto",
        country: "CA",
        source: "open.toronto.ca"
      };
    });

    allParsedWebcams = allParsedWebcams.concat(parsedWebcams);
    offset += limitPerPage;
  }

  await upsertWebcams(allParsedWebcams);
}
