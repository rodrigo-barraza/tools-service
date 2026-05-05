import request from "supertest";
import { createTestApp } from "./testApp.js";
import eventRoutes from "../routes/EventRoutes.js";

// ─── Unit Tests for Event Domain Endpoints ──────────────────────
//
// Uses supertest to mount EventRoutes in-process.
// EventCache returns empty defaults, DB-backed routes (today,
// upcoming, past, search) require MongoDB but test validation.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/event", eventRoutes);

// ─── /event/cached ─────────────────────────────────────────────────

describe("GET /event/cached", () => {
  it("returns all cached events with count", async () => {
    const res = await request(app).get("/event/cached");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.events)).toBeTruthy();
  });
});

// ─── /event/summary ────────────────────────────────────────────────

describe("GET /event/summary", () => {
  it("returns event summary with category and source breakdowns", async () => {
    const res = await request(app).get("/event/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.total === "number").toBeTruthy();
    expect(typeof res.body.today === "number").toBeTruthy();
    expect(typeof res.body.upcoming === "number").toBeTruthy();
    expect(typeof res.body.byCategory === "object").toBeTruthy();
    expect(typeof res.body.bySource === "object").toBeTruthy();
    expect(typeof res.body.lastFetch === "object").toBeTruthy();
  });
});

// ─── /event/events (unified dispatcher) ────────────────────────────

describe("GET /event/events", () => {
  it("returns 400 when action is missing", async () => {
    const res = await request(app).get("/event/events");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(Array.isArray(res.body.actions)).toBeTruthy();
  });

  it("returns summary for action=summary", async () => {
    const res = await request(app).get("/event/events?action=summary");
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("summary");
  });

  it("returns 400 for unknown action", async () => {
    const res = await request(app).get("/event/events?action=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
