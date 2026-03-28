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
import { collectIfStale, saveState } from "../services/FreshnessService.js";

// ─── Individual Collectors ─────────────────────────────────────────

async function collectOpenMeteo() {
  try {
    const data = await fetchOpenMeteoWeather();
    update("openmeteo", data);
    await saveState("openmeteo", data);
    console.log(
      `[OpenMeteo] ✅ ${data.weatherDescription} | ${data.temperature}°C`,
    );
  } catch (error) {
    setError("openmeteo", error);
    console.error(`[OpenMeteo] ❌ ${error.message}`);
  }
}

async function collectAirQuality() {
  try {
    const data = await fetchAirQuality();
    update("airquality", data);
    await saveState("air_quality", data);
    console.log(`[AirQuality] ✅ US AQI: ${data.usAqi} | PM2.5: ${data.pm25}`);
  } catch (error) {
    setError("airquality", error);
    console.error(`[AirQuality] ❌ ${error.message}`);
  }
}

async function collectTomorrowIORealtime() {
  try {
    const data = await fetchTomorrowIORealtime();
    update("tomorrowio", data);
    await saveState("tomorrowio", data);
    console.log(
      `[Tomorrow.io] ✅ ${data.weatherDescription} | Visibility: ${data.visibility}km | UV: ${data.uvIndex}`,
    );
  } catch (error) {
    setError("tomorrowio", error);
    console.error(`[Tomorrow.io] ❌ ${error.message}`);
  }
}

async function collectTomorrowIODaily() {
  try {
    const data = await fetchTomorrowIODailyForecast();
    update("tomorrowio_daily", data);
    await saveState("tomorrowio_daily", data);
    console.log(
      `[Tomorrow.io Daily] ✅ Moonrise: ${data.moonrise || "N/A"} | Moonset: ${data.moonset || "N/A"}`,
    );
  } catch (error) {
    setError("tomorrowio_daily", error);
    console.error(`[Tomorrow.io Daily] ❌ ${error.message}`);
  }
}

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

async function collectIssPosition() {
  try {
    const position = await fetchIssPosition();
    updateIssPosition(position);
    await saveState("iss_position", position);
    console.log(
      `[ISS] ✅ Lat: ${position.latitude.toFixed(2)}, Lng: ${position.longitude.toFixed(2)}`,
    );
  } catch (error) {
    setIssPositionError(error);
    console.error(`[ISS Position] ❌ ${error.message}`);
  }
}

async function collectAstronauts() {
  try {
    const data = await fetchAstronauts();
    updateAstronauts(data);
    await saveState("astronauts", data);
    console.log(`[Astronauts] ✅ ${data.total} people in space`);
  } catch (error) {
    setAstronautsError(error);
    console.error(`[Astronauts] ❌ ${error.message}`);
  }
}

async function collectKpIndex() {
  try {
    const readings = await fetchKpIndex();
    updateKpIndex(readings);
    await saveState("kp_index", readings);
    const latest = readings[readings.length - 1];
    console.log(
      `[Kp Index] ✅ ${readings.length} readings | Current Kp: ${latest?.kp ?? "?"}`,
    );
  } catch (error) {
    setKpIndexError(error);
    console.error(`[Kp Index] ❌ ${error.message}`);
  }
}

async function collectWildfires() {
  try {
    const events = await fetchWildfires();
    updateWildfires(events);
    await saveState("wildfires", events);
    const largest = events
      .filter((e) => e.magnitudeValue != null)
      .sort((a, b) => b.magnitudeValue - a.magnitudeValue)[0];
    console.log(
      `[Wildfire] ✅ ${events.length} active fires` +
        (largest
          ? ` | Largest: ${largest.title} (${largest.magnitudeValue} ${largest.magnitudeUnit})`
          : ""),
    );
  } catch (error) {
    setWildfireError(error);
    console.error(`[Wildfire] ❌ ${error.message}`);
  }
}

async function collectTides() {
  try {
    const predictions = await fetchTides();
    updateTides(predictions);
    await saveState("tide_predictions", predictions);
    const next = predictions.find((t) => new Date(t.time) > new Date());
    console.log(
      `[Tides] ✅ ${predictions.length} predictions` +
        (next ? ` | Next: ${next.type} at ${next.time} (${next.height}m)` : ""),
    );
  } catch (error) {
    setTideError(error);
    console.error(`[Tides] ❌ ${error.message}`);
  }
}

async function collectSolarWind() {
  try {
    const data = await fetchSolarWind();
    updateSolarWind(data);
    await saveState("solar_wind", data);
    const l = data.latest;
    console.log(
      `[Solar Wind] ✅ ${data.counts.plasma}p/${data.counts.magnetic}m pts | ` +
        `Speed: ${l.speed ?? "?"}km/s | Bz: ${l.bz ?? "?"}nT`,
    );
  } catch (error) {
    setSolarWindError(error);
    console.error(`[Solar Wind] ❌ ${error.message}`);
  }
}

