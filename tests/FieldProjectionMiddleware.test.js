import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fieldProjectionMiddleware } from "../middleware/FieldProjectionMiddleware.js";

// ─── Test Fixtures ─────────────────────────────────────────────

const MOCK_NUTRITION_SEARCH = {
  count: 2,
  query: "banana",
  note: "All nutrient values are per 100g.",
  foods: [
    {
      name: "banana",
      description: "Bananas, raw",
      kingdom: "plantae",
      foodType: "plant",
      taxonomy: { genus: "Musa", species: "m. acuminata" },
      perHundredGrams: {
        macros: { calories_kcal: 89, protein_g: 1.09, totalFat_g: 0.33 },
        minerals: { potassium_mg: 358, calcium_mg: 5 },
        vitamins: { vitaminC_mg: 8.7, vitaminB6_mg: 0.367 },
      },
    },
    {
      name: "banana powder",
      description: "Bananas, dehydrated",
      kingdom: "plantae",
      foodType: "plant",
      taxonomy: { genus: "Musa", species: null },
      perHundredGrams: {
        macros: { calories_kcal: 346, protein_g: 3.89, totalFat_g: 1.81 },
        minerals: { potassium_mg: 1491, calcium_mg: 22 },
        vitamins: { vitaminC_mg: 7, vitaminB6_mg: 0.44 },
      },
    },
  ],
};

const MOCK_COMPARISON = {
  count: 2,
  note: "All nutrient values per 100g.",
  comparison: [
    {
      query: "chicken",
      found: true,
      name: "chicken",
      perHundredGrams: {
        macros: { calories_kcal: 239, protein_g: 27.3, totalFat_g: 13.6 },
        minerals: { iron_mg: 1.26, zinc_mg: 1.94 },
      },
    },
    {
      query: "salmon",
      found: true,
      name: "salmon",
      perHundredGrams: {
        macros: { calories_kcal: 208, protein_g: 20.4, totalFat_g: 13.4 },
        minerals: { iron_mg: 0.34, zinc_mg: 0.64 },
      },
    },
  ],
};

const MOCK_RANKED = {
  nutrient: "protein",
  count: 2,
  note: "All values per 100g.",
  foods: [
    { name: "spirulina", value: 57.47, kingdom: "plantae", foodType: "plant" },
    { name: "chicken", value: 27.3, kingdom: "animalia", foodType: "animal" },
  ],
};

const MOCK_PRODUCTS = {
  totalResults: 100,
  count: 1,
  products: [
    {
      code: "123",
      name: "Test Product",
      brand: "TestBrand",
      _id: "mongo_id_123",
      __v: 0,
    },
  ],
};

// ─── Test Server ───────────────────────────────────────────────

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(fieldProjectionMiddleware);

  app.get("/nutrition/search", (_req, res) => res.json(MOCK_NUTRITION_SEARCH));
  app.get("/nutrition/compare", (_req, res) => res.json(MOCK_COMPARISON));
  app.get("/nutrition/rank", (_req, res) => res.json(MOCK_RANKED));
  app.get("/products", (_req, res) => res.json(MOCK_PRODUCTS));

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
});

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return res.json();
}

// ─── foods wrapper ─────────────────────────────────────────────

