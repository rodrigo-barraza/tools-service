import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshBuffaloWebcams() {
  await fetchNY511Cameras({
    city: "Buffalo",
    idPrefix: "BUF",
    bounds: { minLat: 42.75, maxLat: 43.05, minLon: -79.0, maxLon: -78.65 },
  });
}
