import { fetch511Cameras } from "./_511_helper.js";

export async function refreshBarrieWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Barrie",
    country: "CA",
    source: "511on.ca",
    idPrefix: "BAR",
    bounds: { minLat: 44.2, maxLat: 44.5, minLon: -79.9, maxLon: -79.5 },
  });
}
