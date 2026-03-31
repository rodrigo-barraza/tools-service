import { fetch511Cameras } from "./_511_helper.js";

export async function refreshHamiltonWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Hamilton",
    country: "CA",
    source: "511on.ca",
    idPrefix: "HAM",
    bounds: { minLat: 43.15, maxLat: 43.35, minLon: -80.1, maxLon: -79.6 },
  });
}
