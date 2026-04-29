import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Trend Domain Cached Endpoints ────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for all /trend/* endpoints
// (cached trend listings, correlated hot trends, and searches).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/trend`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /trend/trends ─────────────────────────────────────────────────

describe("GET /trend/trends", () => {
  it("returns all cached trends across sources", async () => {
    const { status, data } = await fetchJson("/trends");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.sources === "object", "has sources summary");
    assert.ok(Array.isArray(data.trends), "has trends array");
  });
});

// ─── /trend/trends/hot ─────────────────────────────────────────────

describe("GET /trend/trends/hot", () => {
  it("returns cross-source correlated trends", async () => {
    const { status, data } = await fetchJson("/trends/hot");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.trends), "has trends array");
    // Each correlated trend should have sourceCount >= 2
    for (const t of data.trends) {
      assert.ok(t.sourceCount >= 2, `sourceCount >= 2 for "${t.name}"`);
      assert.ok(Array.isArray(t.sources), "has sources array");
    }
  });
});

// ─── /trend/trends/source/:source ──────────────────────────────────

describe("GET /trend/trends/source/:source", () => {
  it("returns trends for a specific source (reddit)", async () => {
    const { status, data } = await fetchJson("/trends/source/reddit");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.equal(data.source, "reddit", "echoes source");
    assert.ok(Array.isArray(data.trends), "has trends array");
  });

  it("returns empty for unknown source", async () => {
    const { data } = await fetchJson("/trends/source/nonexistent_xyz");
    assert.equal(data.count, 0);
    assert.deepEqual(data.trends, []);
  });
});

// ─── /trend/trends/category/:category ──────────────────────────────

describe("GET /trend/trends/category/:category", () => {
  it("returns trends filtered by category", async () => {
    const { status, data } = await fetchJson("/trends/category/news");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.equal(data.category, "news", "echoes category");
    assert.ok(Array.isArray(data.trends), "has trends array");
  });
});

// ─── /trend/trends/search ──────────────────────────────────────────

describe("GET /trend/trends/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/trends/search");
    assert.equal(status, 400);
    assert.ok(data.error, "has error message");
  });

  it("returns search results for a query", async () => {
    const { status, data } = await fetchJson("/trends/search?q=tech");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.equal(data.query, "tech", "echoes query");
    assert.ok(Array.isArray(data.trends), "has trends array");
  });
});
