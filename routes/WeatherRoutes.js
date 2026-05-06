import { parseIntParam } from "@rodrigo-barraza/utilities-library";
import { Router } from "express";
import { fetchLiveWeather } from "../fetchers/weather/LiveWeatherFetcher.js";
import {
  getRecentEarthquakes,
  getEarthquakeById,
} from "../models/Earthquake.js";
import { getRecentNeos } from "../models/Neo.js";
import { getRecentSolarFlares } from "../models/SolarFlare.js";
import { getRecentCmes } from "../models/Cme.js";
import { getRecentStorms } from "../models/GeomagneticStorm.js";
import {
  getLatest,
  getCurrent,
  getForecasts,
  getAirQuality,
  getDaylight,
  getHealth as getWeatherCacheHealth,
} from "../caches/WeatherCache.js";
import {
  getLatestEarthquakes,
  getEarthquakeSummary,
  getEarthquakeHealth,
} from "../caches/EarthquakeCache.js";
import {
  getLatestNeos,
  getNeoSummary,
  getNeoHealth,
} from "../caches/NeoCache.js";
import {
  getLatestSpaceWeather,
  getLatestFlares,
  getLatestCmes,
  getLatestStorms,
  getSpaceWeatherSummary,
  getSpaceWeatherHealth,
} from "../caches/SpaceWeatherCache.js";
import {
  getIssData,
  getIssTrajectory,
  getIssHealth,
} from "../caches/IssCache.js";
import {
  getKpHistory,
  getCurrentKp,
  getKpHealth,
} from "../caches/KpIndexCache.js";
import {
  getWildfires,
  getWildfireSummary,
  getWildfireHealth,
} from "../caches/WildfireCache.js";
import { getTides, getNextTide, getTideHealth } from "../caches/TideCache.js";
import {
  getSolarWind,
  getSolarWindLatest,
  getSolarWindHealth,
} from "../caches/SolarWindCache.js";
import {
  getGoogleAirQuality,
  getGoogleAirQualityHealth,
} from "../caches/GoogleAirQualityCache.js";
import {
  getPollen,
  getPollenToday,
  getPollenHealth,
} from "../caches/PollenCache.js";
import { getApod, getApodHealth } from "../caches/ApodCache.js";
import {
  getLaunches,
  getNextLaunch,
  getLaunchSummary,
  getLaunchHealth,
} from "../caches/LaunchCache.js";
import { getTwilight, getTwilightHealth } from "../caches/TwilightCache.js";
import {
  getWarnings,
  getWarningCount,
  getWarningHealth,
} from "../caches/EnvironmentCanadaCache.js";
import { getAvalanche, getAvalancheHealth } from "../caches/AvalancheCache.js";
const router = Router();
// ─── Weather ───────────────────────────────────────────────────────
router.get("/weather", (_req, res) => res.json(getLatest()));
router.get("/weather/current", (_req, res) => res.json(getCurrent()));
router.get("/weather/forecast", (_req, res) => res.json(getForecasts()));
router.get("/weather/air", (_req, res) => res.json(getAirQuality()));
router.get("/weather/daylight", (_req, res) => res.json(getDaylight()));
// ─── Earthquakes ───────────────────────────────────────────────────
router.get("/earthquakes", (_req, res) => res.json(getLatestEarthquakes()));
router.get("/earthquakes/summary", (_req, res) =>
  res.json(getEarthquakeSummary()),
);
router.get("/earthquakes/recent", async (req, res) => {
  const hours = parseIntParam(req.query.hours, 24);
  const minMag = req.query.minMag ? parseFloat(req.query.minMag) : null;
  const limit = parseIntParam(req.query.limit, 100);
  res.json(await getRecentEarthquakes(hours, minMag, limit));
});
router.get("/earthquakes/:id", async (req, res) => {
  const event = await getEarthquakeById(req.params.id);
  if (!event) return res.status(404).json({ error: "Earthquake not found" });
  res.json(event);
});
// ─── NEO ───────────────────────────────────────────────────────────
router.get("/neo", (_req, res) => res.json(getLatestNeos()));
router.get("/neo/summary", (_req, res) => res.json(getNeoSummary()));
router.get("/neo/recent", async (req, res) => {
  const days = parseIntParam(req.query.days, 7);
  const hazardousOnly = req.query.hazardousOnly === "true";
  const limit = parseIntParam(req.query.limit, 100);
  res.json(await getRecentNeos(days, hazardousOnly, limit));
});
// ─── Space Weather ─────────────────────────────────────────────────
router.get("/space-weather", (_req, res) => res.json(getLatestSpaceWeather()));
router.get("/space-weather/flares", (_req, res) => res.json(getLatestFlares()));
router.get("/space-weather/flares/recent", async (req, res) => {
  const days = parseIntParam(req.query.days, 7);
  const limit = parseIntParam(req.query.limit, 50);
  res.json(await getRecentSolarFlares(days, limit));
});
router.get("/space-weather/cmes", (_req, res) => res.json(getLatestCmes()));
router.get("/space-weather/cmes/recent", async (req, res) => {
  const days = parseIntParam(req.query.days, 7);
  const earthDirectedOnly = req.query.earthDirected === "true";
  const limit = parseIntParam(req.query.limit, 50);
  res.json(await getRecentCmes(days, earthDirectedOnly, limit));
});
router.get("/space-weather/storms", (_req, res) => res.json(getLatestStorms()));
router.get("/space-weather/storms/recent", async (req, res) => {
  const days = parseIntParam(req.query.days, 30);
  const limit = parseIntParam(req.query.limit, 20);
  res.json(await getRecentStorms(days, limit));
});
router.get("/space-weather/summary", (_req, res) =>
  res.json(getSpaceWeatherSummary()),
);
// ─── ISS ───────────────────────────────────────────────────────────
router.get("/iss", (_req, res) => res.json(getIssData()));
router.get("/iss/trajectory", (_req, res) => res.json(getIssTrajectory()));
// ─── Kp Index ──────────────────────────────────────────────────────
router.get("/kp", (_req, res) => res.json(getKpHistory()));
router.get("/kp/current", (_req, res) => res.json(getCurrentKp()));
// ─── Wildfires ─────────────────────────────────────────────────────
router.get("/wildfires", (_req, res) => res.json(getWildfires()));
router.get("/wildfires/summary", (_req, res) => res.json(getWildfireSummary()));
// ─── Tides ─────────────────────────────────────────────────────────
router.get("/tides", (_req, res) => res.json(getTides()));
router.get("/tides/next", (_req, res) => res.json(getNextTide()));
// ─── Solar Wind ────────────────────────────────────────────────────
router.get("/solar-wind", (_req, res) => res.json(getSolarWind()));
router.get("/solar-wind/latest", (_req, res) => res.json(getSolarWindLatest()));
// ─── Air Quality & Pollen ──────────────────────────────────────────
router.get("/airquality/google", (_req, res) =>
  res.json(getGoogleAirQuality()),
);
router.get("/pollen", (_req, res) => res.json(getPollen()));
router.get("/pollen/today", (_req, res) => res.json(getPollenToday()));
// ─── APOD ──────────────────────────────────────────────────────────
router.get("/apod", (_req, res) => res.json(getApod()));
// ─── Launches ──────────────────────────────────────────────────────
router.get("/launches", (_req, res) => res.json(getLaunches()));
router.get("/launches/next", (_req, res) => res.json(getNextLaunch()));
router.get("/launches/summary", (_req, res) => res.json(getLaunchSummary()));
// ─── Twilight ──────────────────────────────────────────────────────
router.get("/twilight", (_req, res) => res.json(getTwilight()));
// ─── Environment Canada ────────────────────────────────────────────
router.get("/warnings", (_req, res) => res.json(getWarnings()));
router.get("/warnings/count", (_req, res) => res.json(getWarningCount()));
// ─── Avalanche ─────────────────────────────────────────────────────
router.get("/avalanche", (_req, res) => res.json(getAvalanche()));
// ── Live Weather (on-demand, any location) ────────────────────────
router.get("/live", async (req, res) => {
  const { location, latitude, longitude, units } = req.query;
  if (!location && (latitude == null || longitude == null)) {
    return res.status(400).json({
      error: "Query parameter 'location' (city name) or 'latitude' + 'longitude' are required",
      examples: [
        "/weather/live?location=Tokyo",
        "/weather/live?location=Paris,FR",
        "/weather/live?latitude=48.8566&longitude=2.3522",
        "/weather/live?location=New+York&units=imperial",
      ],
    });
  }
  try {
    const result = await fetchLiveWeather({
      location,
      latitude: latitude != null ? parseFloat(latitude) : undefined,
      longitude: longitude != null ? parseFloat(longitude) : undefined,
      units: units || "metric",
    });
    if (result.error) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Weather fetch failed: ${err.message}` });
  }
});
// ── Unified Environment Dispatcher ─────────────────────────────────
const SOURCE_MAP = {
  current_weather: () => getCurrent(),
  air_quality: () => getAirQuality(),
  earthquakes: () => getLatestEarthquakes(),
  solar_activity: () => getSpaceWeatherSummary(),
  aurora: () => getCurrentKp(),
  twilight: () => getTwilight(),
  tides: () => getTides(),
  wildfires: () => getWildfires(),
  iss: () => getIssData(),
  neo: () => getNeoSummary(),
  solar_wind: () => getSolarWindLatest(),
  pollen: () => getPollenToday(),
  apod: () => getApod(),
  launches: () => getLaunchSummary(),
  warnings: () => getWarnings(),
  air_quality_google: () => getGoogleAirQuality(),
};
router.get("/environment", (req, res) => {
  const { source } = req.query;
  if (!source) {
    return res.status(400).json({
      error: "Query parameter 'source' is required",
      availableSources: Object.keys(SOURCE_MAP),
    });
  }
  const handler = SOURCE_MAP[source];
  if (!handler) {
    return res.status(400).json({
      error: `Unknown source: ${source}`,
      availableSources: Object.keys(SOURCE_MAP),
    });
  }
  const data = handler();
  res.json({ source, ...data });
});
// ─── Domain Health ─────────────────────────────────────────────────
export function getWeatherHealth() {
  return {
    weather: getWeatherCacheHealth(),
    earthquake: getEarthquakeHealth(),
    neo: getNeoHealth(),
    spaceWeather: getSpaceWeatherHealth(),
    iss: getIssHealth(),
    kpIndex: getKpHealth(),
    wildfire: getWildfireHealth(),
    tide: getTideHealth(),
    solarWind: getSolarWindHealth(),
    googleAirQuality: getGoogleAirQualityHealth(),
    pollen: getPollenHealth(),
    apod: getApodHealth(),
    launches: getLaunchHealth(),
    twilight: getTwilightHealth(),
    environmentCanada: getWarningHealth(),
    avalanche: getAvalancheHealth(),
  };
}
export default router;
