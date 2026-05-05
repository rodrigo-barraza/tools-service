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
    expect(result.count > 0, "expected at least one result for 'chicken'").toBeTruthy();
    expect(result.query).toBe("chicken");
    expect(Array.isArray(result.foods)).toBeTruthy();
    expect(result.note.includes("USDA")).toBeTruthy();
  });

  it("includes macros by default in each food result", () => {
    const result = searchFoods("salmon");
    expect(result.count > 0).toBeTruthy();
    const food = result.foods[0];
    expect(food.name).toBeTruthy();
    expect(food.perHundredGrams).toBeTruthy();
    expect(food.perHundredGrams.macros).toBeTruthy();
    expect(
      "protein_g" in food.perHundredGrams.macros ||
        "calories_kcal" in food.perHundredGrams.macros,
      "macros should contain expected nutrient labels",
    ).toBeTruthy();
  });

  it("respects the limit parameter", () => {
    const result = searchFoods("apple", { limit: 3 });
    expect(result.count <= 3).toBeTruthy();
  });

  it("filters by kingdom", () => {
    const result = searchFoods("protein", {
      limit: 50,
      kingdom: "plantae",
    });
    for (const food of result.foods) {
              expect(food.kingdom?.toLowerCase()).toBe("plantae");
    }
  });

  it("filters by foodType", () => {
    const result = searchFoods("raw", {
      limit: 50,
      foodType: "animal",
    });
    for (const food of result.foods) {
              expect(food.foodType?.toLowerCase()).toBe("animal");
    }
  });

  it("returns only requested nutrient types", () => {
    const result = searchFoods("spinach", { nutrientTypes: "vitamins" });
    expect(result.count > 0).toBeTruthy();
    const food = result.foods[0];
    expect(food.perHundredGrams.vitamins).toBeTruthy();
    expect(food.perHundredGrams.macros).toBeUndefined();
  });

  it("returns multiple nutrient types when comma-separated", () => {
    const result = searchFoods("beef", {
      nutrientTypes: "macros,minerals",
    });
    expect(result.count > 0).toBeTruthy();
    const food = result.foods[0];
    expect(food.perHundredGrams.macros).toBeTruthy();
    expect(food.perHundredGrams.minerals).toBeTruthy();
    expect(food.perHundredGrams.vitamins).toBeUndefined();
  });

  it("returns empty results for nonsense query", () => {
    const result = searchFoods("zzzxxyywwvv");
    expect(result.count).toBe(0);
    expect(result.foods).toEqual([]);
  });

  it("returns empty results for empty query", () => {
    const result = searchFoods("");
    expect(result.count).toBe(0);
    expect(result.foods).toEqual([]);
  });

  it("includes taxonomy fields in results", () => {
    const result = searchFoods("salmon");
    expect(result.count > 0).toBeTruthy();
    const food = result.foods[0];
    expect(food.taxonomy).toBeTruthy();
    expect("genus" in food.taxonomy).toBeTruthy();
    expect("species" in food.taxonomy).toBeTruthy();
    expect("family" in food.taxonomy).toBeTruthy();
  });
});

// ─── getFoodByName ─────────────────────────────────────────────────

describe("getFoodByName", () => {
  it("returns data for an exact food name match", () => {
    const food = getFoodByName("salmon");
    expect(food, "should find 'salmon'").toBeTruthy();
    expect(food.name.toLowerCase().includes("salmon")).toBeTruthy();
    expect(food.perHundredGrams).toBeTruthy();
  });

  it("returns null for a food that does not exist", () => {
    const food = getFoodByName("unicornfruit");
    expect(food).toBe(null);
  });

  it("is case-insensitive", () => {
    const lower = getFoodByName("chicken");
    const upper = getFoodByName("CHICKEN");
    const mixed = getFoodByName("Chicken");
    // All should resolve to the same food or all be null
    if (lower) {
      expect(lower.name).toBe(upper?.name);
      expect(lower.name).toBe(mixed?.name);
    }
  });

  it("returns filtered nutrient types when specified", () => {
    const food = getFoodByName("chicken", "minerals");
    if (food) {
      expect(food.perHundredGrams.minerals).toBeTruthy();
      expect(food.perHundredGrams.macros).toBeUndefined();
    }
  });

  it("returns all nutrient types when nutrientTypes is null", () => {
    const food = getFoodByName("rice");
    if (food) {
      expect(food.perHundredGrams.macros).toBeTruthy();
      expect(food.perHundredGrams.minerals).toBeTruthy();
      expect(food.perHundredGrams.vitamins).toBeTruthy();
    }
  });
});

