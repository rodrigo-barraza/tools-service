import request from "supertest";
import { createTestApp } from "./testApp.js";
import productRoutes from "../routes/ProductRoutes.js";

// ─── Unit Tests for Product Domain Endpoints ────────────────────
//
// Uses supertest to mount ProductRoutes in-process.
// ProductCache/BestBuyCAAvailabilityCache return empty defaults
// when no collector has run — tests validate route logic.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/product", productRoutes);

// ─── /product/products ─────────────────────────────────────────────

describe("GET /product/products", () => {
  it("returns all products with count", async () => {
    const res = await request(app).get("/product/products");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.products)).toBeTruthy();
  });
});

// ─── /product/products/trending ────────────────────────────────────

describe("GET /product/products/trending", () => {
  it("returns trending products", async () => {
    const res = await request(app).get("/product/products/trending?limit=10");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.products)).toBeTruthy();
  });
});

// ─── /product/products/categories ──────────────────────────────────

describe("GET /product/products/categories", () => {
  it("returns product categories with counts", async () => {
    const res = await request(app).get("/product/products/categories");
    expect(res.status).toBe(200);
    expect(typeof res.body.total === "number").toBeTruthy();
    expect(Array.isArray(res.body.categories)).toBeTruthy();
  });
});

// ─── /product/products/category/:category ──────────────────────────

describe("GET /product/products/category/:category", () => {
  it("returns products filtered by category", async () => {
    const res = await request(app).get("/product/products/category/electronics");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.products)).toBeTruthy();
    expect(res.body.category).toBe("electronics", "echoes category");
  });
});

// ─── /product/products/source/:source ──────────────────────────────

describe("GET /product/products/source/:source", () => {
  it("returns empty for unknown source", async () => {
    const res = await request(app).get("/product/products/source/nonexistent_xyz");
    expect(res.body.count).toBe(0);
  });
});

// ─── /product/products/search ──────────────────────────────────────

describe("GET /product/products/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/product/products/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns search results for a query", async () => {
    const res = await request(app).get("/product/products/search?q=phone");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(typeof res.body.query === "string").toBeTruthy();
    expect(Array.isArray(res.body.products)).toBeTruthy();
  });
});

// ─── /product/products/availability ────────────────────────────────

describe("GET /product/products/availability", () => {
  it("returns availability data", async () => {
    const res = await request(app).get("/product/products/availability");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(typeof res.body.inStockCount === "number").toBeTruthy();
    expect(Array.isArray(res.body.results)).toBeTruthy();
  });
});

// ─── /product/products/availability/in-stock ───────────────────────

describe("GET /product/products/availability/in-stock", () => {
  it("returns in-stock items", async () => {
    const res = await request(app).get("/product/products/availability/in-stock");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.results)).toBeTruthy();
  });
});

// ─── /product/products/availability/out-of-stock ───────────────────

describe("GET /product/products/availability/out-of-stock", () => {
  it("returns out-of-stock items", async () => {
    const res = await request(app).get("/product/products/availability/out-of-stock");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.results)).toBeTruthy();
  });
});

// ─── /product/products/availability/watchlist ──────────────────────

describe("GET /product/products/availability/watchlist", () => {
  it("returns the watchlist", async () => {
    const res = await request(app).get("/product/products/availability/watchlist");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.skus)).toBeTruthy();
  });
});

// ─── /product/products/availability/check ──────────────────────────

describe("GET /product/products/availability/check", () => {
  it("returns 400 when skus is missing", async () => {
    const res = await request(app).get("/product/products/availability/check");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
