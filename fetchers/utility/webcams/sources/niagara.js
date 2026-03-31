import { fetch511Cameras } from "./_511_helper.js";

export async function refreshNiagaraWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511on.ca/api/v2/get/cameras",
    city: "Niagara",
    country: "CA",
    source: "511on.ca",
    idPrefix: "NIA",
    bounds: { minLat: 42.9, maxLat: 43.3, minLon: -79.5, maxLon: -79.0 },
  });
}
