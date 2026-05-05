import request from "supertest";
import { createTestApp } from "./testApp.js";
import healthRoutes from "../routes/HealthRoutes.js";

// ─── Unit Tests for Nutrition HTTP Endpoints ────────────────────
//
// Uses supertest to mount HealthRoutes in-process.
// All nutrition endpoints are backed by in-memory USDA/Health
// Canada CSV data — no network calls or MongoDB required.
// Tests validate response shapes, data integrity, field projection,
// and error handling for all /health/nutrition/* routes.
// ────────────────────────────────────────────────────────────────

const app = createTestApp("/health", healthRoutes);

// ─── /nutrition/search ─────────────────────────────────────────

describe("GET /nutrition/search", () => {
  it("returns results for a common food", async () => {
    const res = await request(app).get("/health/nutrition/search?q=chicken");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    expect(res.body.query).toBe("chicken");
    expect(Array.isArray(res.body.foods)).toBeTruthy();
    expect(res.body.note.includes("USDA")).toBeTruthy();

    const food = res.body.foods[0];
    expect(food.name).toBeTruthy();
    expect(food.perHundredGrams).toBeTruthy();
    expect(food.perHundredGrams.macros).toBeTruthy();
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/health/nutrition/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("respects limit parameter", async () => {
    const res = await request(app).get("/health/nutrition/search?q=rice&limit=3");
    expect(res.body.count <= 3).toBeTruthy();
  });

  it("filters by kingdom", async () => {
    const res = await request(app).get("/health/nutrition/search?q=protein&limit=20&kingdom=plantae");
    for (const food of res.body.foods) {
      expect(food.kingdom?.toLowerCase()).toBe("plantae");
    }
  });

  it("filters by foodType", async () => {
    const res = await request(app).get("/health/nutrition/search?q=raw&limit=20&foodType=animal");
    for (const food of res.body.foods) {
      expect(food.foodType?.toLowerCase()).toBe("animal");
    }
  });

  it("returns only requested nutrientTypes", async () => {
    const res = await request(app).get("/health/nutrition/search?q=spinach&nutrientTypes=vitamins");
    expect(res.body.count > 0).toBeTruthy();
    const food = res.body.foods[0];
    expect(food.perHundredGrams.vitamins).toBeTruthy();
    expect(food.perHundredGrams.macros).toBe(undefined, "macros excluded");
  });

  it("returns empty results for nonsense query", async () => {
    const res = await request(app).get("/health/nutrition/search?q=zzzxxyywwvv");
    expect(res.body.count).toBe(0);
    expect(res.body.foods).toEqual([]);
  });

  it("includes taxonomy in results", async () => {
    const res = await request(app).get("/health/nutrition/search?q=salmon&limit=1");
    if (res.body.count > 0) {
      expect(res.body.foods[0].taxonomy).toBeTruthy();
      expect("genus" in res.body.foods[0].taxonomy).toBeTruthy();
    }
  });

  it("field projection: foods.name,foods.description strips prefix", async () => {
    const res = await request(app).get("/health/nutrition/search?q=banana&limit=2&fields=foods.name,foods.description");
    expect(res.body.foods.length > 0).toBeTruthy();
    const food = res.body.foods[0];
    expect(food.name).toBeTruthy();
    expect(food.description).toBeTruthy();
    expect(food.kingdom).toBe(undefined, "kingdom excluded");
    expect(food.perHundredGrams).toBe(undefined, "nutrients excluded");
  });

  it("field projection: nested perHundredGrams.macros with prefix", async () => {
    const res = await request(app).get("/health/nutrition/search?q=salmon&limit=1&fields=foods.name,foods.perHundredGrams.macros");
    const food = res.body.foods[0];
    expect(food.name).toBeTruthy();
    expect(food.perHundredGrams?.macros).toBeTruthy();
    expect(food.perHundredGrams?.vitamins).toBe(undefined, "vitamins excluded");
  });
});

// ─── /nutrition/rank ───────────────────────────────────────────

describe("GET /nutrition/rank", () => {
  it("ranks foods by protein in descending order", async () => {
    const res = await request(app).get("/health/nutrition/rank?nutrient=protein&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.foods)).toBeTruthy();
    for (let i = 1; i < res.body.foods.length; i++) {
      expect(res.body.foods[i - 1].value >= res.body.foods[i].value).toBeTruthy();
    }
  });

  it("returns 400 when nutrient is missing", async () => {
    const res = await request(app).get("/health/nutrition/rank");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for unknown nutrient", async () => {
    const res = await request(app).get("/health/nutrition/rank?nutrient=nonexistent_xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.availableNutrients).toBeTruthy();
  });

  it("food items include name, value, kingdom, foodType", async () => {
    const res = await request(app).get("/health/nutrition/rank?nutrient=calcium&limit=3");
    if (res.body.count > 0) {
      const food = res.body.foods[0];
      expect("name" in food).toBeTruthy();
      expect("value" in food).toBeTruthy();
      expect("kingdom" in food).toBeTruthy();
      expect("foodType" in food).toBeTruthy();
    }
  });

  it("field projection: foods.name,foods.value strips prefix", async () => {
    const res = await request(app).get("/health/nutrition/rank?nutrient=protein&limit=5&fields=foods.name,foods.value");
    expect(res.body.foods.length > 0).toBeTruthy();
    const food = res.body.foods[0];
    expect(food.name).toBeTruthy();
    expect(typeof food.value === "number").toBeTruthy();
    expect(food.kingdom).toBe(undefined, "kingdom excluded");
  });
});

// ─── /nutrition/top ────────────────────────────────────────────

describe("GET /nutrition/top", () => {
  it("ranks foods by category+nutrient", async () => {
    const res = await request(app).get("/health/nutrition/top?category=macros&nutrient=protein&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.category).toBe("macros");
    expect(res.body.nutrient).toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    for (let i = 1; i < res.body.foods.length; i++) {
      expect(res.body.foods[i - 1].value >= res.body.foods[i].value).toBeTruthy();
    }
  });

  it("returns 400 when category/nutrient missing", async () => {
    const res = await request(app).get("/health/nutrition/top?category=macros");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for unknown category", async () => {
    const res = await request(app).get("/health/nutrition/top?category=magic&nutrient=iron");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.availableCategories).toBeTruthy();
  });

  it("returns 400 for unknown nutrient", async () => {
    const res = await request(app).get("/health/nutrition/top?category=minerals&nutrient=unobtanium");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.availableNutrients).toBeTruthy();
  });

  it("ranks vitamins by ascorbic_acid", async () => {
    const res = await request(app).get("/health/nutrition/top?category=vitamins&nutrient=ascorbic_acid&limit=5");
    expect(res.body.count > 0).toBeTruthy();
    expect(res.body.nutrientLabel).toBe("vitaminC_mg");
  });

  it("ranks lipids by omega-3 DHA", async () => {
    const res = await request(app).get("/health/nutrition/top?category=lipids&nutrient=c22_d6_n3_dha&limit=5");
    expect(res.body.count > 0).toBeTruthy();
    expect(res.body.nutrientLabel).toBe("omega3_DHA_g");
  });

  it("filters by kingdom", async () => {
    const res = await request(app).get("/health/nutrition/top?category=minerals&nutrient=iron&limit=20&kingdom=plantae");
    for (const food of res.body.foods) {
      expect(food.kingdom?.toLowerCase()).toBe("plantae");
    }
  });
});

// ─── /nutrition/compare ────────────────────────────────────────

describe("GET /nutrition/compare", () => {
  it("compares two foods", async () => {
    const res = await request(app).get("/health/nutrition/compare?foods=chicken,salmon");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.comparison.length).toBe(2);
    expect(res.body.note).toBeTruthy();
  });

  it("returns 400 when foods is missing", async () => {
    const res = await request(app).get("/health/nutrition/compare");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when only one food provided", async () => {
    const res = await request(app).get("/health/nutrition/compare?foods=chicken");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("handles non-existent food gracefully", async () => {
    const res = await request(app).get("/health/nutrition/compare?foods=chicken,zzznonexistent");
    const missing = res.body.comparison.find((c) => !c.found);
    expect(missing).toBeTruthy();
    expect(missing.found).toBe(false);
  });

  it("filters by nutrientTypes", async () => {
    const res = await request(app).get("/health/nutrition/compare?foods=chicken,beef&nutrientTypes=minerals");
    for (const item of res.body.comparison) {
      if (item.found) {
        expect(item.perHundredGrams.minerals).toBeTruthy();
        expect(item.perHundredGrams.macros).toBe(undefined);
      }
    }
  });
});

// ─── /nutrition/categories ─────────────────────────────────────

describe("GET /nutrition/categories", () => {
  it("returns kingdoms, foodTypes, subtypes, and parts", async () => {
    const res = await request(app).get("/health/nutrition/categories");
    expect(res.status).toBe(200);
    expect(res.body.totalFoods > 0).toBeTruthy();
    expect(Array.isArray(res.body.kingdoms)).toBeTruthy();
    expect(res.body.kingdoms.length > 0).toBeTruthy();
    expect(Array.isArray(res.body.foodTypes)).toBeTruthy();
    expect(Array.isArray(res.body.foodSubtypes)).toBeTruthy();
    expect(Array.isArray(res.body.parts)).toBeTruthy();
  });
});

// ─── /nutrition/nutrient-types ─────────────────────────────────

describe("GET /nutrition/nutrient-types", () => {
  it("returns types, totals, and sources", async () => {
    const res = await request(app).get("/health/nutrition/nutrient-types");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.types)).toBeTruthy();
    expect(res.body.types.length > 0).toBeTruthy();
    expect(res.body.totalFoods > 0).toBeTruthy();
    expect(res.body.totalNutrients > 0).toBeTruthy();
    expect(Array.isArray(res.body.sources)).toBeTruthy();
  });
});

// ─── /nutrition/nutrients/:category ────────────────────────────

describe("GET /nutrition/nutrients/:category", () => {
  const VALID_CATEGORIES = ["macros", "minerals", "vitamins", "amino_acids", "lipids", "carbs", "sterols"];

  for (const cat of VALID_CATEGORIES) {
    it(`lists nutrients for category: ${cat}`, async () => {
      const res = await request(app).get(`/health/nutrition/nutrients/${cat}`);
      expect(res.status).toBe(200);
      expect(res.body.category).toBe(cat);
      expect(res.body.label).toBeTruthy();
      expect(Array.isArray(res.body.nutrients)).toBeTruthy();
      expect(res.body.nutrients.length > 0).toBeTruthy();
      expect(res.body.nutrients[0].column).toBeTruthy();
      expect(res.body.nutrients[0].label).toBeTruthy();
    });
  }

  it("returns 400 for unknown category", async () => {
    const res = await request(app).get("/health/nutrition/nutrients/dark_matter");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.availableCategories).toBeTruthy();
  });
});

// ─── /nutrition/taxonomy/search ────────────────────────────────

describe("GET /nutrition/taxonomy/search", () => {
  it("finds foods by family", async () => {
    const res = await request(app).get("/health/nutrition/taxonomy/search?rank=family&value=Rosaceae&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.rank === "family").toBeTruthy();
    expect(res.body.value).toBe("Rosaceae");
    expect(Array.isArray(res.body.foods)).toBeTruthy();
  });

  it("returns 400 when rank/value missing", async () => {
    const res = await request(app).get("/health/nutrition/taxonomy/search");
    expect(res.status).toBe(400);
  });

  it("returns error for invalid rank", async () => {
    const res = await request(app).get("/health/nutrition/taxonomy/search?rank=zz_invalid&value=test");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.availableRanks).toBeTruthy();
  });
});

// ─── /nutrition/taxonomy/tree ──────────────────────────────────

describe("GET /nutrition/taxonomy/tree", () => {
  it("returns full taxonomy tree when no rank specified", async () => {
    const res = await request(app).get("/health/nutrition/taxonomy/tree");
    expect(res.status).toBe(200);
    expect(res.body.totalFoods > 0).toBeTruthy();
    expect(Array.isArray(res.body.ranks)).toBeTruthy();
  });

  it("returns values for a specific rank", async () => {
    const res = await request(app).get("/health/nutrition/taxonomy/tree?rank=kingdom");
    expect(res.status).toBe(200);
    expect(res.body.rank).toBe("kingdom");
    expect(Array.isArray(res.body.values)).toBeTruthy();
    expect(res.body.values.length > 0).toBeTruthy();
  });

  it("returns error for invalid rank", async () => {
    const res = await request(app).get("/health/nutrition/taxonomy/tree?rank=zz_invalid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
