import { fetch511Cameras } from "./_511_helper.js";

export async function refreshWindsorONWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Windsor",
    country: "CA",
    source: "511on.ca",
    idPrefix: "WIN",
    bounds: { minLat: 42.1, maxLat: 42.5, minLon: -83.2, maxLon: -82.6 },
  });
}
