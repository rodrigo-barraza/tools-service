import { fetch511Cameras } from "./_511_helper.js";

export async function refreshLethbridgeWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Lethbridge",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "LET",
    bounds: { minLat: 49.5, maxLat: 49.9, minLon: -113.1, maxLon: -112.5 },
  });
}
