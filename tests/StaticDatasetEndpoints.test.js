import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Static In-Memory Dataset Endpoints ────
//
// These tests validate the response STRUCTURE of all endpoints
// backed by static CSV datasets loaded once at startup:
//   - Periodic Table (Elements)
//   - World Bank Indicators
//   - NASA Exoplanet Archive
//   - FDA Drug NDC Database
//   - Airport Codes (OurAirports)
//   - Nutrition (USDA / Health Canada)
//
// Each test asserts specific field names, types, and constraints
// to catch schema regressions.
// ──────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ═══════════════════════════════════════════════════════════════════
//  Periodic Table — /knowledge/elements/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: Periodic Table", () => {
  describe("GET /knowledge/elements/search?q=hydrogen", () => {
    it("returns elements with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/elements/search?q=hydrogen");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.query === "string", "echoes query");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.elements), "has elements array");
      assert.ok(data.count > 0, "found at least one element");

      const el = data.elements[0];
      // Validate element schema
      assert.ok(typeof el.atomicNumber === "number", "atomicNumber is number");
      assert.ok(typeof el.symbol === "string", "symbol is string");
      assert.ok(typeof el.name === "string", "name is string");
      assert.ok(typeof el.atomicMass === "number", "atomicMass is number");
      assert.ok(typeof el.category === "string", "category is string");
      assert.ok("groupNumber" in el, "has groupNumber");
      assert.ok(typeof el.period === "number", "period is number");
      assert.ok(typeof el.block === "string", "block is string");
      assert.ok(typeof el.electronConfiguration === "string", "has electronConfiguration");
      assert.ok("electronegativity" in el, "has electronegativity");
      assert.ok("density" in el, "has density");
      assert.ok("molarHeat" in el, "has molarHeat");
      assert.ok("electronAffinity" in el, "has electronAffinity");
      assert.ok("firstIonizationEnergy" in el, "has firstIonizationEnergy");
      assert.ok("phaseAtSTP" in el, "has phaseAtSTP");
      assert.ok("meltingPoint" in el, "has meltingPoint");
      assert.ok("boilingPoint" in el, "has boilingPoint");
      assert.ok("appearance" in el, "has appearance");
      assert.ok("discoveredBy" in el, "has discoveredBy");
      assert.ok("cpkHexColor" in el, "has cpkHexColor");
      assert.ok("summary" in el, "has summary");
    });

    it("returns hydrogen as the first result for exact search", async () => {
      const { data } = await fetchJson("/knowledge/elements/search?q=hydrogen");
      assert.equal(data.elements[0].name, "Hydrogen");
      assert.equal(data.elements[0].atomicNumber, 1);
      assert.equal(data.elements[0].symbol, "H");
    });
  });

  describe("GET /knowledge/elements/:symbol", () => {
    it("returns full element data for Fe (Iron)", async () => {
      const { status, data } = await fetchJson("/knowledge/elements/Fe");
      assert.equal(status, 200);
      assert.equal(data.symbol, "Fe");
      assert.equal(data.name, "Iron");
      assert.equal(data.atomicNumber, 26);
      assert.ok(data.atomicMass > 55 && data.atomicMass < 56, "Fe atomic mass ~55.845");
    });
  });

  describe("GET /knowledge/elements/rank", () => {
    it("returns ranked elements with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/elements/rank?property=atomic_mass&limit=5&order=desc");
      assert.equal(status, 200);
      assert.equal(data.property, "atomic_mass");
      assert.equal(data.propertyLabel, "Atomic Mass (u)");
      assert.equal(data.order, "desc");
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.elements), "has elements array");
      assert.ok(data.count <= 5, "respects limit");

      // Verify ranked items have expected fields
      const ranked = data.elements[0];
      assert.ok(typeof ranked.atomicNumber === "number", "has atomicNumber");
      assert.ok(typeof ranked.symbol === "string", "has symbol");
      assert.ok(typeof ranked.name === "string", "has name");
      assert.ok(typeof ranked.value === "number", "has value");
      assert.ok(typeof ranked.category === "string", "has category");

      // Verify descending order
      for (let i = 1; i < data.elements.length; i++) {
        assert.ok(data.elements[i - 1].value >= data.elements[i].value,
          "elements are in descending order by value");
      }
    });

    it("returns error with available properties for invalid property", async () => {
      const { status, data } = await fetchJson("/knowledge/elements/rank?property=invalid_xyz");
      assert.equal(status, 400);
      assert.ok(data.error.includes("Unknown property"), "has descriptive error");
      assert.ok(Array.isArray(data.availableProperties), "lists available properties");
      assert.ok(data.availableProperties.length > 0, "has at least one property");
      assert.ok(data.availableProperties[0].key, "each property has a key");
      assert.ok(data.availableProperties[0].label, "each property has a label");
    });
  });

  describe("GET /knowledge/elements/categories", () => {
    it("returns taxonomy filters with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/elements/categories");
      assert.equal(status, 200);
      assert.ok(typeof data.totalElements === "number", "has totalElements");
      assert.ok(data.totalElements >= 118, "has at least 118 elements");
      assert.ok(Array.isArray(data.categories), "has categories array");
      assert.ok(Array.isArray(data.blocks), "has blocks array");
      assert.ok(Array.isArray(data.phases), "has phases array");
      assert.ok(Array.isArray(data.rankableProperties), "has rankableProperties");

      // Verify known blocks exist
      assert.ok(data.blocks.includes("s"), "has s-block");
      assert.ok(data.blocks.includes("p"), "has p-block");
      assert.ok(data.blocks.includes("d"), "has d-block");
      assert.ok(data.blocks.includes("f"), "has f-block");

      // Verify rankableProperties shape
      const rp = data.rankableProperties[0];
      assert.ok(rp.key, "rankableProperty has key");
      assert.ok(rp.label, "rankableProperty has label");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  World Bank Indicators — /knowledge/indicators/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: World Bank Indicators", () => {
  describe("GET /knowledge/indicators/country/CAN", () => {
    it("returns Canada indicators with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/indicators/country/CAN");
      assert.equal(status, 200);
      assert.equal(data.countryCode, "CAN");
      assert.equal(data.countryName, "Canada");
      assert.ok("dataYear" in data, "has dataYear");
      assert.ok(typeof data.indicators === "object", "has indicators object");

      // Spot check key indicators exist
      const expectedIndicators = [
        "population", "gdp_usd", "gdp_per_capita_usd", "life_expectancy",
      ];
      for (const key of expectedIndicators) {
        assert.ok(data.indicators[key], `has indicator: ${key}`);
        assert.ok(data.indicators[key].label, `${key} has label`);
        assert.ok(typeof data.indicators[key].value === "number", `${key} has numeric value`);
        assert.ok(data.indicators[key].unit, `${key} has unit`);
      }

      // Sanity: Canada population should be 30-50M
      const pop = data.indicators.population.value;
      assert.ok(pop > 30_000_000 && pop < 50_000_000,
        `Canada population realistic (${pop})`);
    });
  });

  describe("GET /knowledge/indicators/rank", () => {
    it("ranks countries by population with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/indicators/rank?indicator=population&limit=5&order=desc");
      assert.equal(status, 200);
      assert.equal(data.indicator, "population");
      assert.ok(data.indicatorLabel, "has indicatorLabel");
      assert.ok(data.unit, "has unit");
      assert.equal(data.order, "desc");
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.countries), "has countries array");

      // Verify ranked item shape
      const top = data.countries[0];
      assert.ok(typeof top.countryCode === "string", "has countryCode");
      assert.ok(typeof top.countryName === "string", "has countryName");
      assert.ok(typeof top.value === "number", "has value");
      assert.ok("dataYear" in top, "has dataYear");

      // Sanity: the most populous country should have > 1B people
      assert.ok(top.value > 1_000_000_000, "top country has >1B population");

      // Verify descending order
      for (let i = 1; i < data.countries.length; i++) {
        assert.ok(data.countries[i - 1].value >= data.countries[i].value,
          "countries are in descending order");
      }
    });

    it("returns error with available indicators for invalid indicator", async () => {
      const { status, data } = await fetchJson("/knowledge/indicators/rank?indicator=invalid_xyz");
      assert.equal(status, 400);
      assert.ok(data.error.includes("Unknown indicator"), "has descriptive error");
      assert.ok(Array.isArray(data.availableIndicators), "lists available indicators");
      assert.ok(data.availableIndicators[0].key, "each indicator has a key");
      assert.ok(data.availableIndicators[0].label, "each indicator has a label");
      assert.ok(data.availableIndicators[0].unit, "each indicator has a unit");
    });
  });

  describe("GET /knowledge/indicators/compare", () => {
    it("compares USA and CAN with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/indicators/compare?countries=USA,CAN");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.equal(data.count, 2, "found both countries");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.comparison), "has comparison array");
      assert.equal(data.comparison.length, 2, "two comparison entries");

      // Each entry should have full country data
      for (const entry of data.comparison) {
        assert.equal(entry.found, true, "country was found");
        assert.ok(typeof entry.countryCode === "string", "has countryCode");
        assert.ok(typeof entry.countryName === "string", "has countryName");
        assert.ok(typeof entry.indicators === "object", "has indicators");
      }
    });

    it("compares with specific indicator filter", async () => {
      const { data } = await fetchJson("/knowledge/indicators/compare?countries=USA,CAN&indicator=gdp_per_capita_usd");
      assert.equal(data.count, 2);
      for (const entry of data.comparison) {
        assert.equal(entry.indicator, "gdp_per_capita_usd");
        assert.ok(entry.label, "has label");
        assert.ok(typeof entry.value === "number", "has value");
        assert.ok(entry.unit, "has unit");
      }
    });
  });

  describe("GET /knowledge/indicators/list", () => {
    it("returns indicator catalog with coverage stats", async () => {
      const { status, data } = await fetchJson("/knowledge/indicators/list");
      assert.equal(status, 200);
      assert.ok(typeof data.totalCountries === "number", "has totalCountries");
      assert.ok(data.totalCountries > 200, "has 200+ countries");
      assert.ok(Array.isArray(data.indicators), "has indicators array");
      assert.ok(data.indicators.length >= 15, "has 15+ indicators");

      const ind = data.indicators[0];
      assert.ok(typeof ind.key === "string", "indicator has key");
      assert.ok(typeof ind.label === "string", "indicator has label");
      assert.ok(typeof ind.unit === "string", "indicator has unit");
      assert.ok(typeof ind.coverage === "number", "indicator has coverage");
      assert.ok(typeof ind.coveragePct === "number", "indicator has coveragePct");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  NASA Exoplanet Archive — /knowledge/exoplanets/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: NASA Exoplanets", () => {
  describe("GET /knowledge/exoplanets/search?q=kepler", () => {
    it("returns exoplanets with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/exoplanets/search?q=kepler&limit=5");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.query === "string", "echoes query");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.planets), "has planets array");
      assert.ok(data.count > 0, "found results");

      // Validate planet schema
      const p = data.planets[0];
      assert.ok(typeof p.name === "string", "has name");
      assert.ok(typeof p.hostStar === "string", "has hostStar");
      assert.ok("discoveryMethod" in p, "has discoveryMethod");
      assert.ok("discoveryYear" in p, "has discoveryYear");
      assert.ok("discoveryFacility" in p, "has discoveryFacility");
      assert.ok("orbitalPeriodDays" in p, "has orbitalPeriodDays");
      assert.ok("radiusEarth" in p, "has radiusEarth");
      assert.ok("massEarth" in p, "has massEarth");
      assert.ok("semiMajorAxisAU" in p, "has semiMajorAxisAU");
      assert.ok("eccentricity" in p, "has eccentricity");
      assert.ok("equilibriumTempK" in p, "has equilibriumTempK");
      assert.ok("stellarMassSolar" in p, "has stellarMassSolar");
      assert.ok("stellarRadiusSolar" in p, "has stellarRadiusSolar");
      assert.ok("stellarTempK" in p, "has stellarTempK");
      assert.ok("distanceParsecs" in p, "has distanceParsecs");
    });
  });

  describe("GET /knowledge/exoplanets/rank", () => {
    it("ranks by planet mass with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/exoplanets/rank?field=pl_bmasse&limit=5&order=desc");
      assert.equal(status, 200);
      assert.equal(data.field, "pl_bmasse");
      assert.ok(data.label, "has label");
      assert.ok(data.unit, "has unit");
      assert.equal(data.order, "desc");
      assert.ok(Array.isArray(data.planets), "has planets array");

      const top = data.planets[0];
      assert.ok(typeof top.name === "string", "has name");
      assert.ok(typeof top.hostStar === "string", "has hostStar");
      assert.ok(typeof top.value === "number", "has value");
      assert.ok("discoveryYear" in top, "has discoveryYear");
      assert.ok("method" in top, "has method");

      // Verify descending order
      for (let i = 1; i < data.planets.length; i++) {
        assert.ok(data.planets[i - 1].value >= data.planets[i].value,
          "planets are in descending order by mass");
      }
    });

    it("returns error body with available fields for invalid field", async () => {
      const { status, data } = await fetchJson("/knowledge/exoplanets/rank?field=invalid_xyz");
      // The route returns 200 with error body (not 400) — matches fetcher design
      assert.equal(status, 200);
      assert.ok(data.error.includes("Unknown field"), "has descriptive error");
      assert.ok(Array.isArray(data.availableFields), "lists available fields");
      assert.ok(data.availableFields[0].key, "each field has key");
      assert.ok(data.availableFields[0].label, "each field has label");
      assert.ok(data.availableFields[0].unit !== undefined, "each field has unit");
    });
  });

  describe("GET /knowledge/exoplanets/stats", () => {
    it("returns discovery statistics with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/exoplanets/stats");
      assert.equal(status, 200);
      assert.ok(typeof data.totalPlanets === "number", "has totalPlanets");
      assert.ok(data.totalPlanets > 5000, "has 5000+ planets");
      assert.ok(typeof data.yearRange === "object", "has yearRange");
      assert.ok(typeof data.yearRange.first === "number", "has first year");
      assert.ok(typeof data.yearRange.latest === "number", "has latest year");
      assert.ok(data.yearRange.first < 2000, "first discovery pre-2000");
      assert.ok(data.yearRange.latest > 2020, "latest discovery post-2020");
      assert.ok(Array.isArray(data.discoveryMethods), "has discoveryMethods");
      assert.ok(Array.isArray(data.topFacilities), "has topFacilities");
      assert.ok(typeof data.note === "string", "has provenance note");

      // Verify discoveryMethods shape
      const dm = data.discoveryMethods[0];
      assert.ok(typeof dm.method === "string", "method has name");
      assert.ok(typeof dm.count === "number", "method has count");

      // Transit should be the most common
      assert.ok(dm.method === "Transit", "Transit is top method");

      // Verify topFacilities shape
      const tf = data.topFacilities[0];
      assert.ok(typeof tf.facility === "string", "facility has name");
      assert.ok(typeof tf.count === "number", "facility has count");
    });
  });

  describe("GET /knowledge/exoplanets/habitable", () => {
    it("returns habitable-zone candidates with correct structure", async () => {
      const { status, data } = await fetchJson("/knowledge/exoplanets/habitable?limit=10");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.criteria === "string", "has criteria");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.planets), "has planets array");

      if (data.count > 0) {
        // Each habitable candidate should have full planet schema
        const p = data.planets[0];
        assert.ok(typeof p.name === "string", "has name");
        assert.ok("radiusEarth" in p, "has radiusEarth");
        assert.ok("equilibriumTempK" in p, "has equilibriumTempK");
        assert.ok("semiMajorAxisAU" in p, "has semiMajorAxisAU");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  FDA Drug NDC Database — /health/drugs/ndc/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: FDA Drug NDC", () => {
  describe("GET /health/drugs/ndc/search?q=ibuprofen", () => {
    it("returns drugs with correct structure", async () => {
      const { status, data } = await fetchJson("/health/drugs/ndc/search?q=ibuprofen&limit=5");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.query === "string", "echoes query");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.drugs), "has drugs array");
      assert.ok(data.count > 0, "found results");

      // Validate drug schema
      const d = data.drugs[0];
      assert.ok("productNdc" in d, "has productNdc");
      assert.ok("genericName" in d, "has genericName");
      assert.ok("brandName" in d, "has brandName");
      assert.ok("labelerName" in d, "has labelerName");
      assert.ok("dosageForm" in d, "has dosageForm");
      assert.ok("route" in d, "has route");
      assert.ok("productType" in d, "has productType");
      assert.ok("marketingCategory" in d, "has marketingCategory");
      assert.ok("activeIngredients" in d, "has activeIngredients");
      assert.ok("pharmClass" in d, "has pharmClass");
    });

    it("contains ibuprofen in results", async () => {
      const { data } = await fetchJson("/health/drugs/ndc/search?q=ibuprofen&limit=5");
      const hasIbuprofen = data.drugs.some((d) => {
        const generic = (d.genericName || "").toLowerCase();
        const ingredients = (d.activeIngredients || "").toLowerCase();
        return generic.includes("ibuprofen") || ingredients.includes("ibuprofen");
      });
      assert.ok(hasIbuprofen, "results contain ibuprofen");
    });
  });

  describe("GET /health/drugs/ndc/dosage-forms", () => {
    it("returns dosage form taxonomy with correct structure", async () => {
      const { status, data } = await fetchJson("/health/drugs/ndc/dosage-forms");
      assert.equal(status, 200);
      assert.ok(typeof data.totalProducts === "number", "has totalProducts");
      assert.ok(data.totalProducts > 20000, "has 20k+ products");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.dosageForms), "has dosageForms array");
      assert.ok(data.dosageForms.length > 10, "has 10+ dosage forms");

      const df = data.dosageForms[0];
      assert.ok(typeof df.form === "string", "dosageForm has form");
      assert.ok(typeof df.count === "number", "dosageForm has count");

      // Verify sorted by count descending
      for (let i = 1; i < data.dosageForms.length; i++) {
        assert.ok(data.dosageForms[i - 1].count >= data.dosageForms[i].count,
          "dosage forms sorted descending by count");
      }
    });
  });

  describe("GET /health/drugs/ndc/ingredient?q=acetaminophen", () => {
    it("returns drugs by ingredient with correct structure", async () => {
      const { status, data } = await fetchJson("/health/drugs/ndc/ingredient?q=acetaminophen&limit=5");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.equal(data.ingredient, "acetaminophen", "echoes ingredient");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.drugs), "has drugs array");
      assert.ok(data.count > 0, "found results");

      // Every result should contain the queried ingredient
      for (const d of data.drugs) {
        const ingredients = (d.activeIngredients || "").toLowerCase();
        assert.ok(ingredients.includes("acetaminophen"),
          `result contains acetaminophen: ${d.genericName}`);
      }
    });
  });

  describe("GET /health/drugs/ndc/pharm-class?q=antibacterial", () => {
    it("returns drugs by pharmacological class", async () => {
      const { status, data } = await fetchJson("/health/drugs/ndc/pharm-class?q=antibacterial&limit=5");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.equal(data.pharmClass, "antibacterial", "echoes pharmClass");
      assert.ok(Array.isArray(data.drugs), "has drugs array");
      assert.ok(data.count > 0, "found results");

      // Every result should have the queried class
      for (const d of data.drugs) {
        const pc = (d.pharmClass || "").toLowerCase();
        assert.ok(pc.includes("antibacterial"),
          `result contains antibacterial class: ${d.genericName}`);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Airport Database — /utility/airports/*
// ═══════════════════════════════════════════════════════════════════

describe("Static: Airport Database", () => {
  describe("GET /utility/airports/search?q=vancouver", () => {
    it("returns airports with correct structure", async () => {
      const { status, data } = await fetchJson("/utility/airports/search?q=vancouver&limit=5");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.query === "string", "echoes query");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.airports), "has airports array");
      assert.ok(data.count > 0, "found results");

      // Validate airport schema
      const ap = data.airports[0];
      assert.ok("iataCode" in ap, "has iataCode");
      assert.ok("icaoCode" in ap, "has icaoCode");
      assert.ok(typeof ap.name === "string", "has name");
      assert.ok("city" in ap, "has city");
      assert.ok(typeof ap.countryCode === "string", "has countryCode");
      assert.ok(typeof ap.continent === "string", "has continent");
      assert.ok(typeof ap.latitude === "number", "latitude is number");
      assert.ok(typeof ap.longitude === "number", "longitude is number");
      assert.ok("elevationFt" in ap, "has elevationFt");
      assert.ok(typeof ap.type === "string", "has type");
      assert.ok("scheduledService" in ap, "has scheduledService");
    });

    it("returns YVR for Vancouver search", async () => {
      const { data } = await fetchJson("/utility/airports/search?q=vancouver&limit=5");
      const hasYvr = data.airports.some((a) => a.iataCode === "YVR");
      assert.ok(hasYvr, "YVR is in results");
    });
  });

  describe("GET /utility/airports/code/YVR", () => {
    it("returns exact airport data for YVR", async () => {
      const { status, data } = await fetchJson("/utility/airports/code/YVR");
      assert.equal(status, 200);
      assert.equal(data.iataCode, "YVR");
      assert.equal(data.countryCode, "CA");
      assert.ok(data.name.includes("Vancouver"), "name includes Vancouver");
      // YVR coordinates: ~49.19°N, ~-123.18°W
      assert.ok(data.latitude > 49 && data.latitude < 50, "latitude is near 49°N");
      assert.ok(data.longitude > -124 && data.longitude < -123, "longitude is near -123°W");
      assert.ok(data.type === "large_airport", "YVR is a large airport");
    });
  });

  describe("GET /utility/airports/country/CA", () => {
    it("returns Canadian airports with correct structure", async () => {
      const { status, data } = await fetchJson("/utility/airports/country/CA?limit=10");
      assert.equal(status, 200);
      assert.equal(data.countryCode, "CA");
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.airports), "has airports array");
      assert.ok(data.count > 0, "found Canadian airports");

      // All returned airports should be Canadian
      for (const ap of data.airports) {
        assert.equal(ap.countryCode, "CA", `${ap.iataCode} is Canadian`);
      }

      // Large airports should appear first (sorted)
      const types = data.airports.map((a) => a.type);
      const firstNonLargeIdx = types.findIndex((t) => t !== "large_airport");
      if (firstNonLargeIdx > 0) {
        // All items before should be large_airport
        for (let i = 0; i < firstNonLargeIdx; i++) {
          assert.equal(types[i], "large_airport", "large airports sorted first");
        }
      }
    });
  });

  describe("GET /utility/airports/nearest", () => {
    it("returns nearest airports to YVR with distances", async () => {
      const { status, data } = await fetchJson("/utility/airports/nearest?lat=49.19&lng=-123.18&limit=3");
      assert.equal(status, 200);
      assert.equal(data.latitude, 49.19);
      assert.equal(data.longitude, -123.18);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(typeof data.note === "string", "has provenance note");
      assert.ok(Array.isArray(data.airports), "has airports array");

      // Each airport should have distanceKm
      for (const ap of data.airports) {
        assert.ok(typeof ap.distanceKm === "number", "has distanceKm");
        assert.ok(ap.distanceKm >= 0, "distanceKm is non-negative");
        assert.ok(ap.iataCode, "has iataCode");
      }

      // Verify ascending distance order
      for (let i = 1; i < data.airports.length; i++) {
        assert.ok(data.airports[i - 1].distanceKm <= data.airports[i].distanceKm,
          "airports sorted by ascending distance");
      }

      // YVR should be the nearest airport to its own coordinates
      assert.equal(data.airports[0].iataCode, "YVR", "YVR is nearest to its own coords");
      assert.ok(data.airports[0].distanceKm < 5, "distance to YVR < 5km");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Nutrition Database — /health/nutrition/*
//  (Structural shape validation — deep tests in NutritionEndpoints)
// ═══════════════════════════════════════════════════════════════════

describe("Static: Nutrition Database (structure)", () => {
  describe("GET /health/nutrition/search?q=chicken", () => {
    it("returns foods with full nutrient schema", async () => {
      const { status, data } = await fetchJson("/health/nutrition/search?q=chicken&limit=3");
      assert.equal(status, 200);
      assert.ok(typeof data.count === "number", "has count");
      assert.ok(Array.isArray(data.foods), "has foods array");
      assert.ok(data.count > 0, "found results");

      const food = data.foods[0];
      assert.ok(typeof food.name === "string", "has name");
      assert.ok(typeof food.source === "string", "has source");
      assert.ok("description" in food, "has description");
      assert.ok("foodType" in food, "has foodType");
      assert.ok(typeof food.perHundredGrams === "object", "has perHundredGrams");

      // Nutrients are grouped into sub-objects
      const phg = food.perHundredGrams;
      assert.ok(typeof phg.macros === "object", "has macros category");
      assert.ok(typeof phg.minerals === "object", "has minerals category");
      assert.ok(typeof phg.vitamins === "object", "has vitamins category");

      // Should have macro fields under perHundredGrams.macros
      const macros = phg.macros;
      const expectedMacros = ["calories_kcal", "protein_g", "totalFat_g", "carbohydrate_g"];
      for (const key of expectedMacros) {
        assert.ok(key in macros, `has macro field: ${key}`);
      }
    });
  });

  describe("GET /health/nutrition/categories", () => {
    it("returns food category taxonomy", async () => {
      const { status, data } = await fetchJson("/health/nutrition/categories");
      assert.equal(status, 200);
      assert.ok(typeof data === "object", "returns data");
    });
  });

  describe("GET /health/nutrition/nutrient-types", () => {
    it("returns available nutrient type categories", async () => {
      const { status, data } = await fetchJson("/health/nutrition/nutrient-types");
      assert.equal(status, 200);
      assert.ok(typeof data === "object", "returns data");
    });
  });
});
