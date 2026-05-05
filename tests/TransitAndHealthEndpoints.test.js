import request from "supertest";
import { createTestApp } from "./testApp.js";
import transitRoutes from "../routes/TransitRoutes.js";

// ─── Unit Tests for Transit Domain Endpoints ────────────────────
//
// Uses supertest to mount TransitRoutes in-process.
// TransLink API endpoints are external — validation-only tests.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/transit", transitRoutes);

// ─── /transit/nextbus/:stopNo ──────────────────────────────────────

describe("GET /transit/nextbus/:stopNo (validation)", () => {
  it("returns 400 for invalid (non-numeric) stop number", async () => {
    const res = await request(app).get("/transit/nextbus/abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── /transit/stops/:stopNo ────────────────────────────────────────

describe("GET /transit/stops/:stopNo (validation)", () => {
  it("returns 400 for invalid (non-numeric) stop number", async () => {
    const res = await request(app).get("/transit/stops/abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
