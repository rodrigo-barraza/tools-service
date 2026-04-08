import {
  OPEN_METEO_INTERVAL_MS,
  AIR_QUALITY_INTERVAL_MS,
  TOMORROWIO_REALTIME_INTERVAL_MS,
  TOMORROWIO_FORECAST_INTERVAL_MS,
  EARTHQUAKE_INTERVAL_MS,
  NEO_INTERVAL_MS,
  DONKI_INTERVAL_MS,
  ISS_POSITION_INTERVAL_MS,
  ISS_ASTROS_INTERVAL_MS,
  KP_INDEX_INTERVAL_MS,
  WILDFIRE_INTERVAL_MS,
  TIDE_INTERVAL_MS,
  SOLAR_WIND_INTERVAL_MS,
  GOOGLE_AIR_QUALITY_INTERVAL_MS,
  GOOGLE_POLLEN_INTERVAL_MS,
  APOD_INTERVAL_MS,
  LAUNCH_INTERVAL_MS,
  TWILIGHT_INTERVAL_MS,
  ENV_CANADA_INTERVAL_MS,
  AVALANCHE_INTERVAL_MS,
} from "../constants.js";
import { fetchOpenMeteoWeather } from "../fetchers/weather/OpenMeteoFetcher.js";
import { fetchAirQuality } from "../fetchers/weather/AirQualityFetcher.js";
import {
  fetchTomorrowIORealtime,
  fetchTomorrowIODailyForecast,
} from "../fetchers/weather/TomorrowIOFetcher.js";
import { fetchEarthquakes } from "../fetchers/weather/EarthquakeFetcher.js";
import { fetchNeos } from "../fetchers/weather/NeoFetcher.js";
import { fetchAllDonki } from "../fetchers/weather/DonkiFetcher.js";
import {
  fetchIssPosition,
  fetchAstronauts,
} from "../fetchers/weather/IssFetcher.js";
import { fetchKpIndex } from "../fetchers/weather/KpIndexFetcher.js";
import { fetchWildfires } from "../fetchers/weather/WildfireFetcher.js";
import { fetchTides } from "../fetchers/weather/TideFetcher.js";
import { fetchSolarWind } from "../fetchers/weather/SolarWindFetcher.js";
import { fetchGoogleAirQuality } from "../fetchers/weather/GoogleAirQualityFetcher.js";
import { fetchApod } from "../fetchers/weather/ApodFetcher.js";
import { fetchUpcomingLaunches } from "../fetchers/weather/LaunchFetcher.js";
import { fetchTwilight } from "../fetchers/weather/TwilightFetcher.js";
import { fetchEnvironmentCanadaWarnings } from "../fetchers/weather/EnvironmentCanadaFetcher.js";
import { fetchAvalancheForecast } from "../fetchers/weather/AvalancheFetcher.js";
import { fetchPollen } from "../fetchers/weather/GooglePollenFetcher.js";
import { update, restore, setError } from "../caches/WeatherCache.js";
import {
  updateEarthquakes,
  restoreEarthquakes,
  setEarthquakeError,
} from "../caches/EarthquakeCache.js";
import { updateNeos, restoreNeos, setNeoError } from "../caches/NeoCache.js";
import {
  updateSpaceWeather,
  restoreSpaceWeather,
  setSpaceWeatherError,
} from "../caches/SpaceWeatherCache.js";
import {
  updateIssPosition,
  setIssPositionError,
  updateAstronauts,
  setAstronautsError,
} from "../caches/IssCache.js";
import { updateKpIndex, setKpIndexError } from "../caches/KpIndexCache.js";
import { updateWildfires, setWildfireError } from "../caches/WildfireCache.js";
import { updateTides, setTideError } from "../caches/TideCache.js";
import {
  updateSolarWind,
  setSolarWindError,
} from "../caches/SolarWindCache.js";
import {
  updateGoogleAirQuality,
  setGoogleAirQualityError,
} from "../caches/GoogleAirQualityCache.js";
import { updatePollen, setPollenError } from "../caches/PollenCache.js";
import { updateApod, setApodError } from "../caches/ApodCache.js";
import { updateLaunches, setLaunchError } from "../caches/LaunchCache.js";
import { updateTwilight, setTwilightError } from "../caches/TwilightCache.js";
import {
  updateWarnings,
  setWarningError,
} from "../caches/EnvironmentCanadaCache.js";
import {
  updateAvalanche,
  setAvalancheError,
} from "../caches/AvalancheCache.js";
import { saveState, startCollectorLoop } from "../services/FreshnessService.js";

