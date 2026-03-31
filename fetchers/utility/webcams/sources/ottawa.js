import { fetch511Cameras } from "./_511_helper.js";

export async function refreshOttawaWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Ottawa",
    country: "CA",
    source: "511on.ca",
    idPrefix: "OTT",
    bounds: { minLat: 45.15, maxLat: 45.65, minLon: -76.4, maxLon: -75.2 },
  });
}
