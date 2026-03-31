import { fetch511Cameras } from "./_511_helper.js";

export async function refreshBanffWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Banff",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "BNF",
    bounds: { minLat: 50.9, maxLat: 51.5, minLon: -116.2, maxLon: -115.2 },
  });
}
