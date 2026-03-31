import { fetch511Cameras } from "./_511_helper.js";

export async function refreshFortMcMurrayWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Fort McMurray",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "FMM",
    bounds: { minLat: 56.5, maxLat: 57.0, minLon: -111.8, maxLon: -111.2 },
  });
}
