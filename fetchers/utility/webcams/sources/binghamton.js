import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshBinghamtonWebcams() {
  await fetchNY511Cameras({
    city: "Binghamton",
    idPrefix: "BGM",
    bounds: { minLat: 42.0, maxLat: 42.25, minLon: -76.1, maxLon: -75.7 },
  });
}
