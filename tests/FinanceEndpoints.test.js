import request from "supertest";
import { createTestApp } from "./testApp.js";
import financeRoutes from "../routes/FinanceRoutes.js";

// ─── Unit Tests for Finance Domain Endpoints ────────────────────
//
// Uses supertest to mount FinanceRoutes in-process.
// Cache-backed endpoints return empty defaults. Tests validate
// route logic, validation, and response shapes.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/finance", financeRoutes);

// ─── /finance/news (cached poll) ──────────────────────────────────

describe("GET /finance/news", () => {
  it("returns cached market news articles", async () => {
    const res = await request(app).get("/finance/news");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.articles)).toBeTruthy();
  });
});

// ─── /finance/earnings (cached poll) ──────────────────────────────

describe("GET /finance/earnings", () => {
  it("returns cached earnings calendar", async () => {
    const res = await request(app).get("/finance/earnings");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.earnings)).toBeTruthy();
  });
});

// ─── /finance/macro/search ────────────────────────────────────────

describe("GET /finance/macro/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/finance/macro/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── /finance/stock/data (unified dispatcher) ──────────────────────

describe("GET /finance/stock/data", () => {
  it("returns 400 when action/symbol are missing", async () => {
    const res = await request(app).get("/finance/stock/data");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(Array.isArray(res.body.actions)).toBeTruthy();
  });

  it("returns 400 for unknown action", async () => {
    const res = await request(app).get("/finance/stock/data?action=invalid_xyz&symbol=AAPL");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── /finance/macro/data (unified dispatcher) ──────────────────────

describe("GET /finance/macro/data", () => {
  it("returns 400 when action is missing", async () => {
    const res = await request(app).get("/finance/macro/data");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(Array.isArray(res.body.actions)).toBeTruthy();
  });

  it("returns 400 for unknown action", async () => {
    const res = await request(app).get("/finance/macro/data?action=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
