import { fetch511Cameras } from "./_511_helper.js";

export async function refreshLondonONWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "London",
    country: "CA",
    source: "511on.ca",
    idPrefix: "LON",
    bounds: { minLat: 42.8, maxLat: 43.2, minLon: -81.6, maxLon: -81.0 },
  });
}