// ─── Collector Factory ─────────────────────────────────────────────
// Standardizes the try/catch + saveState + error-logging boilerplate.
// Each entry provides: label, collection, fetchFn, updateFn, setErrorFn,
// and an optional logFn for domain-specific success messages.

function makeCollector({ label, collection, fetchFn, updateFn, setErrorFn, logFn }) {
  return async () => {
    try {
      const data = await fetchFn();
      updateFn(data);
      await saveState(collection, data);
      if (logFn) {
        console.log(`[${label}] ✅ ${logFn(data)}`);
      } else {
        console.log(`[${label}] ✅ Collected`);
      }
    } catch (error) {
      setErrorFn(error);
      console.error(`[${label}] ❌ ${error.message}`);
    }
  };
}

// ─── Weather Cache Collectors (via factory) ────────────────────────

const collectOpenMeteo = makeCollector({
  label: "OpenMeteo", collection: "openmeteo",
  fetchFn: fetchOpenMeteoWeather,
  updateFn: (d) => update("openmeteo", d),
  setErrorFn: (e) => setError("openmeteo", e),
  logFn: (d) => `${d.weatherDescription} | ${d.temperature}°C`,
});

const collectAirQuality = makeCollector({
  label: "AirQuality", collection: "air_quality",
  fetchFn: fetchAirQuality,
  updateFn: (d) => update("airquality", d),
  setErrorFn: (e) => setError("airquality", e),
  logFn: (d) => `US AQI: ${d.usAqi} | PM2.5: ${d.pm25}`,
});

const collectTomorrowIORealtime = makeCollector({
  label: "Tomorrow.io", collection: "tomorrowio",
  fetchFn: fetchTomorrowIORealtime,
  updateFn: (d) => update("tomorrowio", d),
  setErrorFn: (e) => setError("tomorrowio", e),
  logFn: (d) => `${d.weatherDescription} | Visibility: ${d.visibility}km | UV: ${d.uvIndex}`,
});

const collectTomorrowIODaily = makeCollector({
  label: "Tomorrow.io Daily", collection: "tomorrowio_daily",
  fetchFn: fetchTomorrowIODailyForecast,
  updateFn: (d) => update("tomorrowio_daily", d),
  setErrorFn: (e) => setError("tomorrowio_daily", e),
  logFn: (d) => `Moonrise: ${d.moonrise || "N/A"} | Moonset: ${d.moonset || "N/A"}`,
});

const collectIssPosition = makeCollector({
  label: "ISS", collection: "iss_position",
  fetchFn: fetchIssPosition,
  updateFn: updateIssPosition,
  setErrorFn: setIssPositionError,
  logFn: (d) => `Lat: ${d.latitude.toFixed(2)}, Lng: ${d.longitude.toFixed(2)}`,
});

const collectAstronauts = makeCollector({
  label: "Astronauts", collection: "astronauts",
  fetchFn: fetchAstronauts,
  updateFn: updateAstronauts,
  setErrorFn: setAstronautsError,
  logFn: (d) => `${d.total} people in space`,
});

const collectKpIndex = makeCollector({
  label: "Kp Index", collection: "kp_index",
  fetchFn: fetchKpIndex,
  updateFn: updateKpIndex,
  setErrorFn: setKpIndexError,
  logFn: (d) => `${d.length} readings | Current Kp: ${d[d.length - 1]?.kp ?? "?"}`,
});

const collectWildfires = makeCollector({
  label: "Wildfire", collection: "wildfires",
  fetchFn: fetchWildfires,
  updateFn: updateWildfires,
  setErrorFn: setWildfireError,
  logFn: (d) => {
    const largest = d.filter((e) => e.magnitudeValue != null)
      .sort((a, b) => b.magnitudeValue - a.magnitudeValue)[0];
    return `${d.length} active fires` +
      (largest ? ` | Largest: ${largest.title} (${largest.magnitudeValue} ${largest.magnitudeUnit})` : "");
  },
});

const collectTides = makeCollector({
  label: "Tides", collection: "tide_predictions",
  fetchFn: fetchTides,
  updateFn: updateTides,
  setErrorFn: setTideError,
  logFn: (d) => {
    const next = d.find((t) => new Date(t.time) > new Date());
    return `${d.length} predictions` +
      (next ? ` | Next: ${next.type} at ${next.time} (${next.height}m)` : "");
  },
});

const collectSolarWind = makeCollector({
  label: "Solar Wind", collection: "solar_wind",
  fetchFn: fetchSolarWind,
  updateFn: updateSolarWind,
  setErrorFn: setSolarWindError,
  logFn: (d) => `${d.counts.plasma}p/${d.counts.magnetic}m pts | Speed: ${d.latest.speed ?? "?"}km/s | Bz: ${d.latest.bz ?? "?"}nT`,
});

