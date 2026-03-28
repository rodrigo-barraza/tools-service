import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  searchFoods,
  getFoodByName,
  rankByNutrient,
  compareFoods,
  getNutrientTypes,
  getFoodCategories,
  getTopFoodsByCategory,
  listCategoryNutrients,
} from "../fetchers/health/NutritionFetcher.js";

// ─── searchFoods ───────────────────────────────────────────────────

describe("searchFoods", () => {
  it("returns results for a common food term", () => {
    const result = searchFoods("chicken");
    assert.ok(result.count > 0, "expected at least one result for 'chicken'");
    assert.equal(result.query, "chicken");
    assert.ok(Array.isArray(result.foods));
    assert.ok(result.note.includes("USDA"));
  });

  it("includes macros by default in each food result", () => {
    const result = searchFoods("salmon");
    assert.ok(result.count > 0);
    const food = result.foods[0];
    assert.ok(food.name, "food should have a name");
    assert.ok(food.perHundredGrams, "should have perHundredGrams");
    assert.ok(food.perHundredGrams.macros, "should include macros by default");
    assert.ok(
      "protein_g" in food.perHundredGrams.macros ||
        "calories_kcal" in food.perHundredGrams.macros,
      "macros should contain expected nutrient labels",
    );
  });

  it("respects the limit parameter", () => {
    const result = searchFoods("apple", { limit: 3 });
    assert.ok(result.count <= 3, "should not exceed the limit");
  });

  it("filters by kingdom", () => {
    const result = searchFoods("protein", {
      limit: 50,
      kingdom: "plantae",
    });
    for (const food of result.foods) {
      assert.equal(
        food.kingdom?.toLowerCase(),
        "plantae",
        `expected plantae kingdom, got ${food.kingdom}`,
      );
    }
  });

  it("filters by foodType", () => {
    const result = searchFoods("raw", {
      limit: 50,
      foodType: "animal",
    });
    for (const food of result.foods) {
      assert.equal(
        food.foodType?.toLowerCase(),
        "animal",
        `expected animal foodType, got ${food.foodType}`,
      );
    }
  });

  it("returns only requested nutrient types", () => {
    const result = searchFoods("spinach", { nutrientTypes: "vitamins" });
    assert.ok(result.count > 0);
    const food = result.foods[0];
    assert.ok(food.perHundredGrams.vitamins, "should include vitamins");
    assert.equal(
      food.perHundredGrams.macros,
      undefined,
      "should NOT include macros when specific types requested",
    );
  });

  it("returns multiple nutrient types when comma-separated", () => {
    const result = searchFoods("beef", {
      nutrientTypes: "macros,minerals",
    });
    assert.ok(result.count > 0);
    const food = result.foods[0];
    assert.ok(food.perHundredGrams.macros, "should include macros");
    assert.ok(food.perHundredGrams.minerals, "should include minerals");
    assert.equal(
      food.perHundredGrams.vitamins,
      undefined,
      "should NOT include vitamins",
    );
  });

  it("returns empty results for nonsense query", () => {
    const result = searchFoods("zzzxxyywwvv");
    assert.equal(result.count, 0);
    assert.deepEqual(result.foods, []);
  });

  it("returns empty results for empty query", () => {
    const result = searchFoods("");
    assert.equal(result.count, 0);
    assert.deepEqual(result.foods, []);
  });

  it("includes taxonomy fields in results", () => {
    const result = searchFoods("salmon");
    assert.ok(result.count > 0);
    const food = result.foods[0];
    assert.ok(food.taxonomy, "should have taxonomy object");
    assert.ok("genus" in food.taxonomy, "taxonomy should contain genus");
    assert.ok("species" in food.taxonomy, "taxonomy should contain species");
    assert.ok("family" in food.taxonomy, "taxonomy should contain family");
  });
});

// ─── getFoodByName ─────────────────────────────────────────────────

