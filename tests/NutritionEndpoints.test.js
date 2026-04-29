import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Nutrition HTTP Endpoints ─────────────
//
// These tests hit the live tools-api server on localhost:5590.
// They validate response shapes, data integrity, field projection
// (including wrapper-prefix dot-notation that AI models use),
// and error handling for all /health/nutrition/* routes.
// ────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/health`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─── /nutrition/search ─────────────────────────────────────────

describe("GET /nutrition/search", () => {
  it("returns results for a common food", async () => {
    const { status, data } = await fetchJson("/nutrition/search?q=chicken");
    assert.equal(status, 200);
    assert.ok(data.count > 0, "should find results");
    assert.equal(data.query, "chicken");
    assert.ok(Array.isArray(data.foods));
    assert.ok(data.note.includes("USDA"));

    const food = data.foods[0];
    assert.ok(food.name, "should have name");
    assert.ok(food.perHundredGrams, "should have perHundredGrams");
    assert.ok(food.perHundredGrams.macros, "should include macros");
  });

  it("returns 400 when q is missing", async () => {
    const { status, data } = await fetchJson("/nutrition/search");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("respects limit parameter", async () => {
    const { data } = await fetchJson("/nutrition/search?q=rice&limit=3");
    assert.ok(data.count <= 3);
  });

  it("filters by kingdom", async () => {
    const { data } = await fetchJson(
      "/nutrition/search?q=protein&limit=20&kingdom=plantae",
    );
    for (const food of data.foods) {
      assert.equal(food.kingdom?.toLowerCase(), "plantae");
    }
  });

  it("filters by foodType", async () => {
    const { data } = await fetchJson(
      "/nutrition/search?q=raw&limit=20&foodType=animal",
    );
    for (const food of data.foods) {
      assert.equal(food.foodType?.toLowerCase(), "animal");
    }
  });

  it("returns only requested nutrientTypes", async () => {
    const { data } = await fetchJson(
      "/nutrition/search?q=spinach&nutrientTypes=vitamins",
    );
    assert.ok(data.count > 0);
    const food = data.foods[0];
    assert.ok(food.perHundredGrams.vitamins, "should include vitamins");
    assert.equal(food.perHundredGrams.macros, undefined, "macros excluded");
  });

  it("returns empty results for nonsense query", async () => {
    const { data } = await fetchJson("/nutrition/search?q=zzzxxyywwvv");
    assert.equal(data.count, 0);
    assert.deepEqual(data.foods, []);
  });

  it("includes taxonomy in results", async () => {
    const { data } = await fetchJson("/nutrition/search?q=salmon&limit=1");
    if (data.count > 0) {
      assert.ok(data.foods[0].taxonomy, "should have taxonomy");
      assert.ok("genus" in data.foods[0].taxonomy);
    }
  });

  // Field projection with wrapper-prefix
  it("field projection: foods.name,foods.description strips prefix correctly", async () => {
    const { data } = await fetchJson(
      "/nutrition/search?q=banana&limit=2&fields=foods.name,foods.description",
    );
    assert.ok(data.foods.length > 0);
    const food = data.foods[0];
    assert.ok(food.name, "name should be present");
    assert.ok(food.description, "description should be present");
    assert.equal(food.kingdom, undefined, "kingdom excluded");
    assert.equal(food.perHundredGrams, undefined, "nutrients excluded");
  });


  it("field projection: nested perHundredGrams.macros with prefix", async () => {
    const { data } = await fetchJson(
      "/nutrition/search?q=salmon&limit=1&fields=foods.name,foods.perHundredGrams.macros",
    );
    const food = data.foods[0];
    assert.ok(food.name);
    assert.ok(food.perHundredGrams?.macros, "macros present");
    assert.equal(food.perHundredGrams?.vitamins, undefined, "vitamins excluded");
  });
});

// ─── /nutrition/rank ───────────────────────────────────────────

describe("GET /nutrition/rank", () => {
  it("ranks foods by protein in descending order", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/rank?nutrient=protein&limit=10",
    );
    assert.equal(status, 200);
    assert.ok(data.count > 0);
    assert.ok(Array.isArray(data.foods));
    assert.ok(data.note);

    for (let i = 1; i < data.foods.length; i++) {
      assert.ok(
        data.foods[i - 1].value >= data.foods[i].value,
        `descending: ${data.foods[i - 1].value} >= ${data.foods[i].value}`,
      );
    }
  });

  it("returns 400 when nutrient is missing", async () => {
    const { status, data } = await fetchJson("/nutrition/rank");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns 400 for unknown nutrient", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/rank?nutrient=nonexistent_xyz",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.availableNutrients);
  });

  it("food items include name, value, kingdom, foodType", async () => {
    const { data } = await fetchJson(
      "/nutrition/rank?nutrient=calcium&limit=3",
    );
    if (data.count > 0) {
      const food = data.foods[0];
      assert.ok("name" in food);
      assert.ok("value" in food);
      assert.ok("kingdom" in food);
      assert.ok("foodType" in food);
    }
  });

  // Field projection with wrapper-prefix (the exact AI pattern)
  it("field projection: foods.name,foods.value strips prefix correctly", async () => {
    const { data } = await fetchJson(
      "/nutrition/rank?nutrient=protein&limit=5&fields=foods.name,foods.value",
    );
    assert.ok(data.foods.length > 0);
    const food = data.foods[0];
    assert.ok(food.name, "name present");
    assert.ok(typeof food.value === "number", "value present");
    assert.equal(food.kingdom, undefined, "kingdom excluded");
    assert.equal(food.description, undefined, "description excluded");
  });

  it("field projection: mixed top-level + wrapper-prefix", async () => {
    const { data } = await fetchJson(
      "/nutrition/rank?nutrient=protein&limit=3&fields=nutrientName,count,foods.name,foods.value",
    );
    assert.ok(data.nutrientName);
    assert.ok(typeof data.count === "number");
    assert.ok(data.foods[0].name);
    assert.ok(typeof data.foods[0].value === "number");
    assert.equal(data.note, undefined, "note not requested");
  });
});

