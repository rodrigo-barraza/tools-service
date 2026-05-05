import request from "supertest";
import { createTestApp } from "./testApp.js";
import utilityRoutes from "../routes/UtilityRoutes.js";

// ─── Unit Tests for Utility Domain Endpoints ────────────────────
//
// Uses supertest to mount UtilityRoutes in-process.
// Airport endpoints use in-memory CSV data — full tests.
// External API endpoints (currency, timezone, IP, places)
// are tested for input validation only.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/utility", utilityRoutes);

// ═══════════════════════════════════════════════════════════════════
//  Airports — in-memory CSV data
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/airports/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/utility/airports/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns airport search results", async () => {
    const res = await request(app).get("/utility/airports/search?q=vancouver&limit=5");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.airports)).toBeTruthy();
    expect(res.body.airports[0].name).toBeTruthy();
    expect(res.body.airports[0].iataCode).toBeTruthy();
  });
});

describe("GET /utility/airports/code/:code", () => {
  it("returns airport data for YVR", async () => {
    const res = await request(app).get("/utility/airports/code/YVR");
    expect(res.status).toBe(200);
    expect(res.body.iataCode).toBe("YVR");
    expect(res.body.name).toBeTruthy();
    expect(res.body.city).toBeTruthy();
    expect(res.body.countryCode).toBeTruthy();
    expect(typeof res.body.latitude === "number").toBeTruthy();
    expect(typeof res.body.longitude === "number").toBeTruthy();
  });

  it("returns 404 for nonexistent code", async () => {
    const res = await request(app).get("/utility/airports/code/ZZZZZ");
    expect(res.status).toBe(404);
  });
});

describe("GET /utility/airports/country/:code", () => {
  it("returns airports for a country", async () => {
    const res = await request(app).get("/utility/airports/country/CA?limit=10");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.airports)).toBeTruthy();
    expect(res.body.countryCode).toBe("CA");
  });
});

describe("GET /utility/airports/nearest", () => {
  it("returns 400 when lat/lng are missing", async () => {
    const res = await request(app).get("/utility/airports/nearest");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns nearest airports to Vancouver", async () => {
    const res = await request(app).get("/utility/airports/nearest?lat=49.19&lng=-123.18&limit=3");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.airports)).toBeTruthy();
    expect(typeof res.body.airports[0].distanceKm === "number").toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Currency — validation-only (external API)
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/currency/convert (validation)", () => {
  it("returns 400 when from/to are missing", async () => {
    const res = await request(app).get("/utility/currency/convert?amount=100");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /utility/currency/list", () => {
  it("returns available currencies", async () => {
    const res = await request(app).get("/utility/currency/list");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.currencies)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Places — validation-only (external API)
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/places/nearby (validation)", () => {
  it("returns 400 when type is missing", async () => {
    const res = await request(app).get("/utility/places/nearby");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /utility/places/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/utility/places/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
