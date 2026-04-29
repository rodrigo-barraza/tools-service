import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Product Domain Cached Endpoints ──────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for all /product/* endpoints
// (cached product listings + Best Buy CA availability).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/product`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /product/products ─────────────────────────────────────────────

describe("GET /product/products", () => {
  it("returns all products with count", async () => {
    const { status, data } = await fetchJson("/products");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.products), "has products array");
  });
});

// ─── /product/products/trending ────────────────────────────────────

describe("GET /product/products/trending", () => {
  it("returns trending products", async () => {
    const { status, data } = await fetchJson("/products/trending?limit=10");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.products), "has products array");
  });
});

// ─── /product/products/categories ──────────────────────────────────

describe("GET /product/products/categories", () => {
  it("returns product categories with counts", async () => {
    const { status, data } = await fetchJson("/products/categories");
    assert.equal(status, 200);
    assert.ok(typeof data.total === "number", "has total");
    assert.ok(Array.isArray(data.categories), "has categories array");
  });
});

// ─── /product/products/category/:category ──────────────────────────

describe("GET /product/products/category/:category", () => {
  it("returns products filtered by category", async () => {
    const { status, data } = await fetchJson("/products/category/electronics");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.products), "has products array");
    assert.equal(data.category, "electronics", "echoes category");
  });
});

// ─── /product/products/source/:source ──────────────────────────────

describe("GET /product/products/source/:source", () => {
  it("returns products filtered by source", async () => {
    const { status, data } = await fetchJson("/products/source/bestbuy");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.products), "has products array");
  });

  it("returns empty for unknown source", async () => {
    const { data } = await fetchJson("/products/source/nonexistent_xyz");
    assert.equal(data.count, 0);
  });
});

// ─── /product/products/search ──────────────────────────────────────

describe("GET /product/products/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/products/search");
    assert.equal(status, 400);
    assert.ok(data.error, "has error message");
  });

  it("returns search results for a query", async () => {
    const { status, data } = await fetchJson("/products/search?q=phone");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.query === "string", "echoes query");
    assert.ok(Array.isArray(data.products), "has products array");
  });
});

// ─── /product/products/availability ────────────────────────────────

describe("GET /product/products/availability", () => {
  it("returns Best Buy CA availability data", async () => {
    const { status, data } = await fetchJson("/products/availability");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.inStockCount === "number", "has inStockCount");
    assert.ok(Array.isArray(data.results), "has results array");
  });
});

// ─── /product/products/availability/in-stock ───────────────────────

describe("GET /product/products/availability/in-stock", () => {
  it("returns only in-stock items", async () => {
    const { status, data } = await fetchJson("/products/availability/in-stock");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.results), "has results array");
  });
});

// ─── /product/products/availability/out-of-stock ───────────────────

describe("GET /product/products/availability/out-of-stock", () => {
  it("returns only out-of-stock items", async () => {
    const { status, data } = await fetchJson("/products/availability/out-of-stock");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.results), "has results array");
  });
});

// ─── /product/products/availability/watchlist ──────────────────────

describe("GET /product/products/availability/watchlist", () => {
  it("returns the watchlist with SKU metadata", async () => {
    const { status, data } = await fetchJson("/products/availability/watchlist");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.skus), "has skus array");
  });
});
