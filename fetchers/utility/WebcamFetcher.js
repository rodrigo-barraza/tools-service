import { buildScraperHeaders } from "../../utilities.js";
import { getWebcamsByCity, getWebcamsLastUpdated, upsertWebcams } from "../../models/Webcam.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getPublicWebcams({ city = "vancouver", limit = 100 } = {}) {
  const normalizedCity = city.toLowerCase();

  if (normalizedCity !== "vancouver") {
    throw new Error(`Webcams for city '${city}' are not currently supported.`);
  }

  const lastUpdated = await getWebcamsLastUpdated("Vancouver");
  const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > DAY_MS;

  if (isStale) {
    console.log(`📷 Refreshing webcam data for ${city}`);
    try {
      // Vancouver opendata caps at 100 per request. Paginate until we get all.
      // Documentation: https://opendata.vancouver.ca/explore/dataset/web-cam-url-links/api/
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
    } catch (e) {
      console.error(`Failed to refresh webcams for ${city}:`, e.message);
      // If we never had them, we can't fallback to DB, so we throw
      if (!lastUpdated) throw e;
    }
  }

  // Return the webcams directly from the database
  return getWebcamsByCity("Vancouver", limit);
}
