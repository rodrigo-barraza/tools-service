import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshLongIslandWebcams() {
  await fetchNY511Cameras({
    city: "Long Island",
    idPrefix: "LI",
    bounds: { minLat: 40.55, maxLat: 41.0, minLon: -73.7, maxLon: -71.8 },
  });
}