const collectGoogleAirQuality = makeCollector({
  label: "Google AQ", collection: "google_air_quality",
  fetchFn: fetchGoogleAirQuality,
  updateFn: updateGoogleAirQuality,
  setErrorFn: setGoogleAirQualityError,
  logFn: (d) => `AQI: ${d.usEpaAqi ?? "?"} (${d.usEpaCategory ?? "?"}) | Dominant: ${d.usEpaDominantPollutant ?? "?"}`,
});

const collectPollen = makeCollector({
  label: "Pollen", collection: "pollen",
  fetchFn: fetchPollen,
  updateFn: updatePollen,
  setErrorFn: setPollenError,
  logFn: (d) => {
    const today = d.daily?.[0];
    return `${d.daily?.length || 0}-day forecast | Grass: ${today?.grass?.indexInfo?.category ?? "?"} | Tree: ${today?.tree?.indexInfo?.category ?? "?"} | Weed: ${today?.weed?.indexInfo?.category ?? "?"}`;
  },
});

const collectApod = makeCollector({
  label: "APOD", collection: "apod",
  fetchFn: fetchApod,
  updateFn: updateApod,
  setErrorFn: setApodError,
  logFn: (d) => d.title,
});

const collectLaunches = makeCollector({
  label: "Launches", collection: "launches",
  fetchFn: fetchUpcomingLaunches,
  updateFn: updateLaunches,
  setErrorFn: setLaunchError,
  logFn: (d) => `${d.length} upcoming` + (d[0] ? ` | Next: ${d[0].name} (${d[0].status})` : ""),
});

const collectTwilight = makeCollector({
  label: "Twilight", collection: "twilight",
  fetchFn: fetchTwilight,
  updateFn: updateTwilight,
  setErrorFn: setTwilightError,
  logFn: (d) => `Civil: ${d.civilTwilightBegin} → ${d.civilTwilightEnd}`,
});

const collectEnvironmentCanada = makeCollector({
  label: "Env Canada", collection: "env_canada_warnings",
  fetchFn: fetchEnvironmentCanadaWarnings,
  updateFn: updateWarnings,
  setErrorFn: setWarningError,
  logFn: (d) => `${d.length} active warnings/watches`,
});

const collectAvalanche = makeCollector({
  label: "Avalanche", collection: "avalanche_forecasts",
  fetchFn: fetchAvalancheForecast,
  updateFn: updateAvalanche,
  setErrorFn: setAvalancheError,
  logFn: (d) => `${d.length} forecast regions`,
});

// ─── Complex Collectors (custom async flows) ──────────────────────

async function collectEarthquakes() {
  try {
    const events = await fetchEarthquakes();
    const result = await updateEarthquakes(events);
    await saveState("earthquakes_cache", events);
    const strongest = events.reduce(
      (max, e) => ((e.magnitude ?? -1) > (max.magnitude ?? -1) ? e : max),
      events[0] || {},
    );
    console.log(
      `[Earthquake] ✅ ${events.length} events | ` +
        `${result?.upserted || 0} new, ${result?.modified || 0} updated | ` +
        `Strongest: M${strongest?.magnitude ?? "?"} ${strongest?.place ?? ""}`,
    );
  } catch (error) {
    setEarthquakeError(error);
    console.error(`[Earthquake] ❌ ${error.message}`);
  }
}

async function collectNeos() {
  try {
    const neos = await fetchNeos();
    const result = await updateNeos(neos);
    await saveState("neos_cache", neos);
    const closest = neos[0];
    console.log(
      `[NEO] ✅ ${neos.length} objects | ` +
        `${result?.upserted || 0} new | ` +
        `Closest: ${closest?.name ?? "?"} at ${Math.round(closest?.missDistanceKm ?? 0)} km`,
    );
  } catch (error) {
    setNeoError(error);
    console.error(`[NEO] ❌ ${error.message}`);
  }
}

async function collectDonki() {
  try {
    const data = await fetchAllDonki();
    const result = await updateSpaceWeather(data);
    await saveState("space_weather", data);
    console.log(
      `[DONKI] ✅ ${data.flares.length} flares (${result.flares.upserted} new) | ` +
        `${data.cmes.length} CMEs (${result.cmes.upserted} new) | ` +
        `${data.storms.length} storms (${result.storms.upserted} new)`,
    );
  } catch (error) {
    setSpaceWeatherError(error);
    console.error(`[DONKI] ❌ ${error.message}`);
  }
}

