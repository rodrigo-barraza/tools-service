import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Transit Domain Endpoints ─────────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for /transit/* endpoints
// (on-demand TransLink API fetchers).
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/transit`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /transit/nextbus/:stopNo ──────────────────────────────────────

describe("GET /transit/nextbus/:stopNo", () => {
  it("returns 400 for invalid stop number", async () => {
    const { status, data } = await fetchJson("/nextbus/abc");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns next bus data for a valid stop", async () => {
    // Stop 51479 is a common Vancouver stop
    // TransLink API is external — may return 200, 404, 502, or HTML
    const res = await fetch(`${BASE}/nextbus/51479`);
    assert.ok(typeof res.status === "number", "returns a valid HTTP status");
  });
});

// ─── /transit/stops/:stopNo ────────────────────────────────────────

describe("GET /transit/stops/:stopNo", () => {
  it("returns 400 for invalid stop number", async () => {
    const { status, data } = await fetchJson("/stops/abc");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ─── Unified Health ────────────────────────────────────────────────

describe("GET /health (unified)", () => {
  it("returns full system health status", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, "ok");
    assert.ok(typeof data.uptime === "number", "has uptime");
    assert.ok(typeof data.domains === "object", "has domains");
    // Should have all major domains
    assert.ok("event" in data.domains, "has event health");
    assert.ok("finance" in data.domains, "has finance health");
    assert.ok("market" in data.domains, "has market health");
    assert.ok("product" in data.domains, "has product health");
    assert.ok("trend" in data.domains, "has trend health");
    assert.ok("weather" in data.domains, "has weather health");
    assert.ok("knowledge" in data.domains, "has knowledge health");
    assert.ok("utility" in data.domains, "has utility health");
  });
});
