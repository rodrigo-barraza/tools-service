import { refreshVancouverWebcams } from "./sources/vancouver.js";
import { refreshSeattleWebcams } from "./sources/seattle.js";
import { refreshTorontoWebcams } from "./sources/toronto.js";
import { refreshCalgaryWebcams } from "./sources/calgary.js";
import { refreshAustinWebcams } from "./sources/austin.js";

/**
 * Registry mapping normalized city names to their specific 
 * refresh functions. Each function handles fetching and upserting 
 * its data into the MongoDB 'webcams' collection.
 */
export const WEBCAM_REGISTRY = {
  vancouver: refreshVancouverWebcams,
  seattle: refreshSeattleWebcams,
  toronto: refreshTorontoWebcams,
  calgary: refreshCalgaryWebcams,
  austin: refreshAustinWebcams,
};

export function getSupportedCities() {
  return Object.keys(WEBCAM_REGISTRY);
}
