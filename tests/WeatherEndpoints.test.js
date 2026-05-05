import request from "supertest";
import { createTestApp } from "./testApp.js";
import weatherRoutes from "../routes/WeatherRoutes.js";

// ─── Unit Tests for Weather Domain Endpoints ────────────────────
//
// Uses supertest to mount WeatherRoutes in-process.
// All caches return empty/default data when no collector has run.
// Tests validate route logic, status codes, and response shapes.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/weather", weatherRoutes);

// ─── /weather/weather ──────────────────────────────────────────────

describe("GET /weather/weather", () => {
  it("returns the merged weather snapshot", async () => {
    const res = await request(app).get("/weather/weather");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
  });
});

// ─── /weather/weather/current ──────────────────────────────────────

describe("GET /weather/weather/current", () => {
  it("returns current conditions without forecast arrays", async () => {
    const res = await request(app).get("/weather/weather/current");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
    expect(res.body.hourlyForecast).toBe(undefined, "hourlyForecast excluded");
    expect(res.body.dailyForecast).toBe(undefined, "dailyForecast excluded");
  });
});

// ─── /weather/weather/forecast ─────────────────────────────────────

describe("GET /weather/weather/forecast", () => {
  it("returns forecast arrays", async () => {
    const res = await request(app).get("/weather/weather/forecast");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hourlyForecast)).toBeTruthy();
    expect(Array.isArray(res.body.dailyForecast)).toBeTruthy();
  });
});

// ─── /weather/weather/air ──────────────────────────────────────────

describe("GET /weather/weather/air", () => {
  it("returns air quality data", async () => {
    const res = await request(app).get("/weather/weather/air");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hourlyAirQuality)).toBeTruthy();
  });
});

// ─── /weather/weather/daylight ─────────────────────────────────────

describe("GET /weather/weather/daylight", () => {
  it("returns daylight data", async () => {
    const res = await request(app).get("/weather/weather/daylight");
    expect(res.status).toBe(200);
    // May return empty object when no data collected yet
    expect(typeof res.body).toBe("object");
  });
});

// ─── /weather/earthquakes ──────────────────────────────────────────

