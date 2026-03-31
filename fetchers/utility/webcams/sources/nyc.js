import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshNYCWebcams() {
  await fetchNY511Cameras({
    city: "New York City",
    idPrefix: "NYC",
    bounds: { minLat: 40.48, maxLat: 40.92, minLon: -74.27, maxLon: -73.7 },
  });
}
