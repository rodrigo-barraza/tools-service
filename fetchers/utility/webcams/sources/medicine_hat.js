import { fetch511Cameras } from "./_511_helper.js";

export async function refreshMedicineHatWebcams() {
  await fetch511Cameras({
    apiUrl: "https://511.alberta.ca/api/v2/get/cameras",
    city: "Medicine Hat",
    country: "CA",
    source: "511.alberta.ca",
    idPrefix: "MHT",
    bounds: { minLat: 49.9, maxLat: 50.2, minLon: -110.9, maxLon: -110.5 },
  });
}