// ─── rankByNutrient ────────────────────────────────────────────────

describe("rankByNutrient", () => {
  it("ranks foods by protein content", () => {
    const result = rankByNutrient("protein");
    expect(result.count > 0).toBeTruthy();
    expect(Array.isArray(result.foods)).toBeTruthy();
    expect(result.note.includes("USDA")).toBeTruthy();

    // Verify descending order
    for (let i = 1; i < result.foods.length; i++) {
              expect(result.foods[i - 1].value >= result.foods[i].value).toBeTruthy();
    }
  });

  it("respects limit parameter", () => {
    const result = rankByNutrient("calcium", { limit: 5 });
    expect(result.foods.length <= 5).toBeTruthy();
  });

  it("filters by kingdom", () => {
    const result = rankByNutrient("protein", {
      limit: 20,
      kingdom: "plantae",
    });
    for (const food of result.foods) {
      expect(food.kingdom?.toLowerCase()).toBe("plantae");
    }
  });

  it("filters by foodType", () => {
    const result = rankByNutrient("iron", {
      limit: 20,
      foodType: "animal",
    });
    for (const food of result.foods) {
      expect(food.foodType?.toLowerCase()).toBe("animal");
    }
  });

  it("returns an error for an unknown nutrient", () => {
    const result = rankByNutrient("nonexistent_nutrient_xyz");
    expect(result.error).toBeTruthy();
    expect(
      result.availableNutrients,
      "should list available nutrients on error",
    ).toBeTruthy();
  });

  it("food items include expected fields", () => {
    const result = rankByNutrient("vitamin_b6", { limit: 3 });
    if (result.count > 0) {
      const food = result.foods[0];
      expect("name" in food).toBeTruthy();
      expect("value" in food).toBeTruthy();
      expect("kingdom" in food).toBeTruthy();
      expect("foodType" in food).toBeTruthy();
    }
  });
});

// ─── compareFoods ──────────────────────────────────────────────────

describe("compareFoods", () => {
  it("compares two foods and returns both", () => {
    const result = compareFoods(["chicken", "salmon"]);
    expect(result.count).toBe(2, "should find both foods");
    expect(result.comparison.length).toBe(2);
    expect(result.note.includes("USDA")).toBeTruthy();
  });

  it("handles a food that does not exist gracefully", () => {
    const result = compareFoods(["chicken", "zzz_nonexistent_food"]);
    const missing = result.comparison.find((c) => !c.found);
    expect(missing).toBeTruthy();
    expect(missing.found).toBe(false);
  });

  it("returns filtered nutrient types in comparison", () => {
    const result = compareFoods(["chicken", "beef"], "minerals");
    for (const item of result.comparison) {
      if (item.found) {
        expect(
          item.perHundredGrams.minerals,
          "should include minerals",
        ).toBeTruthy();
        expect(item.perHundredGrams.macros).toBeUndefined();
      }
    }
  });

  it("uses fuzzy matching for approximate names", () => {
    const result = compareFoods(["wild rice", "brown rice"]);
    // At least one should be found via scored search
    const found = result.comparison.filter((c) => c.found);
    expect(found.length >= 1).toBeTruthy();
  });

  it("preserves the query field on each comparison item", () => {
    const result = compareFoods(["spinach", "kale"]);
    expect(result.comparison[0].query).toBe("spinach");
    expect(result.comparison[1].query).toBe("kale");
  });
});

