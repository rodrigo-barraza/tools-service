import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Utility Domain Endpoints ──────────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for all /utility/* endpoints
// (on-demand fetchers: currency, timezone, IP, places, airports).
// ──────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/utility`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── Currency Conversion ───────────────────────────────────────────

describe("GET /utility/currency/convert", () => {
  it("returns 400 when from/to are missing", async () => {
    const { status, data } = await fetchJson("/currency/convert?amount=100");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("converts USD to CAD", async () => {
    const { status, data } = await fetchJson("/currency/convert?from=USD&to=CAD&amount=100");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /utility/currency/list", () => {
  it("returns available currencies", async () => {
    const { status, data } = await fetchJson("/currency/list");
    assert.equal(status, 200);
    assert.ok(typeof data.count === "number", "has count");
    assert.ok(Array.isArray(data.currencies), "has currencies array");
  });
});

// ─── Timezone ──────────────────────────────────────────────────────

describe("GET /utility/timezone/:area/:location", () => {
  it("returns time in a timezone (or 502 if upstream down)", async () => {
    const { status, data } = await fetchJson("/timezone/America/Vancouver");
    assert.ok(status === 200 || status === 502, "returns 200 or 502");
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /utility/timezone/list", () => {
  it("returns timezone listing (or 502 if upstream down)", async () => {
    const { status, data } = await fetchJson("/timezone/list");
    assert.ok(status === 200 || status === 502, "returns 200 or 502");
    if (status === 200) {
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(Array.isArray(data.timezones) || typeof data.timezones === "object", "has timezones");
    }
  });
});

// ─── IP Geolocation ────────────────────────────────────────────────

describe("GET /utility/ip", () => {
  it("returns geolocation for own IP", async () => {
    const { status, data } = await fetchJson("/ip");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Airports (in-memory) ──────────────────────────────────────────

describe("GET /utility/airports/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/airports/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns airport search results", async () => {
    const { status, data } = await fetchJson("/airports/search?q=vancouver&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /utility/airports/code/:code", () => {
  it("returns airport data for YVR", async () => {
    const { status, data } = await fetchJson("/airports/code/YVR");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });

  it("returns 404 for nonexistent code", async () => {
    const { status } = await fetchJson("/airports/code/ZZZZZ");
    assert.equal(status, 404);
  });
});

describe("GET /utility/airports/country/:code", () => {
  it("returns airports for a country", async () => {
    const { status, data } = await fetchJson("/airports/country/CA?limit=10");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

describe("GET /utility/airports/nearest", () => {
  it("returns 400 when lat/lng are missing", async () => {
    const { status, data } = await fetchJson("/airports/nearest");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns nearest airports to Vancouver", async () => {
    const { status, data } = await fetchJson("/airports/nearest?lat=49.19&lng=-123.18&limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── Places (Google Places API) ────────────────────────────────────

describe("GET /utility/places/nearby", () => {
  it("returns 400 when type is missing", async () => {
    const { status, data } = await fetchJson("/places/nearby");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

describe("GET /utility/places/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/places/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});