async function collectGoogleAirQuality() {
  try {
    const data = await fetchGoogleAirQuality();
    updateGoogleAirQuality(data);
    await saveState("google_air_quality", data);
    console.log(
      `[Google AQ] ✅ AQI: ${data.usEpaAqi ?? "?"} (${data.usEpaCategory ?? "?"}) | ` +
        `Dominant: ${data.usEpaDominantPollutant ?? "?"}`,
    );
  } catch (error) {
    setGoogleAirQualityError(error);
    console.error(`[Google AQ] ❌ ${error.message}`);
  }
}

async function collectPollen() {
  try {
    const data = await fetchPollen();
    updatePollen(data);
    await saveState("pollen", data);
    const today = data.daily?.[0];
    const grass = today?.grass?.indexInfo?.category ?? "?";
    const tree = today?.tree?.indexInfo?.category ?? "?";
    const weed = today?.weed?.indexInfo?.category ?? "?";
    console.log(
      `[Pollen] ✅ ${data.daily?.length || 0}-day forecast | ` +
        `Grass: ${grass} | Tree: ${tree} | Weed: ${weed}`,
    );
  } catch (error) {
    setPollenError(error);
    console.error(`[Pollen] ❌ ${error.message}`);
  }
}

async function collectApod() {
  try {
    const data = await fetchApod();
    updateApod(data);
    await saveState("apod", data);
    console.log(`[APOD] ✅ ${data.title}`);
  } catch (error) {
    setApodError(error);
    console.error(`[APOD] ❌ ${error.message}`);
  }
}

async function collectLaunches() {
  try {
    const launches = await fetchUpcomingLaunches();
    updateLaunches(launches);
    await saveState("launches", launches);
    const next = launches[0];
    console.log(
      `[Launches] ✅ ${launches.length} upcoming` +
        (next ? ` | Next: ${next.name} (${next.status})` : ""),
    );
  } catch (error) {
    setLaunchError(error);
    console.error(`[Launches] ❌ ${error.message}`);
  }
}

async function collectTwilight() {
  try {
    const data = await fetchTwilight();
    updateTwilight(data);
    await saveState("twilight", data);
    console.log(
      `[Twilight] ✅ Civil: ${data.civilTwilightBegin} → ${data.civilTwilightEnd}`,
    );
  } catch (error) {
    setTwilightError(error);
    console.error(`[Twilight] ❌ ${error.message}`);
  }
}

async function collectEnvironmentCanada() {
  try {
    const warnings = await fetchEnvironmentCanadaWarnings();
    updateWarnings(warnings);
    await saveState("env_canada_warnings", warnings);
    console.log(`[Env Canada] ✅ ${warnings.length} active warnings/watches`);
  } catch (error) {
    setWarningError(error);
    console.error(`[Env Canada] ❌ ${error.message}`);
  }
}

async function collectAvalanche() {
  try {
    const forecasts = await fetchAvalancheForecast();
    updateAvalanche(forecasts);
    await saveState("avalanche_forecasts", forecasts);
    console.log(`[Avalanche] ✅ ${forecasts.length} forecast regions`);
  } catch (error) {
    setAvalancheError(error);
    console.error(`[Avalanche] ❌ ${error.message}`);
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
  for (const task of STARTUP_TASKS) {
    setTimeout(
      () =>
        collectIfStale(
          task.label,
          task.collection,
          task.ttl,
          task.collectFn,
          task.restoreFn,
        ),
      task.delay,
    );
  }

  setInterval(collectOpenMeteo, OPEN_METEO_INTERVAL_MS);
  setInterval(collectAirQuality, AIR_QUALITY_INTERVAL_MS);
  setInterval(collectTomorrowIORealtime, TOMORROWIO_REALTIME_INTERVAL_MS);
  setInterval(collectTomorrowIODaily, TOMORROWIO_FORECAST_INTERVAL_MS);
  setInterval(collectEarthquakes, EARTHQUAKE_INTERVAL_MS);
  setInterval(collectNeos, NEO_INTERVAL_MS);
  setInterval(collectDonki, DONKI_INTERVAL_MS);
  setInterval(collectIssPosition, ISS_POSITION_INTERVAL_MS);
  setInterval(collectAstronauts, ISS_ASTROS_INTERVAL_MS);
  setInterval(collectKpIndex, KP_INDEX_INTERVAL_MS);
  setInterval(collectWildfires, WILDFIRE_INTERVAL_MS);
  setInterval(collectTides, TIDE_INTERVAL_MS);
  setInterval(collectSolarWind, SOLAR_WIND_INTERVAL_MS);
  setInterval(collectGoogleAirQuality, GOOGLE_AIR_QUALITY_INTERVAL_MS);
  setInterval(collectPollen, GOOGLE_POLLEN_INTERVAL_MS);
  setInterval(collectApod, APOD_INTERVAL_MS);
  setInterval(collectLaunches, LAUNCH_INTERVAL_MS);
  setInterval(collectTwilight, TWILIGHT_INTERVAL_MS);
  setInterval(collectEnvironmentCanada, ENV_CANADA_INTERVAL_MS);
  setInterval(collectAvalanche, AVALANCHE_INTERVAL_MS);

  console.log("☁️  Weather collectors started");
}