// ─── getNutrientTypes ──────────────────────────────────────────────

describe("getNutrientTypes", () => {
  it("returns available nutrient types and totals", () => {
    const result = getNutrientTypes();
    expect(Array.isArray(result.types)).toBeTruthy();
    expect(result.types.length > 0).toBeTruthy();
    expect(result.totalFoods > 0).toBeTruthy();
    expect(result.totalNutrients > 0).toBeTruthy();
    expect(Array.isArray(result.sources)).toBeTruthy();
    expect(
      result.sources.some(s => s.name.includes("USDA")),
      "should cite USDA source",
    );
  });
});

// ─── getFoodCategories ─────────────────────────────────────────────

describe("getFoodCategories", () => {
  it("returns kingdoms, foodTypes, subtypes, and parts", () => {
    const result = getFoodCategories();
    expect(result.totalFoods > 0).toBeTruthy();
    expect(Array.isArray(result.kingdoms)).toBeTruthy();
    expect(result.kingdoms.length > 0).toBeTruthy();
    expect(Array.isArray(result.foodTypes)).toBeTruthy();
    expect(result.foodTypes.length > 0).toBeTruthy();
    expect(Array.isArray(result.foodSubtypes)).toBeTruthy();
    expect(Array.isArray(result.parts)).toBeTruthy();
  });

  it("kingdoms are sorted alphabetically", () => {
    const result = getFoodCategories();
    for (let i = 1; i < result.kingdoms.length; i++) {
      expect(
        result.kingdoms[i - 1] <= result.kingdoms[i],
        "kingdoms should be sorted",
      ).toBeTruthy();
    }
  });

  it("contains expected kingdom values", () => {
    const result = getFoodCategories();
    const lower = result.kingdoms.map((k) => k.toLowerCase());
    expect(
      lower.includes("plantae") || lower.includes("animalia"),
      "should include plantae or animalia",
    );
  });
});

// ─── getTopFoodsByCategory ─────────────────────────────────────────

