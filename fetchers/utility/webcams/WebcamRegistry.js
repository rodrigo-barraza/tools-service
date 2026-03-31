import { refreshVancouverWebcams } from "./sources/vancouver.js";
import { refreshSeattleWebcams } from "./sources/seattle.js";
import { refreshTorontoWebcams } from "./sources/toronto.js";
import { refreshCalgaryWebcams } from "./sources/calgary.js";
import { refreshAustinWebcams } from "./sources/austin.js";
import { refreshChicagoWebcams } from "./sources/chicago.js";
import { refreshNewYorkWebcams } from "./sources/new_york.js";
import { refreshLosAngelesWebcams } from "./sources/los_angeles.js";

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
  chicago: refreshChicagoWebcams,
  "new york": refreshNewYorkWebcams,
  "los angeles": refreshLosAngelesWebcams,
};

export function getSupportedCities() {
  return Object.keys(WEBCAM_REGISTRY);
}
