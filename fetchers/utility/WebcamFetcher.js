import { buildScraperHeaders } from "../../utilities.js";
import { getWebcamsByCity, getWebcamsLastUpdated, upsertWebcams } from "../../models/Webcam.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getPublicWebcams({ city = "vancouver", limit = 100 } = {}) {
  const normalizedCity = city.toLowerCase();

  const supportedCities = ["vancouver", "seattle", "toronto", "calgary"];
  if (!supportedCities.includes(normalizedCity)) {
    throw new Error(`Webcams for city '${city}' are not currently supported. Supported: ${supportedCities.join(", ")}`);
  }

  const capitalizedCity = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();

  const lastUpdated = await getWebcamsLastUpdated(capitalizedCity);
  const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > DAY_MS;

  if (isStale) {
    console.log(`📷 Refreshing webcam data for ${capitalizedCity}`);
    try {
      if (normalizedCity === "vancouver") {
        await refreshVancouverWebcams();
      } else if (normalizedCity === "seattle") {
        await refreshSeattleWebcams();
      } else if (normalizedCity === "toronto") {
        await refreshTorontoWebcams();
      } else if (normalizedCity === "calgary") {
        await refreshCalgaryWebcams();
      }
    } catch (e) {
      console.error(`Failed to refresh webcams for ${capitalizedCity}:`, e.message);
      // If we never had them, we can't fallback to DB, so we throw
      if (!lastUpdated) throw e;
    }
  }

  // Return the webcams directly from the database
  return getWebcamsByCity(capitalizedCity, limit);
}

async function refreshVancouverWebcams() {
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

async function refreshSeattleWebcams() {
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
      // Some URLs might already be absolute if SDOT changes data format, but usually they are just filenames.
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

async function refreshTorontoWebcams() {
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

async function refreshCalgaryWebcams() {
  // Open Calgary SODA API (Socrata)
  let allParsedWebcams = [];
  let offset = 0;
  const limitPerPage = 1000;
  let hasMore = true;

  while (hasMore) {
    const url = `https://data.calgary.ca/resource/k7p9-kppz.json?$limit=${limitPerPage}&$offset=${offset}`;
    const response = await fetch(url, { headers: buildScraperHeaders() });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Calgary webcams (offset: ${offset}): ${response.status}`);
    }
    
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
      break;
    }

    const parsedWebcams = data.map((cam, idx) => {
      const lat = cam.point?.coordinates ? cam.point.coordinates[1] : null;
      const lon = cam.point?.coordinates ? cam.point.coordinates[0] : null;
      
      return {
        id: `CGY-${offset + idx}`, // Reliable unique fallback since camera_url might change
        name: cam.camera_location || cam.camera_url?.description || `Calgary Camera ${offset + idx}`,
        url: cam.camera_url?.url || "",
        area: cam.quadrant || "Calgary",
        latitude: lat,
        longitude: lon,
        city: "Calgary",
        country: "CA",
        source: "data.calgary.ca"
      };
    }).filter(c => c.url);

    allParsedWebcams = allParsedWebcams.concat(parsedWebcams);
    
    if (data.length < limitPerPage) {
      hasMore = false;
    } else {
      offset += limitPerPage;
    }
  }

  await upsertWebcams(allParsedWebcams);
}
