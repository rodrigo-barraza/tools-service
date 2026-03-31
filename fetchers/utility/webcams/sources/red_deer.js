import { fetch511Cameras } from "./_511_helper.js";

export async function refreshRedDeerWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Red Deer",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "RDD",
    bounds: { minLat: 52.1, maxLat: 52.5, minLon: -114.0, maxLon: -113.5 },
  });
}
