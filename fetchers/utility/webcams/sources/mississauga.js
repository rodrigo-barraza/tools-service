import { fetch511Cameras } from "./_511_helper.js";

export async function refreshMississaugaWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Mississauga",
    country: "CA",
    source: "511on.ca",
    idPrefix: "MIS",
    bounds: { minLat: 43.5, maxLat: 43.7, minLon: -79.8, maxLon: -79.5 },
  });
}