// ─── Startup Definitions ──────────────────────────────────────────

const STARTUP_TASKS = [
  { label: "OpenMeteo", collection: "openmeteo", ttl: OPEN_METEO_INTERVAL_MS, collectFn: collectOpenMeteo, restoreFn: (d) => restore("openmeteo", d), delay: 0 },
  { label: "AirQuality", collection: "air_quality", ttl: AIR_QUALITY_INTERVAL_MS, collectFn: collectAirQuality, restoreFn: (d) => restore("airquality", d), delay: 2_000 },
  { label: "Tomorrow.io", collection: "tomorrowio", ttl: TOMORROWIO_REALTIME_INTERVAL_MS, collectFn: collectTomorrowIORealtime, restoreFn: (d) => restore("tomorrowio", d), delay: 4_000 },
  { label: "Tomorrow.io Daily", collection: "tomorrowio_daily", ttl: TOMORROWIO_FORECAST_INTERVAL_MS, collectFn: collectTomorrowIODaily, restoreFn: (d) => restore("tomorrowio_daily", d), delay: 6_000 },
  { label: "Earthquake", collection: "earthquakes_cache", ttl: EARTHQUAKE_INTERVAL_MS, collectFn: collectEarthquakes, restoreFn: restoreEarthquakes, delay: 8_000 },
  { label: "NEO", collection: "neos_cache", ttl: NEO_INTERVAL_MS, collectFn: collectNeos, restoreFn: restoreNeos, delay: 10_000 },
  { label: "DONKI", collection: "space_weather", ttl: DONKI_INTERVAL_MS, collectFn: collectDonki, restoreFn: restoreSpaceWeather, delay: 12_000 },
  { label: "ISS Position", collection: "iss_position", ttl: ISS_POSITION_INTERVAL_MS, collectFn: collectIssPosition, restoreFn: updateIssPosition, delay: 14_000 },
  { label: "Astronauts", collection: "astronauts", ttl: ISS_ASTROS_INTERVAL_MS, collectFn: collectAstronauts, restoreFn: updateAstronauts, delay: 15_000 },
  { label: "Kp Index", collection: "kp_index", ttl: KP_INDEX_INTERVAL_MS, collectFn: collectKpIndex, restoreFn: updateKpIndex, delay: 16_000 },
  { label: "Wildfire", collection: "wildfires", ttl: WILDFIRE_INTERVAL_MS, collectFn: collectWildfires, restoreFn: updateWildfires, delay: 18_000 },
  { label: "Tides", collection: "tide_predictions", ttl: TIDE_INTERVAL_MS, collectFn: collectTides, restoreFn: updateTides, delay: 20_000 },
  { label: "Solar Wind", collection: "solar_wind", ttl: SOLAR_WIND_INTERVAL_MS, collectFn: collectSolarWind, restoreFn: updateSolarWind, delay: 22_000 },
  { label: "Google AQ", collection: "google_air_quality", ttl: GOOGLE_AIR_QUALITY_INTERVAL_MS, collectFn: collectGoogleAirQuality, restoreFn: updateGoogleAirQuality, delay: 24_000 },
  { label: "Pollen", collection: "pollen", ttl: GOOGLE_POLLEN_INTERVAL_MS, collectFn: collectPollen, restoreFn: updatePollen, delay: 26_000 },
  { label: "APOD", collection: "apod", ttl: APOD_INTERVAL_MS, collectFn: collectApod, restoreFn: updateApod, delay: 28_000 },
  { label: "Launches", collection: "launches", ttl: LAUNCH_INTERVAL_MS, collectFn: collectLaunches, restoreFn: updateLaunches, delay: 30_000 },
  { label: "Twilight", collection: "twilight", ttl: TWILIGHT_INTERVAL_MS, collectFn: collectTwilight, restoreFn: updateTwilight, delay: 32_000 },
  { label: "Env Canada", collection: "env_canada_warnings", ttl: ENV_CANADA_INTERVAL_MS, collectFn: collectEnvironmentCanada, restoreFn: updateWarnings, delay: 34_000 },
  { label: "Avalanche", collection: "avalanche_forecasts", ttl: AVALANCHE_INTERVAL_MS, collectFn: collectAvalanche, restoreFn: updateAvalanche, delay: 36_000 },
];

// ─── Start All Weather Collectors ──────────────────────────────────

export function startWeatherCollectors() {
  startCollectorLoop(STARTUP_TASKS);
  console.log("☁️  Weather collectors started");
}
