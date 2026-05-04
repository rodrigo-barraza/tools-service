import { MS_PER_DAY } from "@rodrigo-barraza/utilities";
import { getWebcamsByCity, getWebcamsLastUpdated } from "../../models/Webcam.js";
import { WEBCAM_REGISTRY, getSupportedCities } from "./webcams/WebcamRegistry.js";

export async function getPublicWebcams({ city = "vancouver", limit = 100 } = {}) {
  const normalizedCity = city.toLowerCase();

  const supportedCities = getSupportedCities();
  if (!supportedCities.includes(normalizedCity)) {
    throw new Error(`Webcams for city '${city}' are not currently supported. Supported: ${supportedCities.join(", ")}`);
  }

  const capitalizedCity = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();

  const lastUpdated = await getWebcamsLastUpdated(capitalizedCity);
  const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > MS_PER_DAY;

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
