import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Weather Domain Cached Endpoints ──────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes and data integrity for all
// /weather/* cached endpoints.
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/weather`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /weather/weather ──────────────────────────────────────────────

describe("GET /weather/weather", () => {
  it("returns the full merged weather snapshot", async () => {
    const { status, data } = await fetchJson("/weather");
    assert.equal(status, 200);
    assert.equal(typeof data, "object");
    // Should have typical current-conditions keys
    assert.ok("temperature" in data || "temperatureC" in data || Object.keys(data).length > 0,
      "should contain weather data fields");
  });
});

// ─── /weather/weather/current ──────────────────────────────────────

describe("GET /weather/weather/current", () => {
  it("returns current conditions without forecast arrays", async () => {
    const { status, data } = await fetchJson("/weather/current");
    assert.equal(status, 200);
    assert.equal(typeof data, "object");
    // Should NOT contain forecast arrays
    assert.equal(data.hourlyForecast, undefined, "hourlyForecast excluded");
    assert.equal(data.dailyForecast, undefined, "dailyForecast excluded");
  });
});

// ─── /weather/weather/forecast ─────────────────────────────────────

describe("GET /weather/weather/forecast", () => {
  it("returns forecast arrays", async () => {
    const { status, data } = await fetchJson("/weather/forecast");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.hourlyForecast), "has hourlyForecast array");
    assert.ok(Array.isArray(data.dailyForecast), "has dailyForecast array");
    assert.ok(Array.isArray(data.hourlyAirQuality), "has hourlyAirQuality array");
    assert.ok(Array.isArray(data.tomorrowIODailyForecast), "has tomorrowIODailyForecast array");
  });
});

// ─── /weather/weather/air ──────────────────────────────────────────

describe("GET /weather/weather/air", () => {
  it("returns air quality data", async () => {
    const { status, data } = await fetchJson("/weather/air");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.hourlyAirQuality), "has hourlyAirQuality array");
    // Should include at least one AQ metric (may be null if no data yet)
    assert.ok("usAqi" in data || "pm25" in data, "has AQ metric fields");
  });
});

// ─── /weather/weather/daylight ─────────────────────────────────────

describe("GET /weather/weather/daylight", () => {
  it("returns daylight data", async () => {
    const { status, data } = await fetchJson("/weather/daylight");
    assert.equal(status, 200);
    assert.ok("sunrise" in data, "has sunrise");
    assert.ok("sunset" in data, "has sunset");
    assert.ok("isDay" in data, "has isDay");
  });
});

// ─── /weather/earthquakes ──────────────────────────────────────────

describe("GET /weather/earthquakes", () => {
  it("returns an array of earthquake events", async () => {
    const { status, data } = await fetchJson("/earthquakes");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

describe("GET /weather/earthquakes/summary", () => {
  it("returns earthquake summary with counts", async () => {
    const { status, data } = await fetchJson("/earthquakes/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.total === "number", "has total count");
    assert.ok(typeof data.counts === "object", "has counts by magnitude");
    assert.ok("lastFetch" in data, "has lastFetch timestamp");
  });
});

// ─── /weather/neo ──────────────────────────────────────────────────

describe("GET /weather/neo", () => {
  it("returns an array of near-Earth objects", async () => {
    const { status, data } = await fetchJson("/neo");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

describe("GET /weather/neo/summary", () => {
  it("returns NEO summary with hazardous count", async () => {
    const { status, data } = await fetchJson("/neo/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.total === "number", "has total");
    assert.ok(typeof data.hazardousCount === "number", "has hazardousCount");
    assert.ok("closest" in data, "has closest");
    assert.ok("largest" in data, "has largest");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/space-weather ────────────────────────────────────────

describe("GET /weather/space-weather", () => {
  it("returns combined space weather data", async () => {
    const { status, data } = await fetchJson("/space-weather");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.flares), "has flares array");
    assert.ok(Array.isArray(data.cmes), "has cmes array");
    assert.ok(Array.isArray(data.storms), "has storms array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/space-weather/flares", () => {
  it("returns an array of solar flares", async () => {
    const { status, data } = await fetchJson("/space-weather/flares");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

describe("GET /weather/space-weather/cmes", () => {
  it("returns an array of CMEs", async () => {
    const { status, data } = await fetchJson("/space-weather/cmes");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

describe("GET /weather/space-weather/storms", () => {
  it("returns an array of geomagnetic storms", async () => {
    const { status, data } = await fetchJson("/space-weather/storms");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

describe("GET /weather/space-weather/summary", () => {
  it("returns space weather summary with counts", async () => {
    const { status, data } = await fetchJson("/space-weather/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.flareCount === "number", "has flareCount");
    assert.ok(typeof data.cmeCount === "number", "has cmeCount");
    assert.ok(typeof data.stormCount === "number", "has stormCount");
    assert.ok("strongestFlare" in data, "has strongestFlare");
    assert.ok("fastestCme" in data, "has fastestCme");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/iss ──────────────────────────────────────────────────

describe("GET /weather/iss", () => {
  it("returns ISS position and astronaut data", async () => {
    const { status, data } = await fetchJson("/iss");
    assert.equal(status, 200);
    assert.ok("position" in data, "has position");
    assert.ok("astronauts" in data, "has astronauts");
    assert.ok("lastPositionFetch" in data, "has lastPositionFetch");
    assert.ok("lastAstrosFetch" in data, "has lastAstrosFetch");
  });
});

describe("GET /weather/iss/trajectory", () => {
  it("returns an array of trajectory points", async () => {
    const { status, data } = await fetchJson("/iss/trajectory");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

// ─── /weather/kp ───────────────────────────────────────────────────

describe("GET /weather/kp", () => {
  it("returns Kp index history", async () => {
    const { status, data } = await fetchJson("/kp");
    assert.equal(status, 200);
    assert.ok("count" in data, "has count");
    assert.ok(Array.isArray(data.readings), "has readings array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/kp/current", () => {
  it("returns current Kp with classification", async () => {
    const { status, data } = await fetchJson("/kp/current");
    assert.equal(status, 200);
    assert.ok("current" in data, "has current reading");
    assert.ok("classification" in data, "has classification");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/wildfires ────────────────────────────────────────────

describe("GET /weather/wildfires", () => {
  it("returns wildfire events", async () => {
    const { status, data } = await fetchJson("/wildfires");
    assert.equal(status, 200);
    assert.ok("count" in data, "has count");
    assert.ok(Array.isArray(data.events), "has events array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/wildfires/summary", () => {
  it("returns wildfire summary", async () => {
    const { status, data } = await fetchJson("/wildfires/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok("largest" in data, "has largest");
    assert.ok(typeof data.openCount === "number", "has openCount");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/tides ────────────────────────────────────────────────

describe("GET /weather/tides", () => {
  it("returns tide predictions", async () => {
    const { status, data } = await fetchJson("/tides");
    assert.equal(status, 200);
    assert.ok("count" in data, "has count");
    assert.ok(Array.isArray(data.predictions), "has predictions array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/tides/next", () => {
  it("returns next tide prediction", async () => {
    const { status, data } = await fetchJson("/tides/next");
    assert.equal(status, 200);
    assert.ok("next" in data, "has next");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/solar-wind ───────────────────────────────────────────

describe("GET /weather/solar-wind", () => {
  it("returns solar wind data", async () => {
    const { status, data } = await fetchJson("/solar-wind");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.plasma), "has plasma array");
    assert.ok(Array.isArray(data.magnetic), "has magnetic array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/solar-wind/latest", () => {
  it("returns latest solar wind reading", async () => {
    const { status, data } = await fetchJson("/solar-wind/latest");
    assert.equal(status, 200);
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/airquality/google ────────────────────────────────────

describe("GET /weather/airquality/google", () => {
  it("returns Google air quality data or no_data status", async () => {
    const { status, data } = await fetchJson("/airquality/google");
    assert.equal(status, 200);
    // createSimpleCache(type=object) returns { status: "no_data" } or spread data
    assert.ok(typeof data === "object", "returns an object");
  });
});

// ─── /weather/pollen ───────────────────────────────────────────────

describe("GET /weather/pollen", () => {
  it("returns pollen forecast data or no_data status", async () => {
    const { status, data } = await fetchJson("/pollen");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns an object");
  });
});

describe("GET /weather/pollen/today", () => {
  it("returns today's pollen or no_data", async () => {
    const { status, data } = await fetchJson("/pollen/today");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns an object");
  });
});

// ─── /weather/apod ─────────────────────────────────────────────────

describe("GET /weather/apod", () => {
  it("returns APOD data or no_data status", async () => {
    const { status, data } = await fetchJson("/apod");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns an object");
    // If data present, should have title
    if (data.lastFetch) {
      assert.ok(data.title || data.status === "no_data", "has title or no_data");
    }
  });
});

// ─── /weather/launches ─────────────────────────────────────────────

describe("GET /weather/launches", () => {
  it("returns upcoming launches", async () => {
    const { status, data } = await fetchJson("/launches");
    assert.equal(status, 200);
    assert.ok("count" in data, "has count");
    assert.ok(Array.isArray(data.launches), "has launches array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/launches/next", () => {
  it("returns the next upcoming launch", async () => {
    const { status, data } = await fetchJson("/launches/next");
    assert.equal(status, 200);
    assert.ok("next" in data, "has next");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/launches/summary", () => {
  it("returns launch summary", async () => {
    const { status, data } = await fetchJson("/launches/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.upcomingCount === "number", "has upcomingCount");
    assert.ok(Array.isArray(data.providers), "has providers array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/twilight ─────────────────────────────────────────────

describe("GET /weather/twilight", () => {
  it("returns twilight data or no_data status", async () => {
    const { status, data } = await fetchJson("/twilight");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns an object");
  });
});

// ─── /weather/warnings ─────────────────────────────────────────────

describe("GET /weather/warnings", () => {
  it("returns environment Canada warnings", async () => {
    const { status, data } = await fetchJson("/warnings");
    assert.equal(status, 200);
    assert.ok("count" in data, "has count");
    assert.ok(Array.isArray(data.warnings), "has warnings array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

describe("GET /weather/warnings/count", () => {
  it("returns warning counts by type", async () => {
    const { status, data } = await fetchJson("/warnings/count");
    assert.equal(status, 200);
    assert.ok(typeof data.total === "number", "has total");
    assert.ok(typeof data.byType === "object", "has byType breakdown");
    assert.ok("warning" in data.byType, "has warning count");
    assert.ok("watch" in data.byType, "has watch count");
    assert.ok("advisory" in data.byType, "has advisory count");
    assert.ok("statement" in data.byType, "has statement count");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});

// ─── /weather/avalanche ───────────────────────────────────────────

describe("GET /weather/avalanche", () => {
  it("returns avalanche forecasts", async () => {
    const { status, data } = await fetchJson("/avalanche");
    assert.equal(status, 200);
    assert.ok("count" in data, "has count");
    assert.ok(Array.isArray(data.forecasts), "has forecasts array");
    assert.ok("lastFetch" in data, "has lastFetch");
  });
});