describe("GET /weather/earthquakes", () => {
  it("returns an array of earthquake events", async () => {
    const res = await request(app).get("/weather/earthquakes");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

describe("GET /weather/earthquakes/summary", () => {
  it("returns earthquake summary", async () => {
    const res = await request(app).get("/weather/earthquakes/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.total === "number").toBeTruthy();
    expect(typeof res.body.counts === "object").toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/neo ──────────────────────────────────────────────────

describe("GET /weather/neo", () => {
  it("returns an array of near-Earth objects", async () => {
    const res = await request(app).get("/weather/neo");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

describe("GET /weather/neo/summary", () => {
  it("returns NEO summary", async () => {
    const res = await request(app).get("/weather/neo/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.total === "number").toBeTruthy();
    expect(typeof res.body.hazardousCount === "number").toBeTruthy();
    expect("closest" in res.body).toBeTruthy();
    expect("largest" in res.body).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/space-weather ────────────────────────────────────────

describe("GET /weather/space-weather", () => {
  it("returns combined space weather data", async () => {
    const res = await request(app).get("/weather/space-weather");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.flares)).toBeTruthy();
    expect(Array.isArray(res.body.cmes)).toBeTruthy();
    expect(Array.isArray(res.body.storms)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/space-weather/flares", () => {
  it("returns an array of solar flares", async () => {
    const res = await request(app).get("/weather/space-weather/flares");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

describe("GET /weather/space-weather/cmes", () => {
  it("returns an array of CMEs", async () => {
    const res = await request(app).get("/weather/space-weather/cmes");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

describe("GET /weather/space-weather/storms", () => {
  it("returns an array of geomagnetic storms", async () => {
    const res = await request(app).get("/weather/space-weather/storms");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

describe("GET /weather/space-weather/summary", () => {
  it("returns space weather summary", async () => {
    const res = await request(app).get("/weather/space-weather/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.flareCount === "number").toBeTruthy();
    expect(typeof res.body.cmeCount === "number").toBeTruthy();
    expect(typeof res.body.stormCount === "number").toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/iss ──────────────────────────────────────────────────

describe("GET /weather/iss", () => {
  it("returns ISS position and astronaut data", async () => {
    const res = await request(app).get("/weather/iss");
    expect(res.status).toBe(200);
    expect("position" in res.body).toBeTruthy();
    expect("astronauts" in res.body).toBeTruthy();
  });
});

describe("GET /weather/iss/trajectory", () => {
  it("returns an array of trajectory points", async () => {
    const res = await request(app).get("/weather/iss/trajectory");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

// ─── /weather/kp ───────────────────────────────────────────────────

describe("GET /weather/kp", () => {
  it("returns Kp index history", async () => {
    const res = await request(app).get("/weather/kp");
    expect(res.status).toBe(200);
    expect("count" in res.body).toBeTruthy();
    expect(Array.isArray(res.body.readings)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/kp/current", () => {
  it("returns current Kp with classification", async () => {
    const res = await request(app).get("/weather/kp/current");
    expect(res.status).toBe(200);
    expect("current" in res.body).toBeTruthy();
    expect("classification" in res.body).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/wildfires ────────────────────────────────────────────

describe("GET /weather/wildfires", () => {
  it("returns wildfire events", async () => {
    const res = await request(app).get("/weather/wildfires");
    expect(res.status).toBe(200);
    expect("count" in res.body).toBeTruthy();
    expect(Array.isArray(res.body.events)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/wildfires/summary", () => {
  it("returns wildfire summary", async () => {
    const res = await request(app).get("/weather/wildfires/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect("largest" in res.body).toBeTruthy();
    expect(typeof res.body.openCount === "number").toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/tides ────────────────────────────────────────────────

describe("GET /weather/tides", () => {
  it("returns tide predictions", async () => {
    const res = await request(app).get("/weather/tides");
    expect(res.status).toBe(200);
    expect("count" in res.body).toBeTruthy();
    expect(Array.isArray(res.body.predictions)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/tides/next", () => {
  it("returns next tide prediction", async () => {
    const res = await request(app).get("/weather/tides/next");
    expect(res.status).toBe(200);
    expect("next" in res.body).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/solar-wind ───────────────────────────────────────────

describe("GET /weather/solar-wind", () => {
  it("returns solar wind data", async () => {
    const res = await request(app).get("/weather/solar-wind");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plasma)).toBeTruthy();
    expect(Array.isArray(res.body.magnetic)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/solar-wind/latest", () => {
  it("returns latest solar wind reading", async () => {
    const res = await request(app).get("/weather/solar-wind/latest");
    expect(res.status).toBe(200);
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/airquality/google ────────────────────────────────────

describe("GET /weather/airquality/google", () => {
  it("returns Google air quality data or no_data", async () => {
    const res = await request(app).get("/weather/airquality/google");
    expect(res.status).toBe(200);
    expect(typeof res.body === "object").toBeTruthy();
  });
});

// ─── /weather/pollen ───────────────────────────────────────────────

describe("GET /weather/pollen", () => {
  it("returns pollen forecast data or no_data", async () => {
    const res = await request(app).get("/weather/pollen");
    expect(res.status).toBe(200);
    expect(typeof res.body === "object").toBeTruthy();
  });
});

describe("GET /weather/pollen/today", () => {
  it("returns today's pollen or no_data", async () => {
    const res = await request(app).get("/weather/pollen/today");
    expect(res.status).toBe(200);
    expect(typeof res.body === "object").toBeTruthy();
  });
});

// ─── /weather/apod ─────────────────────────────────────────────────

describe("GET /weather/apod", () => {
  it("returns APOD data or no_data", async () => {
    const res = await request(app).get("/weather/apod");
    expect(res.status).toBe(200);
    expect(typeof res.body === "object").toBeTruthy();
  });
});

// ─── /weather/launches ─────────────────────────────────────────────

describe("GET /weather/launches", () => {
  it("returns upcoming launches", async () => {
    const res = await request(app).get("/weather/launches");
    expect(res.status).toBe(200);
    expect("count" in res.body).toBeTruthy();
    expect(Array.isArray(res.body.launches)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/launches/next", () => {
  it("returns the next upcoming launch", async () => {
    const res = await request(app).get("/weather/launches/next");
    expect(res.status).toBe(200);
    expect("next" in res.body).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/launches/summary", () => {
  it("returns launch summary", async () => {
    const res = await request(app).get("/weather/launches/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(typeof res.body.upcomingCount === "number").toBeTruthy();
    expect(Array.isArray(res.body.providers)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/twilight ─────────────────────────────────────────────

describe("GET /weather/twilight", () => {
  it("returns twilight data or no_data", async () => {
    const res = await request(app).get("/weather/twilight");
    expect(res.status).toBe(200);
    expect(typeof res.body === "object").toBeTruthy();
  });
});

// ─── /weather/warnings ─────────────────────────────────────────────

describe("GET /weather/warnings", () => {
  it("returns environment Canada warnings", async () => {
    const res = await request(app).get("/weather/warnings");
    expect(res.status).toBe(200);
    expect("count" in res.body).toBeTruthy();
    expect(Array.isArray(res.body.warnings)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

describe("GET /weather/warnings/count", () => {
  it("returns warning counts by type", async () => {
    const res = await request(app).get("/weather/warnings/count");
    expect(res.status).toBe(200);
    expect(typeof res.body.total === "number").toBeTruthy();
    expect(typeof res.body.byType === "object").toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /weather/avalanche ───────────────────────────────────────────

describe("GET /weather/avalanche", () => {
  it("returns avalanche forecasts", async () => {
    const res = await request(app).get("/weather/avalanche");
    expect(res.status).toBe(200);
    expect("count" in res.body).toBeTruthy();
    expect(Array.isArray(res.body.forecasts)).toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});
