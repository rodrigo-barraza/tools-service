import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Finance Domain Cached Endpoints ──────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for /finance/* endpoints
// including polled (market news, earnings) and on-demand
// (quote, profile, recommendation, financials, FRED macro).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/finance`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /finance/news (polled cache) ──────────────────────────────────

describe("GET /finance/news", () => {
  it("returns cached market news articles", async () => {
    const { status, data } = await fetchJson("/news");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.articles), "has articles array");
  });
});

// ─── /finance/earnings (polled cache) ──────────────────────────────

describe("GET /finance/earnings", () => {
  it("returns cached earnings calendar", async () => {
    const { status, data } = await fetchJson("/earnings");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.earnings), "has earnings array");
  });
});

// ─── /finance/quote/:symbol (on-demand + TTL cache) ────────────────

describe("GET /finance/quote/:symbol", () => {
  it("returns a stock quote for AAPL", async () => {
    const { status, data } = await fetchJson("/quote/AAPL");
    assert.equal(status, 200);
    assert.equal(data.symbol, "AAPL");
    // Should have quote data fields
    assert.ok("cached" in data, "indicates cache hit/miss");
  });
});

// ─── /finance/profile/:symbol (on-demand + TTL cache) ──────────────

describe("GET /finance/profile/:symbol", () => {
  it("returns a company profile for AAPL", async () => {
    const { status, data } = await fetchJson("/profile/AAPL");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns an object");
  });
});

// ─── /finance/recommendation/:symbol (on-demand + TTL cache) ───────

describe("GET /finance/recommendation/:symbol", () => {
  it("returns analyst recommendations for AAPL", async () => {
    const { status, data } = await fetchJson("/recommendation/AAPL");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /finance/financials/:symbol (on-demand + TTL cache) ───────────

describe("GET /finance/financials/:symbol", () => {
  it("returns basic financials for AAPL", async () => {
    const { status, data } = await fetchJson("/financials/AAPL");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /finance/macro/indicators (FRED on-demand) ────────────────────

describe("GET /finance/macro/indicators", () => {
  it("returns key macroeconomic indicators", async () => {
    const { status, data } = await fetchJson("/macro/indicators");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /finance/macro/search (FRED on-demand) ────────────────────────

describe("GET /finance/macro/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/macro/search");
    assert.equal(status, 400);
    assert.ok(data.error, "has error message");
  });

  it("returns FRED series results for GDP", async () => {
    const { status, data } = await fetchJson("/macro/search?q=GDP&limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});
