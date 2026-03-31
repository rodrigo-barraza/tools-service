import { fetch511Cameras } from "./_511_helper.js";

export async function refreshSudburyWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Sudbury",
    country: "CA",
    source: "511on.ca",
    idPrefix: "SUD",
    bounds: { minLat: 46.2, maxLat: 46.7, minLon: -81.5, maxLon: -80.5 },
  });
}