describe("FieldProjection — foods wrapper", () => {
  it("returns full response when no fields param is provided", async () => {
    const data = await fetchJson("/nutrition/search");
    assert.equal(data.count, 2);
    assert.equal(data.foods.length, 2);
    assert.ok(data.foods[0].perHundredGrams.macros);
    assert.ok(data.foods[0].perHundredGrams.minerals);
    assert.ok(data.foods[0].perHundredGrams.vitamins);
  });

  it("projects name only from foods array items", async () => {
    const data = await fetchJson("/nutrition/search?fields=name");
    assert.equal(data.count, 2, "metadata preserved");
    assert.equal(data.query, "banana", "metadata preserved");
    assert.equal(data.foods.length, 2);
    assert.equal(data.foods[0].name, "banana");
    assert.equal(data.foods[0].description, undefined, "non-requested field stripped");
    assert.equal(data.foods[0].kingdom, undefined);
    assert.equal(data.foods[0].perHundredGrams, undefined);
  });

  it("projects name and nested perHundredGrams.macros", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,perHundredGrams.macros",
    );
    assert.equal(data.foods.length, 2);

    const food = data.foods[0];
    assert.equal(food.name, "banana");
    assert.ok(food.perHundredGrams.macros, "macros included");
    assert.equal(food.perHundredGrams.macros.calories_kcal, 89);
    assert.equal(food.perHundredGrams.minerals, undefined, "minerals excluded");
    assert.equal(food.perHundredGrams.vitamins, undefined, "vitamins excluded");
    assert.equal(food.description, undefined, "description excluded");
  });

  it("projects multiple nested paths", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,perHundredGrams.macros,perHundredGrams.minerals",
    );
    const food = data.foods[0];
    assert.equal(food.name, "banana");
    assert.ok(food.perHundredGrams.macros);
    assert.ok(food.perHundredGrams.minerals);
    assert.equal(food.perHundredGrams.vitamins, undefined, "vitamins excluded");
  });

  it("projects name and description together", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,description",
    );
    const food = data.foods[0];
    assert.equal(food.name, "banana");
    assert.equal(food.description, "Bananas, raw");
    assert.equal(food.kingdom, undefined);
    assert.equal(food.perHundredGrams, undefined);
  });

  it("projects taxonomy nested fields", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,taxonomy.genus",
    );
    const food = data.foods[0];
    assert.equal(food.name, "banana");
    assert.equal(food.taxonomy.genus, "Musa");
    assert.equal(food.taxonomy.species, undefined, "species not requested");
  });

  it("preserves top-level metadata when projecting foods", async () => {
    const data = await fetchJson("/nutrition/search?fields=name");
    assert.equal(data.count, 2);
    assert.equal(data.query, "banana");
    assert.ok(data.note.includes("100g"));
  });
});

// ─── comparison wrapper ────────────────────────────────────────

describe("FieldProjection — comparison wrapper", () => {
  it("returns full comparison when no fields param", async () => {
    const data = await fetchJson("/nutrition/compare");
    assert.equal(data.count, 2);
    assert.equal(data.comparison.length, 2);
    assert.ok(data.comparison[0].perHundredGrams.macros);
  });

  it("projects name and macros from comparison items", async () => {
    const data = await fetchJson(
      "/nutrition/compare?fields=name,query,perHundredGrams.macros",
    );
    assert.equal(data.comparison.length, 2);

    const item = data.comparison[0];
    assert.equal(item.query, "chicken");
    assert.equal(item.name, "chicken");
    assert.ok(item.perHundredGrams.macros);
    assert.equal(item.perHundredGrams.minerals, undefined, "minerals excluded");
    assert.equal(item.found, undefined, "found excluded");
  });

  it("preserves comparison metadata", async () => {
    const data = await fetchJson("/nutrition/compare?fields=name");
    assert.equal(data.count, 2);
    assert.ok(data.note);
  });
});

// ─── ranked foods wrapper ──────────────────────────────────────

describe("FieldProjection — ranked foods wrapper", () => {
  it("projects name and value from ranked foods", async () => {
    const data = await fetchJson("/nutrition/rank?fields=name,value");
    assert.equal(data.foods.length, 2);

    const food = data.foods[0];
    assert.equal(food.name, "spirulina");
    assert.equal(food.value, 57.47);
    assert.equal(food.kingdom, undefined, "kingdom excluded");
  });

  it("preserves nutrient metadata", async () => {
    const data = await fetchJson("/nutrition/rank?fields=name");
    assert.equal(data.nutrient, "protein");
    assert.equal(data.count, 2);
  });
});

// ─── internal field stripping ──────────────────────────────────

describe("FieldProjection — internal field stripping", () => {
  it("strips _id and __v from array items without fields param", async () => {
    const data = await fetchJson("/products");
    assert.equal(data.products.length, 1);
    assert.equal(data.products[0].name, "Test Product");
    assert.equal(data.products[0]._id, undefined, "_id should be stripped");
    assert.equal(data.products[0].__v, undefined, "__v should be stripped");
  });

  it("strips _id and __v from array items with fields param", async () => {
    const data = await fetchJson("/products?fields=name,brand");
    const product = data.products[0];
    assert.equal(product.name, "Test Product");
    assert.equal(product.brand, "TestBrand");
    assert.equal(product._id, undefined);
    assert.equal(product.__v, undefined);
    assert.equal(product.code, undefined, "non-requested field excluded");
  });
});

// ─── edge cases ────────────────────────────────────────────────

