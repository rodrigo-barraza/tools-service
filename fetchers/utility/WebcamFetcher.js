import { getWebcamsByCity, getWebcamsLastUpdated } from "../../models/Webcam.js";
import { WEBCAM_REGISTRY, getSupportedCities } from "./webcams/WebcamRegistry.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getPublicWebcams({ city = "vancouver", limit = 100 } = {}) {
  const normalizedCity = city.toLowerCase();

  const supportedCities = getSupportedCities();
  if (!supportedCities.includes(normalizedCity)) {
    throw new Error(`Webcams for city '${city}' are not currently supported. Supported: ${supportedCities.join(", ")}`);
  }

  const capitalizedCity = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();

  const lastUpdated = await getWebcamsLastUpdated(capitalizedCity);
  const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > DAY_MS;

  if (isStale) {
    console.log(`📷 Refreshing webcam data for ${capitalizedCity}`);
    try {
      const refreshFunction = WEBCAM_REGISTRY[normalizedCity];
      if (refreshFunction) {
        await refreshFunction();
      }
    } catch (e) {
      console.error(`Failed to refresh webcams for ${capitalizedCity}:`, e.message);
      // If we never had them, we can't fallback to DB, so we throw
      if (!lastUpdated) throw e;
    }
  }

  // Return the webcams directly from the database
  return getWebcamsByCity(capitalizedCity, limit);
}
