import request from "supertest";
import express from "express";
import { fieldProjectionMiddleware } from "../middleware/FieldProjectionMiddleware.js";
import knowledgeRoutes from "../routes/KnowledgeRoutes.js";
import healthRoutes from "../routes/HealthRoutes.js";
import utilityRoutes from "../routes/UtilityRoutes.js";

// ─── Schema Regression Tests for Static In-Memory Datasets ──────
//
// Uses supertest to mount domain routers in-process.
// All tested endpoints load CSV data at import time — no network
// calls, no MongoDB, no external APIs required.
//
// Tests deeper schema assertions than KnowledgeEndpoints/etc.
// to catch field renames, missing properties, and data regressions.
// ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(fieldProjectionMiddleware);
app.use("/knowledge", knowledgeRoutes);
app.use("/health", healthRoutes);
app.use("/utility", utilityRoutes);

// ═══════════════════════════════════════════════════════════════════
//  Periodic Table — /knowledge/elements/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: Periodic Table", () => {
  it("search returns elements with full schema", async () => {
    const res = await request(app).get("/knowledge/elements/search?q=hydrogen");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    const el = res.body.elements[0];
    for (const key of [
      "atomicNumber", "symbol", "name", "atomicMass", "category",
      "period", "block", "electronConfiguration", "phaseAtSTP", "summary",
    ]) {
      expect(key in el, `element has ${key}`).toBeTruthy();
    }
    expect(el.name).toBe("Hydrogen");
    expect(el.atomicNumber).toBe(1);
  });

  it("lookup returns full element for Fe", async () => {
    const res = await request(app).get("/knowledge/elements/Fe");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("Fe");
    expect(res.body.name).toBe("Iron");
    expect(res.body.atomicMass > 55 && res.body.atomicMass < 56).toBeTruthy();
  });

  it("rank returns descending elements with value field", async () => {
    const res = await request(app).get("/knowledge/elements/rank?property=atomic_mass&limit=5&order=desc");
    expect(res.status).toBe(200);
    expect(res.body.property).toBe("atomic_mass");
    expect(res.body.elements.length <= 5).toBeTruthy();
    for (let i = 1; i < res.body.elements.length; i++) {
      expect(res.body.elements[i - 1].value >= res.body.elements[i].value).toBeTruthy();
    }
  });

  it("rank returns error with availableProperties for invalid property", async () => {
    const res = await request(app).get("/knowledge/elements/rank?property=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error.includes("Unknown property")).toBeTruthy();
    expect(res.body.availableProperties[0].key).toBeTruthy();
    expect(res.body.availableProperties[0].label).toBeTruthy();
  });

  it("categories returns blocks, phases, rankableProperties", async () => {
    const res = await request(app).get("/knowledge/elements/categories");
    expect(res.status).toBe(200);
    expect(res.body.totalElements >= 118).toBeTruthy();
    expect(res.body.blocks.includes("s")).toBeTruthy();
    expect(res.body.blocks.includes("d")).toBeTruthy();
    expect(res.body.rankableProperties[0].key).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  World Bank Indicators — /knowledge/indicators/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: World Bank Indicators", () => {
  it("country/CAN returns Canada with expected indicators", async () => {
    const res = await request(app).get("/knowledge/indicators/country/CAN");
    expect(res.status).toBe(200);
    expect(res.body.countryCode).toBe("CAN");
    expect(res.body.countryName).toBe("Canada");
    for (const key of ["population", "gdp_usd", "gdp_per_capita_usd", "life_expectancy"]) {
      expect(res.body.indicators[key], `has ${key}`).toBeTruthy();
      expect(res.body.indicators[key].label).toBeTruthy();
      expect(typeof res.body.indicators[key].value === "number").toBeTruthy();
    }
    const pop = res.body.indicators.population.value;
    expect(pop > 30_000_000 && pop < 50_000_000).toBeTruthy();
  });

  it("rank by population returns descending with >1B top", async () => {
    const res = await request(app).get("/knowledge/indicators/rank?indicator=population&limit=5&order=desc");
    expect(res.status).toBe(200);
    expect(res.body.indicator).toBe("population");
    expect(res.body.countries[0].value > 1_000_000_000).toBeTruthy();
    for (let i = 1; i < res.body.countries.length; i++) {
      expect(res.body.countries[i - 1].value >= res.body.countries[i].value).toBeTruthy();
    }
  });

  it("rank returns error with availableIndicators for invalid indicator", async () => {
    const res = await request(app).get("/knowledge/indicators/rank?indicator=invalid_xyz");
    expect(res.status).toBe(400);
    expect(res.body.availableIndicators[0].key).toBeTruthy();
    expect(res.body.availableIndicators[0].unit).toBeTruthy();
  });

  it("compare USA,CAN returns both countries with indicators", async () => {
    const res = await request(app).get("/knowledge/indicators/compare?countries=USA,CAN");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    for (const entry of res.body.comparison) {
      expect(entry.found).toBe(true);
      expect(entry.countryCode).toBeTruthy();
      expect(typeof entry.indicators === "object").toBeTruthy();
    }
  });

  it("compare with indicator filter returns single-indicator entries", async () => {
    const res = await request(app).get("/knowledge/indicators/compare?countries=USA,CAN&indicator=gdp_per_capita_usd");
    for (const entry of res.body.comparison) {
      expect(entry.indicator).toBe("gdp_per_capita_usd");
      expect(typeof entry.value === "number").toBeTruthy();
    }
  });

  it("list returns 200+ countries and 15+ indicators", async () => {
    const res = await request(app).get("/knowledge/indicators/list");
    expect(res.body.totalCountries > 200).toBeTruthy();
    expect(res.body.indicators.length >= 15).toBeTruthy();
    expect(res.body.indicators[0].key).toBeTruthy();
    expect(typeof res.body.indicators[0].coverage === "number").toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  NASA Exoplanets — /knowledge/exoplanets/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: NASA Exoplanets", () => {
  it("search returns planets with full schema", async () => {
    const res = await request(app).get("/knowledge/exoplanets/search?q=kepler&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    const p = res.body.planets[0];
    for (const key of [
      "name", "hostStar", "discoveryMethod", "discoveryYear",
      "orbitalPeriodDays", "radiusEarth", "massEarth",
    ]) {
      expect(key in p, `planet has ${key}`).toBeTruthy();
    }
  });

  it("rank by mass returns descending with value field", async () => {
    const res = await request(app).get("/knowledge/exoplanets/rank?field=pl_bmasse&limit=5&order=desc");
    expect(res.status).toBe(200);
    expect(res.body.field).toBe("pl_bmasse");
    for (let i = 1; i < res.body.planets.length; i++) {
      expect(res.body.planets[i - 1].value >= res.body.planets[i].value).toBeTruthy();
    }
  });

  it("rank returns error with availableFields for invalid field", async () => {
    const res = await request(app).get("/knowledge/exoplanets/rank?field=invalid_xyz");
    expect(res.status).toBe(200);
    expect(res.body.error.includes("Unknown field")).toBeTruthy();
    expect(res.body.availableFields[0].key).toBeTruthy();
  });

  it("stats returns 5000+ planets with Transit as top method", async () => {
    const res = await request(app).get("/knowledge/exoplanets/stats");
    expect(res.body.totalPlanets > 5000).toBeTruthy();
    expect(res.body.yearRange.first < 2000).toBeTruthy();
    expect(res.body.yearRange.latest > 2020).toBeTruthy();
    expect(res.body.discoveryMethods[0].method).toBe("Transit");
  });

  it("habitable returns candidates with criteria", async () => {
    const res = await request(app).get("/knowledge/exoplanets/habitable?limit=10");
    expect(res.status).toBe(200);
    expect(typeof res.body.criteria === "string").toBeTruthy();
    expect(Array.isArray(res.body.planets)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  FDA Drug NDC — /health/drugs/ndc/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: FDA Drug NDC", () => {
  it("search returns drugs with full schema", async () => {
    const res = await request(app).get("/health/drugs/ndc/search?q=ibuprofen&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    const d = res.body.drugs[0];
    for (const key of [
      "productNdc", "genericName", "brandName", "labelerName",
      "dosageForm", "route", "productType", "activeIngredients", "pharmClass",
    ]) {
      expect(key in d, `drug has ${key}`).toBeTruthy();
    }
  });

  it("dosage-forms returns 20k+ products sorted descending", async () => {
    const res = await request(app).get("/health/drugs/ndc/dosage-forms");
    expect(res.body.totalProducts > 20000).toBeTruthy();
    expect(res.body.dosageForms.length > 10).toBeTruthy();
    for (let i = 1; i < res.body.dosageForms.length; i++) {
      expect(res.body.dosageForms[i - 1].count >= res.body.dosageForms[i].count).toBeTruthy();
    }
  });

  it("ingredient search validates every result contains queried ingredient", async () => {
    const res = await request(app).get("/health/drugs/ndc/ingredient?q=acetaminophen&limit=5");
    for (const d of res.body.drugs) {
      expect((d.activeIngredients || "").toLowerCase().includes("acetaminophen")).toBeTruthy();
    }
  });

  it("pharm-class search validates every result contains queried class", async () => {
    const res = await request(app).get("/health/drugs/ndc/pharm-class?q=antibacterial&limit=5");
    expect(res.body.count > 0).toBeTruthy();
    for (const d of res.body.drugs) {
      expect((d.pharmClass || "").toLowerCase().includes("antibacterial")).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Airport Database — /utility/airports/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: Airport Database", () => {
  it("search returns airports with full schema", async () => {
    const res = await request(app).get("/utility/airports/search?q=vancouver&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    const ap = res.body.airports[0];
    for (const key of [
      "iataCode", "icaoCode", "name", "city", "countryCode",
      "continent", "latitude", "longitude", "type",
    ]) {
      expect(key in ap, `airport has ${key}`).toBeTruthy();
    }
    expect(res.body.airports.some((a) => a.iataCode === "YVR")).toBeTruthy();
  });

  it("code/YVR returns exact data with realistic coords", async () => {
    const res = await request(app).get("/utility/airports/code/YVR");
    expect(res.body.iataCode).toBe("YVR");
    expect(res.body.countryCode).toBe("CA");
    expect(res.body.latitude > 49 && res.body.latitude < 50).toBeTruthy();
    expect(res.body.longitude > -124 && res.body.longitude < -123).toBeTruthy();
    expect(res.body.type).toBe("large_airport");
  });

  it("country/CA returns only Canadian airports", async () => {
    const res = await request(app).get("/utility/airports/country/CA?limit=10");
    expect(res.body.countryCode).toBe("CA");
    for (const ap of res.body.airports) {
      expect(ap.countryCode).toBe("CA");
    }
  });

  it("nearest returns ascending distance with YVR closest to own coords", async () => {
    const res = await request(app).get("/utility/airports/nearest?lat=49.19&lng=-123.18&limit=3");
    expect(res.body.latitude).toBe(49.19);
    for (const ap of res.body.airports) {
      expect(typeof ap.distanceKm === "number").toBeTruthy();
    }
    for (let i = 1; i < res.body.airports.length; i++) {
      expect(res.body.airports[i - 1].distanceKm <= res.body.airports[i].distanceKm).toBeTruthy();
    }
    expect(res.body.airports[0].iataCode).toBe("YVR");
    expect(res.body.airports[0].distanceKm < 5).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Nutrition — /health/nutrition/* (structure only)
// ═══════════════════════════════════════════════════════════════════

describe("Static: Nutrition Database (structure)", () => {
  it("search returns foods with full nutrient schema", async () => {
    const res = await request(app).get("/health/nutrition/search?q=chicken&limit=3");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    const food = res.body.foods[0];
    expect(food.name).toBeTruthy();
    expect(food.source).toBeTruthy();
    const phg = food.perHundredGrams;
    expect(typeof phg.macros === "object").toBeTruthy();
    expect(typeof phg.minerals === "object").toBeTruthy();
    expect(typeof phg.vitamins === "object").toBeTruthy();
    for (const key of ["calories_kcal", "protein_g", "totalFat_g", "carbohydrate_g"]) {
      expect(key in phg.macros, `has macro: ${key}`).toBeTruthy();
    }
  });

  it("categories returns food taxonomy", async () => {
    const res = await request(app).get("/health/nutrition/categories");
    expect(res.status).toBe(200);
    expect(res.body.totalFoods > 0).toBeTruthy();
  });

  it("nutrient-types returns type categories", async () => {
    const res = await request(app).get("/health/nutrition/nutrient-types");
    expect(res.status).toBe(200);
    expect(res.body.types.length > 0).toBeTruthy();
  });
});