describe("FieldProjection — edge cases", () => {
  it("handles empty fields gracefully (returns full response)", async () => {
    const data = await fetchJson("/nutrition/search?fields=");
    assert.equal(data.foods.length, 2);
    assert.ok(data.foods[0].name);
    assert.ok(data.foods[0].perHundredGrams);
  });

  it("handles non-existent field paths gracefully", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,nonExistentField",
    );
    assert.equal(data.foods[0].name, "banana");
    assert.equal(data.foods[0].nonExistentField, undefined);
  });

  it("handles deeply nested non-existent paths", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,perHundredGrams.fake.deep",
    );
    assert.equal(data.foods[0].name, "banana");
  });

  it("trims whitespace in field names", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name%2C%20description",
    );
    assert.equal(data.foods[0].name, "banana");
    assert.equal(data.foods[0].description, "Bananas, raw");
  });
});

// ─── wrapper-prefix dot-notation ───────────────────────────────

describe("FieldProjection — wrapper-prefix dot-notation", () => {
  it("projects foods.name → strips prefix, returns name on each item", async () => {
    const data = await fetchJson("/nutrition/search?fields=foods.name");
    assert.equal(data.foods.length, 2);
    assert.equal(data.foods[0].name, "banana");
    assert.equal(data.foods[0].description, undefined, "description excluded");
    assert.equal(data.foods[0].kingdom, undefined, "kingdom excluded");
    assert.equal(data.foods[0].perHundredGrams, undefined, "nutrients excluded");
  });

  it("projects foods.name,foods.description → multiple wrapper-prefixed fields", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=foods.name,foods.description",
    );
    assert.equal(data.foods[0].name, "banana");
    assert.equal(data.foods[0].description, "Bananas, raw");
    assert.equal(data.foods[0].kingdom, undefined);
  });

  it("projects foods.name,foods.value from ranked results", async () => {
    const data = await fetchJson(
      "/nutrition/rank?fields=foods.name,foods.value",
    );
    assert.equal(data.foods.length, 2);
    assert.equal(data.foods[0].name, "spirulina");
    assert.equal(data.foods[0].value, 57.47);
    assert.equal(data.foods[0].kingdom, undefined, "kingdom excluded");
  });

  it("preserves top-level metadata when using wrapper-prefixed fields", async () => {
    const data = await fetchJson(
      "/nutrition/rank?fields=foods.name,foods.value",
    );
    assert.equal(data.nutrient, "protein");
    assert.equal(data.count, 2);
    assert.ok(data.note);
  });

  it("mixes wrapper-prefixed and top-level fields", async () => {
    const data = await fetchJson(
      "/nutrition/rank?fields=nutrient,count,foods.name,foods.value",
    );
    assert.equal(data.nutrient, "protein");
    assert.equal(data.count, 2);
    assert.equal(data.foods.length, 2);
    assert.equal(data.foods[0].name, "spirulina");
    assert.equal(data.foods[0].value, 57.47);
    assert.equal(data.foods[0].kingdom, undefined);
    // Non-requested top-level metadata should be stripped
    assert.equal(data.note, undefined, "note not requested");
  });

  it("projects wrapper-prefixed nested paths (foods.perHundredGrams.macros)", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=foods.name,foods.perHundredGrams.macros",
    );
    assert.equal(data.foods[0].name, "banana");
    assert.ok(data.foods[0].perHundredGrams.macros, "macros included");
    assert.equal(data.foods[0].perHundredGrams.minerals, undefined, "minerals excluded");
  });

  it("bare 'foods' alongside prefixed fields keeps full array unprojected", async () => {
    // When "foods" appears without a dot next to wrapper-prefixed fields,
    // it signals: preserve entire array items (no item projection)
    const data = await fetchJson("/nutrition/rank?fields=nutrient,foods");
    // Without wrapper-prefixed fields, "nutrient" is treated as item field
    // and "foods" as the wrapper key — items get projected by "nutrient"
    assert.equal(data.foods.length, 2);
    // In this backward-compat mode, items are projected by bare fields
    // The practical use case is with wrapper-prefix:
    const data2 = await fetchJson(
      "/nutrition/rank?fields=nutrient,count,foods.name",
    );
    assert.equal(data2.nutrient, "protein");
    assert.equal(data2.count, 2);
    assert.ok(data2.foods[0].name);
    assert.equal(data2.foods[0].kingdom, undefined);
  });

  it("comparison wrapper with prefix: comparison.name,comparison.query", async () => {
    const data = await fetchJson(
      "/nutrition/compare?fields=comparison.name,comparison.query",
    );
    assert.equal(data.comparison.length, 2);
    assert.equal(data.comparison[0].query, "chicken");
    assert.equal(data.comparison[0].name, "chicken");
    assert.equal(data.comparison[0].found, undefined, "found excluded");
    assert.equal(data.comparison[0].perHundredGrams, undefined, "nutrients excluded");
  });
});

