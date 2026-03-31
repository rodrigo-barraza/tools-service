import { fetch511Cameras } from "./_511_helper.js";

export async function refreshGrandePrairieWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Grande Prairie",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "GPR",
    bounds: { minLat: 55.0, maxLat: 55.3, minLon: -119.1, maxLon: -118.6 },
  });
}
