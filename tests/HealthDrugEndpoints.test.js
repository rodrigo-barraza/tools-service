import request from "supertest";
import { createTestApp } from "./testApp.js";
import healthRoutes from "../routes/HealthRoutes.js";

// ─── Unit Tests for Health/Drug Endpoints ───────────────────────
//
// Uses supertest to mount HealthRoutes in-process.
// FDA NDC drug endpoints use in-memory CSV data.
// openFDA endpoints (drugs/search, drugs/adverse-events,
// drugs/recalls) hit external APIs — only validation tested.
// ─────────────────────────────────────────────────────────────────

const app = createTestApp("/health", healthRoutes);

// ═══════════════════════════════════════════════════════════════════
//  openFDA — validation-only (external API)
// ═══════════════════════════════════════════════════════════════════

describe("GET /health/drugs/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/health/drugs/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /health/drugs/adverse-events (validation)", () => {
  it("returns 400 when drug is missing", async () => {
    const res = await request(app).get("/health/drugs/adverse-events");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  FDA NDC — in-memory CSV data
// ═══════════════════════════════════════════════════════════════════

describe("GET /health/drugs/ndc/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/health/drugs/ndc/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns NDC drug search results", async () => {
    const res = await request(app).get("/health/drugs/ndc/search?q=ibuprofen&limit=5");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.drugs)).toBeTruthy();
    expect(res.body.drugs[0].genericName || res.body.drugs[0].brandName).toBeTruthy();
  });
});

describe("GET /health/drugs/ndc/dosage-forms", () => {
  it("returns available dosage forms", async () => {
    const res = await request(app).get("/health/drugs/ndc/dosage-forms");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalProducts === "number").toBeTruthy();
    expect(res.body.totalProducts > 0).toBeTruthy();
    expect(Array.isArray(res.body.dosageForms)).toBeTruthy();
  });
});

describe("GET /health/drugs/ndc/ingredient", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/health/drugs/ndc/ingredient");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns drugs by ingredient", async () => {
    const res = await request(app).get("/health/drugs/ndc/ingredient?q=acetaminophen&limit=5");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.drugs)).toBeTruthy();
  });
});

describe("GET /health/drugs/ndc/pharm-class", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/health/drugs/ndc/pharm-class");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns drugs by pharmacological class", async () => {
    const res = await request(app).get("/health/drugs/ndc/pharm-class?q=analgesic&limit=5");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(Array.isArray(res.body.drugs)).toBeTruthy();
  });
});
