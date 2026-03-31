import { fetch511Cameras } from "./_511_helper.js";

export async function refreshEdmontonWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Edmonton",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "EDM",
    bounds: { minLat: 53.3, maxLat: 53.7, minLon: -113.8, maxLon: -113.2 },
  });
}
