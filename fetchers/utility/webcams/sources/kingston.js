import { fetch511Cameras } from "./_511_helper.js";

export async function refreshKingstonWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Kingston",
    country: "CA",
    source: "511on.ca",
    idPrefix: "KGN",
    bounds: { minLat: 44.1, maxLat: 44.4, minLon: -76.8, maxLon: -76.2 },
  });
}
