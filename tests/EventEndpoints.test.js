import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Event Domain Cached Endpoints ────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes and data integrity for all
// /event/* endpoints (both cached and DB-backed).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/event`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /event/cached ─────────────────────────────────────────────────

describe("GET /event/cached", () => {
  it("returns all cached events with count", async () => {
    const { status, data } = await fetchJson("/cached");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.events), "has events array");
  });
});

// ─── /event/summary ────────────────────────────────────────────────

describe("GET /event/summary", () => {
  it("returns event summary with category and source breakdowns", async () => {
    const { status, data } = await fetchJson("/summary");
    assert.equal(status, 200);
    assert.ok(typeof data.total === "number", "has total");
    assert.ok(typeof data.today === "number", "has today count");
    assert.ok(typeof data.upcoming === "number", "has upcoming count");
    assert.ok(typeof data.byCategory === "object", "has byCategory");
    assert.ok(typeof data.bySource === "object", "has bySource");
    assert.ok(typeof data.lastFetch === "object", "has lastFetch map");
  });
});

// ─── /event/today ──────────────────────────────────────────────────

describe("GET /event/today", () => {
  it("returns today's events", async () => {
    const { status, data } = await fetchJson("/today");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(data.timezone, "has timezone");
    assert.ok(Array.isArray(data.events), "has events array");
  });
});

// ─── /event/upcoming ───────────────────────────────────────────────

describe("GET /event/upcoming", () => {
  it("returns upcoming events", async () => {
    const { status, data } = await fetchJson("/upcoming");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.days === "number", "has days");
    assert.ok(Array.isArray(data.events), "has events array");
  });

  it("respects days parameter", async () => {
    const { data } = await fetchJson("/upcoming?days=7&limit=10");
    assert.equal(data.days, 7);
  });
});

// ─── /event/past ───────────────────────────────────────────────────

describe("GET /event/past", () => {
  it("returns past events", async () => {
    const { status, data } = await fetchJson("/past");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.days === "number", "has days");
    assert.ok(Array.isArray(data.events), "has events array");
  });
});

// ─── /event/search ─────────────────────────────────────────────────

describe("GET /event/search", () => {
  it("returns search results with query echo", async () => {
    const { status, data } = await fetchJson("/search?q=concert");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(typeof data.query === "object", "has query echo");
    assert.ok(Array.isArray(data.events), "has events array");
  });

  it("returns empty results for nonsense query", async () => {
    const { data } = await fetchJson("/search?q=zzzxyznonexistent123");
    assert.equal(data.count, 0);
    assert.deepEqual(data.events, []);
  });
});