// ─── /nutrition/top ────────────────────────────────────────────

describe("GET /nutrition/top", () => {
  it("ranks foods by category+nutrient (macros/protein)", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/top?category=macros&nutrient=protein&limit=5",
    );
    assert.equal(status, 200);
    assert.equal(data.category, "macros");
    assert.ok(data.nutrient);
    assert.ok(data.nutrientLabel);
    assert.ok(data.count > 0);

    for (let i = 1; i < data.foods.length; i++) {
      assert.ok(data.foods[i - 1].value >= data.foods[i].value);
    }
  });

  it("returns 400 when category/nutrient missing", async () => {
    const { status, data } = await fetchJson("/nutrition/top?category=macros");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns 400 for unknown category", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/top?category=magic&nutrient=iron",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.availableCategories);
  });

  it("returns 400 for unknown nutrient in valid category", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/top?category=minerals&nutrient=unobtanium",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.availableNutrients);
  });

  it("ranks minerals by iron", async () => {
    const { data } = await fetchJson(
      "/nutrition/top?category=minerals&nutrient=iron&limit=5",
    );
    assert.equal(data.category, "minerals");
    assert.ok(data.count > 0);
    assert.ok(data.foods[0].value > 0);
  });

  it("ranks vitamins by ascorbic_acid", async () => {
    const { data } = await fetchJson(
      "/nutrition/top?category=vitamins&nutrient=ascorbic_acid&limit=5",
    );
    assert.ok(data.count > 0);
    assert.equal(data.nutrientLabel, "vitaminC_mg");
  });

  it("ranks amino_acids by leucine", async () => {
    const { data } = await fetchJson(
      "/nutrition/top?category=amino_acids&nutrient=leucine&limit=5",
    );
    assert.ok(data.count > 0);
  });

  it("ranks lipids by omega-3 DHA", async () => {
    const { data } = await fetchJson(
      "/nutrition/top?category=lipids&nutrient=c22_d6_n3_dha&limit=5",
    );
    assert.ok(data.count > 0);
    assert.equal(data.nutrientLabel, "omega3_DHA_g");
  });

  it("filters by kingdom", async () => {
    const { data } = await fetchJson(
      "/nutrition/top?category=minerals&nutrient=iron&limit=20&kingdom=plantae",
    );
    for (const food of data.foods) {
      assert.equal(food.kingdom?.toLowerCase(), "plantae");
    }
  });

  // Field projection with wrapper-prefix (the exact AI function call pattern)
  it("field projection: foods.name,foods.value,nutrientName", async () => {
    const { data } = await fetchJson(
      "/nutrition/top?category=macros&nutrient=protein&limit=3&fields=foods.name,foods.value,nutrientName",
    );
    assert.ok(data.nutrientName, "nutrientName present");
    assert.ok(data.foods.length > 0);
    assert.ok(data.foods[0].name, "food name present");
    assert.ok(typeof data.foods[0].value === "number", "food value present");
    assert.equal(data.foods[0].kingdom, undefined, "kingdom excluded");
    assert.equal(data.foods[0].description, undefined, "description excluded");
  });
});

// ─── /nutrition/compare ────────────────────────────────────────