describe("getFoodByName", () => {
  it("returns data for an exact food name match", () => {
    const food = getFoodByName("salmon");
    assert.ok(food, "should find 'salmon'");
    assert.ok(food.name.toLowerCase().includes("salmon"));
    assert.ok(food.perHundredGrams);
  });

  it("returns null for a food that does not exist", () => {
    const food = getFoodByName("unicornfruit");
    assert.equal(food, null);
  });

  it("is case-insensitive", () => {
    const lower = getFoodByName("chicken");
    const upper = getFoodByName("CHICKEN");
    const mixed = getFoodByName("Chicken");
    // All should resolve to the same food or all be null
    if (lower) {
      assert.equal(lower.name, upper?.name);
      assert.equal(lower.name, mixed?.name);
    }
  });

  it("returns filtered nutrient types when specified", () => {
    const food = getFoodByName("chicken", "minerals");
    if (food) {
      assert.ok(food.perHundredGrams.minerals, "should include minerals");
      assert.equal(
        food.perHundredGrams.macros,
        undefined,
        "should NOT include macros",
      );
    }
  });

  it("returns all nutrient types when nutrientTypes is null", () => {
    const food = getFoodByName("rice");
    if (food) {
      assert.ok(food.perHundredGrams.macros, "should include macros");
      assert.ok(food.perHundredGrams.minerals, "should include minerals");
      assert.ok(food.perHundredGrams.vitamins, "should include vitamins");
    }
  });
});

// ─── rankByNutrient ────────────────────────────────────────────────

describe("rankByNutrient", () => {
  it("ranks foods by protein content", () => {
    const result = rankByNutrient("protein");
    assert.ok(result.count > 0);
    assert.ok(Array.isArray(result.foods));
    assert.ok(result.note.includes("USDA"));

    // Verify descending order
    for (let i = 1; i < result.foods.length; i++) {
      assert.ok(
        result.foods[i - 1].value >= result.foods[i].value,
        `should be sorted descending: ${result.foods[i - 1].value} >= ${result.foods[i].value}`,
      );
    }
  });

  it("respects limit parameter", () => {
    const result = rankByNutrient("calcium", { limit: 5 });
    assert.ok(result.foods.length <= 5);
  });

  it("filters by kingdom", () => {
    const result = rankByNutrient("protein", {
      limit: 20,
      kingdom: "plantae",
    });
    for (const food of result.foods) {
      assert.equal(food.kingdom?.toLowerCase(), "plantae");
    }
  });

  it("filters by foodType", () => {
    const result = rankByNutrient("iron", {
      limit: 20,
      foodType: "animal",
    });
    for (const food of result.foods) {
      assert.equal(food.foodType?.toLowerCase(), "animal");
    }
  });

  it("returns an error for an unknown nutrient", () => {
    const result = rankByNutrient("nonexistent_nutrient_xyz");
    assert.ok(result.error, "should return an error field");
    assert.ok(
      result.availableNutrients,
      "should list available nutrients on error",
    );
  });

  it("food items include expected fields", () => {
    const result = rankByNutrient("vitamin_b6", { limit: 3 });
    if (result.count > 0) {
      const food = result.foods[0];
      assert.ok("name" in food, "should have name");
      assert.ok("value" in food, "should have value");
      assert.ok("kingdom" in food, "should have kingdom");
      assert.ok("foodType" in food, "should have foodType");
    }
  });
});

// ─── compareFoods ──────────────────────────────────────────────────

describe("compareFoods", () => {
  it("compares two foods and returns both", () => {
    const result = compareFoods(["chicken", "salmon"]);
    assert.equal(result.count, 2, "should find both foods");
    assert.equal(result.comparison.length, 2);
    assert.ok(result.note.includes("USDA"));
  });

  it("handles a food that does not exist gracefully", () => {
    const result = compareFoods(["chicken", "zzz_nonexistent_food"]);
    const missing = result.comparison.find((c) => !c.found);
    assert.ok(missing, "should have a not-found entry");
    assert.equal(missing.found, false);
  });

  it("returns filtered nutrient types in comparison", () => {
    const result = compareFoods(["chicken", "beef"], "minerals");
    for (const item of result.comparison) {
      if (item.found) {
        assert.ok(
          item.perHundredGrams.minerals,
          "should include minerals",
        );
        assert.equal(
          item.perHundredGrams.macros,
          undefined,
          "should NOT include macros",
        );
      }
    }
  });

  it("uses fuzzy matching for approximate names", () => {
    const result = compareFoods(["wild rice", "brown rice"]);
    // At least one should be found via scored search
    const found = result.comparison.filter((c) => c.found);
    assert.ok(found.length >= 1, "should find at least one via fuzzy match");
  });

  it("preserves the query field on each comparison item", () => {
    const result = compareFoods(["spinach", "kale"]);
    assert.equal(result.comparison[0].query, "spinach");
    assert.equal(result.comparison[1].query, "kale");
  });
});

