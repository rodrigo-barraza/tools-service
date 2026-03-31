import { buildScraperHeaders } from "../../../../utilities.js";
import { upsertWebcams } from "../../../../models/Webcam.js";

export async function refreshVancouverWebcams() {
  // Vancouver opendata caps at 100 per request. Paginate until we get all.
  let allParsedWebcams = [];
  let offset = 0;
  const limitPerPage = 100;
  let totalCount = 1;

  while (offset < totalCount) {
    const url = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/web-cam-url-links/records?limit=${limitPerPage}&offset=${offset}`;
    const response = await fetch(url, { headers: buildScraperHeaders() });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Vancouver webcams (offset: ${offset}): ${response.status}`);
    }
    
    const data = await response.json();
    totalCount = data.total_count;

    const parsedWebcams = data.results.map((cam) => ({
      id: cam.mapid,
      name: cam.name,
      url: cam.url, // HTML page containing the camera image
      area: cam.geo_local_area,
      latitude: cam.geo_point_2d?.lat,
      longitude: cam.geo_point_2d?.lon,
      city: "Vancouver",
      country: "CA",
      source: "opendata.vancouver.ca"
    }));

    allParsedWebcams = allParsedWebcams.concat(parsedWebcams);
    offset += limitPerPage;
  }

  await upsertWebcams(allParsedWebcams);
}