describe("GET /nutrition/compare", () => {
  it("compares two foods", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/compare?foods=chicken,salmon",
    );
    assert.equal(status, 200);
    assert.equal(data.count, 2);
    assert.equal(data.comparison.length, 2);
    assert.ok(data.note);
  });

  it("returns 400 when foods is missing", async () => {
    const { status, data } = await fetchJson("/nutrition/compare");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns 400 when only one food provided", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/compare?foods=chicken",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("handles non-existent food gracefully", async () => {
    const { data } = await fetchJson(
      "/nutrition/compare?foods=chicken,zzznonexistent",
    );
    const missing = data.comparison.find((c) => !c.found);
    assert.ok(missing, "should have not-found entry");
    assert.equal(missing.found, false);
  });

  it("filters by nutrientTypes", async () => {
    const { data } = await fetchJson(
      "/nutrition/compare?foods=chicken,beef&nutrientTypes=minerals",
    );
    for (const item of data.comparison) {
      if (item.found) {
        assert.ok(item.perHundredGrams.minerals);
        assert.equal(item.perHundredGrams.macros, undefined);
      }
    }
  });

  // Field projection with wrapper-prefix
  it("field projection: comparison.name,comparison.query", async () => {
    const { data } = await fetchJson(
      "/nutrition/compare?foods=chicken,salmon&fields=comparison.name,comparison.query",
    );
    assert.equal(data.comparison.length, 2);
    assert.ok(data.comparison[0].name);
    assert.ok(data.comparison[0].query);
    assert.equal(data.comparison[0].found, undefined, "found excluded");
    assert.equal(
      data.comparison[0].perHundredGrams,
      undefined,
      "nutrients excluded",
    );
  });
});

// ─── /nutrition/categories ─────────────────────────────────────

describe("GET /nutrition/categories", () => {
  it("returns kingdoms, foodTypes, subtypes, and parts", async () => {
    const { status, data } = await fetchJson("/nutrition/categories");
    assert.equal(status, 200);
    assert.ok(data.totalFoods > 0);
    assert.ok(Array.isArray(data.kingdoms));
    assert.ok(data.kingdoms.length > 0);
    assert.ok(Array.isArray(data.foodTypes));
    assert.ok(Array.isArray(data.foodSubtypes));
    assert.ok(Array.isArray(data.parts));
  });
});

// ─── /nutrition/nutrient-types ─────────────────────────────────

describe("GET /nutrition/nutrient-types", () => {
  it("returns types, totals, and sources", async () => {
    const { status, data } = await fetchJson("/nutrition/nutrient-types");
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.types));
    assert.ok(data.types.length > 0);
    assert.ok(data.totalFoods > 0);
    assert.ok(data.totalNutrients > 0);
    assert.ok(Array.isArray(data.sources));
  });
});

// ─── /nutrition/nutrients/:category ────────────────────────────

describe("GET /nutrition/nutrients/:category", () => {
  const VALID_CATEGORIES = [
    "macros",
    "minerals",
    "vitamins",
    "amino_acids",
    "lipids",
    "carbs",
    "sterols",
  ];

  for (const cat of VALID_CATEGORIES) {
    it(`lists nutrients for category: ${cat}`, async () => {
      const { status, data } = await fetchJson(
        `/nutrition/nutrients/${cat}`,
      );
      assert.equal(status, 200);
      assert.equal(data.category, cat);
      assert.ok(data.label);
      assert.ok(Array.isArray(data.nutrients));
      assert.ok(data.nutrients.length > 0);
      assert.ok(data.nutrients[0].column);
      assert.ok(data.nutrients[0].label);
    });
  }

  it("returns 400 for unknown category", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/nutrients/dark_matter",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.availableCategories);
  });
});

// ─── /nutrition/taxonomy/search ────────────────────────────────

describe("GET /nutrition/taxonomy/search", () => {
  it("finds foods by family", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/taxonomy/search?rank=family&value=Rosaceae&limit=5",
    );
    assert.equal(status, 200);
    assert.ok(data.rank === "family");
    assert.equal(data.value, "Rosaceae");
    assert.ok(Array.isArray(data.foods));
  });

  it("returns 400 when rank/value missing", async () => {
    const { status } = await fetchJson("/nutrition/taxonomy/search");
    assert.equal(status, 400);
  });

  it("returns error for invalid rank", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/taxonomy/search?rank=zz_invalid&value=test",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.availableRanks);
  });
});

// ─── /nutrition/taxonomy/tree ──────────────────────────────────

describe("GET /nutrition/taxonomy/tree", () => {
  it("returns full taxonomy tree when no rank specified", async () => {
    const { status, data } = await fetchJson("/nutrition/taxonomy/tree");
    assert.equal(status, 200);
    assert.ok(data.totalFoods > 0);
    assert.ok(Array.isArray(data.ranks));
  });

  it("returns values for a specific rank", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/taxonomy/tree?rank=kingdom",
    );
    assert.equal(status, 200);
    assert.equal(data.rank, "kingdom");
    assert.ok(Array.isArray(data.values));
    assert.ok(data.values.length > 0);
  });

  it("returns error for invalid rank", async () => {
    const { status, data } = await fetchJson(
      "/nutrition/taxonomy/tree?rank=zz_invalid",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});
