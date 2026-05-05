import request from "supertest";
import { createTestApp } from "./testApp.js";
import trendRoutes from "../routes/TrendRoutes.js";

// ─── Unit Tests for Trend Domain Endpoints ──────────────────────
//
// Uses supertest to mount TrendRoutes in-process.
// TrendCache returns empty defaults when no collector has run —
// tests validate route logic, status codes, and response shapes.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/trend", trendRoutes);

// ─── /trend/trends ─────────────────────────────────────────────────

describe("GET /trend/trends", () => {
  it("returns all cached trends", async () => {
    const res = await request(app).get("/trend/trends");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(typeof res.body.sources === "object").toBeTruthy();
    expect(Array.isArray(res.body.trends)).toBeTruthy();
  });
});

// ─── /trend/trends/hot ─────────────────────────────────────────────

describe("GET /trend/trends/hot", () => {
  it("returns cross-source correlated trends", async () => {
    const res = await request(app).get("/trend/trends/hot");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.trends)).toBeTruthy();
  });
});

// ─── /trend/trends/source/:source ──────────────────────────────────

describe("GET /trend/trends/source/:source", () => {
  it("returns trends for a specific source", async () => {
    const res = await request(app).get("/trend/trends/source/reddit");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.source).toBe("reddit", "echoes source");
    expect(Array.isArray(res.body.trends)).toBeTruthy();
  });

  it("returns empty for unknown source", async () => {
    const res = await request(app).get("/trend/trends/source/nonexistent_xyz");
    expect(res.body.count).toBe(0);
    expect(res.body.trends).toEqual([]);
  });
});

// ─── /trend/trends/category/:category ──────────────────────────────

describe("GET /trend/trends/category/:category", () => {
  it("returns trends filtered by category", async () => {
    const res = await request(app).get("/trend/trends/category/news");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.category).toBe("news", "echoes category");
    expect(Array.isArray(res.body.trends)).toBeTruthy();
  });
});

// ─── /trend/trends/search ──────────────────────────────────────────

describe("GET /trend/trends/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/trend/trends/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns search results for a query", async () => {
    const res = await request(app).get("/trend/trends/search?q=tech");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.query).toBe("tech", "echoes query");
    expect(Array.isArray(res.body.trends)).toBeTruthy();
  });
});

// ─── /trend/data (unified dispatcher) ──────────────────────────────

describe("GET /trend/data", () => {
  it("returns 400 when action is missing", async () => {
    const res = await request(app).get("/trend/data");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(Array.isArray(res.body.actions)).toBeTruthy();
  });

  it("returns current for action=current", async () => {
    const res = await request(app).get("/trend/data?action=current");
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("current");
  });

  it("returns hot for action=hot", async () => {
    const res = await request(app).get("/trend/data?action=hot");
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("hot");
  });

  it("returns 400 for unknown action", async () => {
    const res = await request(app).get("/trend/data?action=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