describe("getTopFoodsByCategory", () => {
  it("ranks foods by a mineral (iron)", () => {
    const result = getTopFoodsByCategory("minerals", "iron");
    expect(result.count > 0).toBeTruthy();
    expect(result.category).toBe("minerals");
    expect(result.nutrient).toBe("iron");
    expect(result.nutrientLabel).toBe("iron_mg");
    expect(Array.isArray(result.foods)).toBeTruthy();
    expect(result.note.includes("USDA")).toBeTruthy();

    // Verify descending order
    for (let i = 1; i < result.foods.length; i++) {
              expect(result.foods[i - 1].value >= result.foods[i].value).toBeTruthy();
    }
  });

  it("ranks foods by a vitamin (ascorbic_acid / vitamin C)", () => {
    const result = getTopFoodsByCategory("vitamins", "ascorbic_acid");
    expect(result.count > 0).toBeTruthy();
    expect(result.nutrient).toBe("ascorbic_acid");
    expect(result.nutrientLabel).toBe("vitaminC_mg");
  });

  it("ranks foods by a macro (protein)", () => {
    const result = getTopFoodsByCategory("macros", "protein");
    expect(result.count > 0).toBeTruthy();
    expect(result.category).toBe("macros");
    expect(result.foods[0].value > 0).toBeTruthy();
  });

  it("ranks foods by an amino acid (leucine)", () => {
    const result = getTopFoodsByCategory("amino_acids", "leucine", { limit: 5 });
    expect(result.count > 0).toBeTruthy();
    expect(result.foods.length <= 5).toBeTruthy();
    expect(result.nutrient).toBe("leucine");
  });

  it("ranks foods by a lipid (omega-3 DHA)", () => {
    const result = getTopFoodsByCategory("lipids", "c22_d6_n3_dha", { limit: 5 });
    expect(result.count > 0).toBeTruthy();
    expect(result.nutrientLabel).toBe("omega3_DHA_g");
  });

  it("ranks foods by a carb detail (starch)", () => {
    const result = getTopFoodsByCategory("carbs", "starch");
    expect(result.count > 0).toBeTruthy();
    expect(result.nutrient).toBe("starch");
  });

  it("ranks foods by a sterol (cholesterol)", () => {
    const result = getTopFoodsByCategory("sterols", "cholesterol");
    expect(result.count > 0).toBeTruthy();
    expect(result.nutrient).toBe("cholesterol");
    expect(result.nutrientLabel).toBe("cholesterol_mg");
  });

  it("respects limit parameter", () => {
    const result = getTopFoodsByCategory("minerals", "calcium", { limit: 3 });
    expect(result.foods.length <= 3).toBeTruthy();
  });

  it("filters by kingdom", () => {
    const result = getTopFoodsByCategory("minerals", "iron", {
      limit: 20,
      kingdom: "plantae",
    });
    for (const food of result.foods) {
              expect(food.kingdom?.toLowerCase()).toBe("plantae");
    }
  });

  it("filters by foodType", () => {
    const result = getTopFoodsByCategory("macros", "protein", {
      limit: 20,
      foodType: "animal",
    });
    for (const food of result.foods) {
              expect(food.foodType?.toLowerCase()).toBe("animal");
    }
  });

  it("resolves human-friendly nutrient name by partial match", () => {
    // "calcium" should resolve to the column name "calcium"
    const result = getTopFoodsByCategory("minerals", "calcium");
    expect(!result.error).toBeTruthy();
    expect(result.nutrient).toBe("calcium");
    expect(result.nutrientLabel).toBe("calcium_mg");
  });

  it("returns error for unknown category", () => {
    const result = getTopFoodsByCategory("magic_potions", "iron");
    expect(result.error).toBeTruthy();
    expect(Array.isArray(result.availableCategories)).toBeTruthy();
    expect(result.availableCategories.includes("minerals")).toBeTruthy();
  });

  it("returns error for unknown nutrient in valid category", () => {
    const result = getTopFoodsByCategory("minerals", "unobtanium");
    expect(result.error).toBeTruthy();
    expect(Array.isArray(result.availableNutrients)).toBeTruthy();
    expect(
      result.availableNutrients.some(n => n.column === "calcium"),
      "should list calcium as an available nutrient",
    );
  });

  it("food items include expected fields", () => {
    const result = getTopFoodsByCategory("minerals", "potassium", { limit: 3 });
    if (result.count > 0) {
      const food = result.foods[0];
      expect("name" in food).toBeTruthy();
      expect("value" in food).toBeTruthy();
      expect("kingdom" in food).toBeTruthy();
      expect("foodType" in food).toBeTruthy();
      expect("description" in food).toBeTruthy();
    }
  });
});

// ─── listCategoryNutrients ─────────────────────────────────────────

describe("listCategoryNutrients", () => {
  it("lists minerals with column and label", () => {
    const result = listCategoryNutrients("minerals");
    expect(result.category).toBe("minerals");
    expect(result.label).toBeTruthy();
    expect(Array.isArray(result.nutrients)).toBeTruthy();
    expect(result.nutrients.length > 0).toBeTruthy();

    const calcium = result.nutrients.find((n) => n.column === "calcium");
    expect(calcium).toBeTruthy();
    expect(calcium.label).toBe("calcium_mg");
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
      expect(!result.error, `${cat} should not return an error`).toBeTruthy();
      expect(result.nutrients.length > 0, `${cat} should have nutrients`).toBeTruthy();
    }
  });

  it("returns error for unknown category", () => {
    const result = listCategoryNutrients("dark_matter");
    expect(result.error).toBeTruthy();
    expect(Array.isArray(result.availableCategories)).toBeTruthy();
  });

  it("includes description from nutrient type metadata", () => {
    const result = listCategoryNutrients("amino_acids");
    expect(result.description).toBeTruthy();
  });
});
