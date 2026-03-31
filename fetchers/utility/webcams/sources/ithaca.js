import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshIthacaWebcams() {
  await fetchNY511Cameras({
    city: "Ithaca",
    idPrefix: "ITH",
    bounds: { minLat: 42.38, maxLat: 42.55, minLon: -76.6, maxLon: -76.4 },
  });
}
