import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Health Domain Endpoints ──────────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes for /health/* endpoints
// EXCLUDING nutrition (covered by NutritionEndpoints.test.js).
// Covers: openFDA drugs, FDA NDC drugs.
// ─────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/health`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /health/drugs/search (openFDA) ────────────────────────────────

describe("GET /health/drugs/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/drugs/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns drug label results", async () => {
    const { status, data } = await fetchJson("/drugs/search?q=aspirin&limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /health/drugs/adverse-events (openFDA) ────────────────────────

describe("GET /health/drugs/adverse-events", () => {
  it("returns 400 when drug is missing", async () => {
    const { status, data } = await fetchJson("/drugs/adverse-events");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns adverse event data", async () => {
    const { status, data } = await fetchJson("/drugs/adverse-events?drug=aspirin&limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /health/drugs/recalls (openFDA) ───────────────────────────────

describe("GET /health/drugs/recalls", () => {
  it("returns drug recall data", async () => {
    const { status, data } = await fetchJson("/drugs/recalls?limit=3");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /health/drugs/ndc/search (in-memory FDA NDC) ──────────────────

describe("GET /health/drugs/ndc/search", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns NDC drug search results", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/search?q=ibuprofen&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /health/drugs/ndc/dosage-forms ────────────────────────────────

describe("GET /health/drugs/ndc/dosage-forms", () => {
  it("returns available dosage forms", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/dosage-forms");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /health/drugs/ndc/ingredient ──────────────────────────────────

describe("GET /health/drugs/ndc/ingredient", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/ingredient");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns drugs by ingredient", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/ingredient?q=acetaminophen&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});

// ─── /health/drugs/ndc/pharm-class ─────────────────────────────────

describe("GET /health/drugs/ndc/pharm-class", () => {
  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/pharm-class");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns drugs by pharmacological class", async () => {
    const { status, data } = await fetchJson("/drugs/ndc/pharm-class?q=analgesic&limit=5");
    assert.equal(status, 200);
    assert.ok(typeof data === "object", "returns data");
  });
});
