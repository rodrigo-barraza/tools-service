import { refreshVancouverWebcams } from "./sources/vancouver.js";
import { refreshSeattleWebcams } from "./sources/seattle.js";
import { refreshTorontoWebcams } from "./sources/toronto.js";
import { refreshCalgaryWebcams } from "./sources/calgary.js";
import { refreshAustinWebcams } from "./sources/austin.js";

// Ontario 511 cities
import { refreshOttawaWebcams } from "./sources/ottawa.js";
import { refreshHamiltonWebcams } from "./sources/hamilton.js";
import { refreshLondonONWebcams } from "./sources/london_on.js";
import { refreshKingstonWebcams } from "./sources/kingston.js";
import { refreshWindsorONWebcams } from "./sources/windsor_on.js";
import { refreshKitchenerWebcams } from "./sources/kitchener.js";
import { refreshBarrieWebcams } from "./sources/barrie.js";
import { refreshThunderBayWebcams } from "./sources/thunder_bay.js";
import { refreshSudburyWebcams } from "./sources/sudbury.js";
import { refreshNiagaraWebcams } from "./sources/niagara.js";
import { refreshMississaugaWebcams } from "./sources/mississauga.js";

// Alberta 511 cities
import { refreshEdmontonWebcams } from "./sources/edmonton.js";
import { refreshRedDeerWebcams } from "./sources/red_deer.js";
import { refreshLethbridgeWebcams } from "./sources/lethbridge.js";
import { refreshMedicineHatWebcams } from "./sources/medicine_hat.js";
import { refreshGrandePrairieWebcams } from "./sources/grande_prairie.js";
import { refreshBanffWebcams } from "./sources/banff.js";
import { refreshFortMcMurrayWebcams } from "./sources/fort_mcmurray.js";

// US Socrata
import { refreshBatonRougeWebcams } from "./sources/baton_rouge.js";

// New York 511 cities
import { refreshNYCWebcams } from "./sources/nyc.js";
import { refreshBuffaloWebcams } from "./sources/buffalo.js";
import { refreshSyracuseWebcams } from "./sources/syracuse.js";
import { refreshAlbanyWebcams } from "./sources/albany.js";
import { refreshRochesterWebcams } from "./sources/rochester.js";
import { refreshLongIslandWebcams } from "./sources/long_island.js";
import { refreshWestchesterWebcams } from "./sources/westchester.js";
import { refreshUticaWebcams } from "./sources/utica.js";
import { refreshBinghamtonWebcams } from "./sources/binghamton.js";
import { refreshIthacaWebcams } from "./sources/ithaca.js";

/**
 * Registry mapping normalized city names to their specific
 * refresh functions. Each function handles fetching and upserting
 * its data into the MongoDB 'webcams' collection.
 */
export const WEBCAM_REGISTRY = {
  // Original cities
  vancouver: refreshVancouverWebcams,
  seattle: refreshSeattleWebcams,
  toronto: refreshTorontoWebcams,
  calgary: refreshCalgaryWebcams,
  austin: refreshAustinWebcams,

  // Ontario 511
  ottawa: refreshOttawaWebcams,
  hamilton: refreshHamiltonWebcams,
  "london-on": refreshLondonONWebcams,
  kingston: refreshKingstonWebcams,
  "windsor-on": refreshWindsorONWebcams,
  kitchener: refreshKitchenerWebcams,
  barrie: refreshBarrieWebcams,
  "thunder-bay": refreshThunderBayWebcams,
  sudbury: refreshSudburyWebcams,
  niagara: refreshNiagaraWebcams,
  mississauga: refreshMississaugaWebcams,

  // Alberta 511
  edmonton: refreshEdmontonWebcams,
  "red-deer": refreshRedDeerWebcams,
  lethbridge: refreshLethbridgeWebcams,
  "medicine-hat": refreshMedicineHatWebcams,
  "grande-prairie": refreshGrandePrairieWebcams,
  banff: refreshBanffWebcams,
  "fort-mcmurray": refreshFortMcMurrayWebcams,

  // US - Louisiana Socrata
  "baton-rouge": refreshBatonRougeWebcams,

  // New York 511
  nyc: refreshNYCWebcams,
  buffalo: refreshBuffaloWebcams,
  syracuse: refreshSyracuseWebcams,
  albany: refreshAlbanyWebcams,
  rochester: refreshRochesterWebcams,
  "long-island": refreshLongIslandWebcams,
  westchester: refreshWestchesterWebcams,
  utica: refreshUticaWebcams,
  binghamton: refreshBinghamtonWebcams,
  ithaca: refreshIthacaWebcams,
};

export function getSupportedCities() {
  return Object.keys(WEBCAM_REGISTRY);
}
