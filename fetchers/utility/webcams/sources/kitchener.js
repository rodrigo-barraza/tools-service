import { fetch511Cameras } from "./_511_helper.js";

export async function refreshKitchenerWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Kitchener",
    country: "CA",
    source: "511on.ca",
    idPrefix: "KIT",
    bounds: { minLat: 43.3, maxLat: 43.6, minLon: -80.7, maxLon: -80.1 },
  });
}
