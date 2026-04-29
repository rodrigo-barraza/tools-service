import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Market Domain Cached Endpoints ───────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for all /market/* commodity
// endpoints (all cached/polled).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/market`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /market/commodities ───────────────────────────────────────────

describe("GET /market/commodities", () => {
  it("returns all commodity quotes as an array", async () => {
    const { status, data } = await fetchJson("/commodities");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
  });
});

// ─── /market/commodities/summary ───────────────────────────────────

describe("GET /market/commodities/summary", () => {
  it("returns commodity market summary", async () => {
    const { status, data } = await fetchJson("/commodities/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.total === "number", "has total");
    assert.ok("lastFetch" in data, "has lastFetch");
    if (data.total > 0) {
      assert.ok(Array.isArray(data.gainers), "has gainers array");
      assert.ok(Array.isArray(data.losers), "has losers array");
      assert.ok(typeof data.byCategory === "object", "has byCategory");
    }
  });
});

// ─── /market/commodities/categories ────────────────────────────────

describe("GET /market/commodities/categories", () => {
  it("returns list of valid categories", async () => {
    const { status, data } = await fetchJson("/commodities/categories");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), "response is an array");
    assert.ok(data.length > 0, "has at least one category");
  });
});

// ─── /market/commodities/category/:category ────────────────────────

describe("GET /market/commodities/category/:category", () => {
  it("returns commodities filtered by a valid category", async () => {
    // First get the valid categories
    const { data: categories } = await fetchJson("/commodities/categories");
    if (categories.length > 0) {
      const cat = categories[0];
      const { status, data } = await fetchJson(`/commodities/category/${cat}`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(data), "response is an array");
    }
  });

  it("returns 400 for invalid category", async () => {
    const { status, data } = await fetchJson("/commodities/category/invalid_xyz");
    assert.equal(status, 400);
    assert.ok(data.error, "has error message");
  });
});

// ─── /market/commodities/ticker/:ticker ────────────────────────────

describe("GET /market/commodities/ticker/:ticker", () => {
  it("returns a single commodity by ticker (GC=F for gold)", async () => {
    const { status, data } = await fetchJson("/commodities/ticker/GC=F");
    // Could be 200 or 404 depending on whether gold is tracked
    if (status === 200) {
      assert.ok(data.ticker, "has ticker");
      assert.ok(data.name, "has name");
    } else {
      assert.equal(status, 404);
      assert.ok(data.error, "has error message");
    }
  });

  it("returns 404 for nonexistent ticker", async () => {
    const { status, data } = await fetchJson("/commodities/ticker/NOTREAL99");
    assert.equal(status, 404);
    assert.ok(data.error, "has error message");
  });
});
