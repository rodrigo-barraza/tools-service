import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshWestchesterWebcams() {
  await fetchNY511Cameras({
    city: "Westchester",
    idPrefix: "WCH",
    bounds: { minLat: 40.92, maxLat: 41.14, minLon: -73.98, maxLon: -73.65 },
  });
}