// ─── getNutrientTypes ──────────────────────────────────────────────

describe("getNutrientTypes", () => {
  it("returns available nutrient types and totals", () => {
    const result = getNutrientTypes();
    assert.ok(Array.isArray(result.types), "types should be an array");
    assert.ok(result.types.length > 0, "should have at least one type");
    assert.ok(result.totalFoods > 0, "should report total foods");
    assert.ok(result.totalNutrients > 0, "should report total nutrients");
    assert.ok(Array.isArray(result.sources), "should have sources array");
    assert.ok(
      result.sources.some((s) => s.name.includes("USDA")),
      "should cite USDA source",
    );
  });
});

// ─── getFoodCategories ─────────────────────────────────────────────

describe("getFoodCategories", () => {
  it("returns kingdoms, foodTypes, subtypes, and parts", () => {
    const result = getFoodCategories();
    assert.ok(result.totalFoods > 0);
    assert.ok(Array.isArray(result.kingdoms), "should have kingdoms array");
    assert.ok(result.kingdoms.length > 0, "should have at least one kingdom");
    assert.ok(Array.isArray(result.foodTypes), "should have foodTypes array");
    assert.ok(result.foodTypes.length > 0);
    assert.ok(Array.isArray(result.foodSubtypes));
    assert.ok(Array.isArray(result.parts));
  });

  it("kingdoms are sorted alphabetically", () => {
    const result = getFoodCategories();
    for (let i = 1; i < result.kingdoms.length; i++) {
      assert.ok(
        result.kingdoms[i - 1] <= result.kingdoms[i],
        "kingdoms should be sorted",
      );
    }
  });

  it("contains expected kingdom values", () => {
    const result = getFoodCategories();
    const lower = result.kingdoms.map((k) => k.toLowerCase());
    assert.ok(
      lower.includes("plantae") || lower.includes("animalia"),
      "should include plantae or animalia",
    );
  });
});

// ─── getTopFoodsByCategory ─────────────────────────────────────────

