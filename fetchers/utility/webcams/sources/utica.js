import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshUticaWebcams() {
  await fetchNY511Cameras({
    city: "Utica",
    idPrefix: "UTI",
    bounds: { minLat: 43.0, maxLat: 43.2, minLon: -75.4, maxLon: -75.1 },
  });
}
