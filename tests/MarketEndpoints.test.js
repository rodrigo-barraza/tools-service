import request from "supertest";
import { createTestApp } from "./testApp.js";
import marketRoutes from "../routes/MarketRoutes.js";

// ─── Unit Tests for Market Domain Endpoints ─────────────────────
//
// Uses supertest to mount the MarketRoutes router in-process.
// CommodityCache functions return empty/default data when no
// collector has run — tests validate route logic, status codes,
// and response shapes without requiring a live server.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/market", marketRoutes);

// ─── /market/commodities ───────────────────────────────────────────

describe("GET /market/commodities", () => {
  it("returns commodity quotes as an array", async () => {
    const res = await request(app).get("/market/commodities");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
  });
});

// ─── /market/commodities/summary ───────────────────────────────────

describe("GET /market/commodities/summary", () => {
  it("returns commodity market summary", async () => {
    const res = await request(app).get("/market/commodities/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.total === "number").toBeTruthy();
    expect("lastFetch" in res.body).toBeTruthy();
  });
});

// ─── /market/commodities/categories ────────────────────────────────

describe("GET /market/commodities/categories", () => {
  it("returns list of valid categories", async () => {
    const res = await request(app).get("/market/commodities/categories");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length > 0).toBeTruthy();
  });
});

// ─── /market/commodities/category/:category ────────────────────────

describe("GET /market/commodities/category/:category", () => {
  it("returns 400 for invalid category", async () => {
    const res = await request(app).get("/market/commodities/category/invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── /market/commodities/ticker/:ticker ────────────────────────────

describe("GET /market/commodities/ticker/:ticker", () => {
  it("returns 404 for nonexistent ticker", async () => {
    const res = await request(app).get("/market/commodities/ticker/NOTREAL99");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── /market/commodities/data (unified dispatcher) ─────────────────

describe("GET /market/commodities/data", () => {
  it("returns 400 when action is missing", async () => {
    const res = await request(app).get("/market/commodities/data");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(Array.isArray(res.body.actions)).toBeTruthy();
  });

  it("returns summary for action=summary", async () => {
    const res = await request(app).get("/market/commodities/data?action=summary");
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("summary");
  });

  it("returns categories for action=categories", async () => {
    const res = await request(app).get("/market/commodities/data?action=categories");
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("categories");
    expect(Array.isArray(res.body.categories)).toBeTruthy();
  });

  it("returns 400 for unknown action", async () => {
    const res = await request(app).get("/market/commodities/data?action=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