describe("getTopFoodsByCategory", () => {
  it("ranks foods by a mineral (iron)", () => {
    const result = getTopFoodsByCategory("minerals", "iron");
    assert.ok(result.count > 0);
    assert.equal(result.category, "minerals");
    assert.equal(result.nutrient, "iron");
    assert.equal(result.nutrientLabel, "iron_mg");
    assert.ok(Array.isArray(result.foods));
    assert.ok(result.note.includes("USDA"));

    // Verify descending order
    for (let i = 1; i < result.foods.length; i++) {
      assert.ok(
        result.foods[i - 1].value >= result.foods[i].value,
        `should be sorted descending: ${result.foods[i - 1].value} >= ${result.foods[i].value}`,
      );
    }
  });

  it("ranks foods by a vitamin (ascorbic_acid / vitamin C)", () => {
    const result = getTopFoodsByCategory("vitamins", "ascorbic_acid");
    assert.ok(result.count > 0);
    assert.equal(result.nutrient, "ascorbic_acid");
    assert.equal(result.nutrientLabel, "vitaminC_mg");
  });

  it("ranks foods by a macro (protein)", () => {
    const result = getTopFoodsByCategory("macros", "protein");
    assert.ok(result.count > 0);
    assert.equal(result.category, "macros");
    assert.ok(result.foods[0].value > 0);
  });

  it("ranks foods by an amino acid (leucine)", () => {
    const result = getTopFoodsByCategory("amino_acids", "leucine", { limit: 5 });
    assert.ok(result.count > 0);
    assert.ok(result.foods.length <= 5);
    assert.equal(result.nutrient, "leucine");
  });

  it("ranks foods by a lipid (omega-3 DHA)", () => {
    const result = getTopFoodsByCategory("lipids", "c22_d6_n3_dha", { limit: 5 });
    assert.ok(result.count > 0);
    assert.equal(result.nutrientLabel, "omega3_DHA_g");
  });

  it("ranks foods by a carb detail (starch)", () => {
    const result = getTopFoodsByCategory("carbs", "starch");
    assert.ok(result.count > 0);
    assert.equal(result.nutrient, "starch");
  });

  it("ranks foods by a sterol (cholesterol)", () => {
    const result = getTopFoodsByCategory("sterols", "cholesterol");
    assert.ok(result.count > 0);
    assert.equal(result.nutrient, "cholesterol");
    assert.equal(result.nutrientLabel, "cholesterol_mg");
  });

  it("respects limit parameter", () => {
    const result = getTopFoodsByCategory("minerals", "calcium", { limit: 3 });
    assert.ok(result.foods.length <= 3);
  });

  it("filters by kingdom", () => {
    const result = getTopFoodsByCategory("minerals", "iron", {
      limit: 20,
      kingdom: "plantae",
    });
    for (const food of result.foods) {
      assert.equal(
        food.kingdom?.toLowerCase(),
        "plantae",
        `expected plantae, got ${food.kingdom}`,
      );
    }
  });

  it("filters by foodType", () => {
    const result = getTopFoodsByCategory("macros", "protein", {
      limit: 20,
      foodType: "animal",
    });
    for (const food of result.foods) {
      assert.equal(
        food.foodType?.toLowerCase(),
        "animal",
        `expected animal, got ${food.foodType}`,
      );
    }
  });

  it("resolves human-friendly nutrient name by partial match", () => {
    // "calcium" should resolve to the column name "calcium"
    const result = getTopFoodsByCategory("minerals", "calcium");
    assert.ok(!result.error);
    assert.equal(result.nutrient, "calcium");
    assert.equal(result.nutrientLabel, "calcium_mg");
  });

  it("returns error for unknown category", () => {
    const result = getTopFoodsByCategory("magic_potions", "iron");
    assert.ok(result.error);
    assert.ok(Array.isArray(result.availableCategories));
    assert.ok(result.availableCategories.includes("minerals"));
  });

  it("returns error for unknown nutrient in valid category", () => {
    const result = getTopFoodsByCategory("minerals", "unobtanium");
    assert.ok(result.error);
    assert.ok(Array.isArray(result.availableNutrients));
    assert.ok(
      result.availableNutrients.some((n) => n.column === "calcium"),
      "should list calcium as an available nutrient",
    );
  });

  it("food items include expected fields", () => {
    const result = getTopFoodsByCategory("minerals", "potassium", { limit: 3 });
    if (result.count > 0) {
      const food = result.foods[0];
      assert.ok("name" in food, "should have name");
      assert.ok("value" in food, "should have value");
      assert.ok("kingdom" in food, "should have kingdom");
      assert.ok("foodType" in food, "should have foodType");
      assert.ok("description" in food, "should have description");
    }
  });
});

// ─── listCategoryNutrients ─────────────────────────────────────────

describe("listCategoryNutrients", () => {
  it("lists minerals with column and label", () => {
    const result = listCategoryNutrients("minerals");
    assert.equal(result.category, "minerals");
    assert.ok(result.label);
    assert.ok(Array.isArray(result.nutrients));
    assert.ok(result.nutrients.length > 0);

    const calcium = result.nutrients.find((n) => n.column === "calcium");
    assert.ok(calcium, "should have calcium");
    assert.equal(calcium.label, "calcium_mg");
  });

  it("lists all 7 categories without error", () => {
    const categories = [
      "macros",
      "minerals",
      "vitamins",
      "amino_acids",
      "lipids",
      "carbs",
      "sterols",
    ];
    for (const cat of categories) {
      const result = listCategoryNutrients(cat);
      assert.ok(!result.error, `${cat} should not return an error`);
      assert.ok(result.nutrients.length > 0, `${cat} should have nutrients`);
    }
  });

  it("returns error for unknown category", () => {
    const result = listCategoryNutrients("dark_matter");
    assert.ok(result.error);
    assert.ok(Array.isArray(result.availableCategories));
  });

  it("includes description from nutrient type metadata", () => {
    const result = listCategoryNutrients("amino_acids");
    assert.ok(result.description, "should have a description");
  });
});
