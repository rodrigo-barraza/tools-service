import { fetch511Cameras } from "./_511_helper.js";

export async function refreshThunderBayWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Thunder Bay",
    country: "CA",
    source: "511on.ca",
    idPrefix: "TBY",
    bounds: { minLat: 48.2, maxLat: 48.8, minLon: -89.8, maxLon: -89.0 },
  });
}
