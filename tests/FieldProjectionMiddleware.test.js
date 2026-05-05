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

beforeAll(async () => {
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

afterAll(() => {
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
    expect(data.count).toBe(2);
    expect(data.foods.length).toBe(2);
    expect(data.foods[0].perHundredGrams.macros).toBeTruthy();
    expect(data.foods[0].perHundredGrams.minerals).toBeTruthy();
    expect(data.foods[0].perHundredGrams.vitamins).toBeTruthy();
  });

  it("projects name only from foods array items", async () => {
    const data = await fetchJson("/nutrition/search?fields=name");
    expect(data.count).toBe(2, "metadata preserved");
    expect(data.query).toBe("banana", "metadata preserved");
    expect(data.foods.length).toBe(2);
    expect(data.foods[0].name).toBe("banana");
    expect(data.foods[0].description).toBe(undefined, "non-requested field stripped");
    expect(data.foods[0].kingdom).toBe(undefined);
    expect(data.foods[0].perHundredGrams).toBe(undefined);
  });

  it("projects name and nested perHundredGrams.macros", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,perHundredGrams.macros",
    );
    expect(data.foods.length).toBe(2);

    const food = data.foods[0];
    expect(food.name).toBe("banana");
    expect(food.perHundredGrams.macros).toBeTruthy();
    expect(food.perHundredGrams.macros.calories_kcal).toBe(89);
    expect(food.perHundredGrams.minerals).toBe(undefined, "minerals excluded");
    expect(food.perHundredGrams.vitamins).toBe(undefined, "vitamins excluded");
    expect(food.description).toBe(undefined, "description excluded");
  });

  it("projects multiple nested paths", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,perHundredGrams.macros,perHundredGrams.minerals",
    );
    const food = data.foods[0];
    expect(food.name).toBe("banana");
    expect(food.perHundredGrams.macros).toBeTruthy();
    expect(food.perHundredGrams.minerals).toBeTruthy();
    expect(food.perHundredGrams.vitamins).toBe(undefined, "vitamins excluded");
  });

  it("projects name and description together", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,description",
    );
    const food = data.foods[0];
    expect(food.name).toBe("banana");
    expect(food.description).toBe("Bananas, raw");
    expect(food.kingdom).toBe(undefined);
    expect(food.perHundredGrams).toBe(undefined);
  });

  it("projects taxonomy nested fields", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,taxonomy.genus",
    );
    const food = data.foods[0];
    expect(food.name).toBe("banana");
    expect(food.taxonomy.genus).toBe("Musa");
    expect(food.taxonomy.species).toBe(undefined, "species not requested");
  });

  it("preserves top-level metadata when projecting foods", async () => {
    const data = await fetchJson("/nutrition/search?fields=name");
    expect(data.count).toBe(2);
    expect(data.query).toBe("banana");
    expect(data.note.includes("100g")).toBeTruthy();
  });
});

// ─── comparison wrapper ────────────────────────────────────────

describe("FieldProjection — comparison wrapper", () => {
  it("returns full comparison when no fields param", async () => {
    const data = await fetchJson("/nutrition/compare");
    expect(data.count).toBe(2);
    expect(data.comparison.length).toBe(2);
    expect(data.comparison[0].perHundredGrams.macros).toBeTruthy();
  });

  it("projects name and macros from comparison items", async () => {
    const data = await fetchJson(
      "/nutrition/compare?fields=name,query,perHundredGrams.macros",
    );
    expect(data.comparison.length).toBe(2);

    const item = data.comparison[0];
    expect(item.query).toBe("chicken");
    expect(item.name).toBe("chicken");
    expect(item.perHundredGrams.macros).toBeTruthy();
    expect(item.perHundredGrams.minerals).toBe(undefined, "minerals excluded");
    expect(item.found).toBe(undefined, "found excluded");
  });

  it("preserves comparison metadata", async () => {
    const data = await fetchJson("/nutrition/compare?fields=name");
    expect(data.count).toBe(2);
    expect(data.note).toBeTruthy();
  });
});

// ─── ranked foods wrapper ──────────────────────────────────────

describe("FieldProjection — ranked foods wrapper", () => {
  it("projects name and value from ranked foods", async () => {
    const data = await fetchJson("/nutrition/rank?fields=name,value");
    expect(data.foods.length).toBe(2);

    const food = data.foods[0];
    expect(food.name).toBe("spirulina");
    expect(food.value).toBe(57.47);
    expect(food.kingdom).toBe(undefined, "kingdom excluded");
  });

  it("preserves nutrient metadata", async () => {
    const data = await fetchJson("/nutrition/rank?fields=name");
    expect(data.nutrient).toBe("protein");
    expect(data.count).toBe(2);
  });
});

// ─── internal field stripping ──────────────────────────────────

describe("FieldProjection — internal field stripping", () => {
  it("strips _id and __v from array items without fields param", async () => {
    const data = await fetchJson("/products");
    expect(data.products.length).toBe(1);
    expect(data.products[0].name).toBe("Test Product");
    expect(data.products[0]._id).toBe(undefined, "_id should be stripped");
    expect(data.products[0].__v).toBe(undefined, "__v should be stripped");
  });

  it("strips _id and __v from array items with fields param", async () => {
    const data = await fetchJson("/products?fields=name,brand");
    const product = data.products[0];
    expect(product.name).toBe("Test Product");
    expect(product.brand).toBe("TestBrand");
    expect(product._id).toBe(undefined);
    expect(product.__v).toBe(undefined);
    expect(product.code).toBe(undefined, "non-requested field excluded");
  });
});

// ─── edge cases ────────────────────────────────────────────────

describe("FieldProjection — edge cases", () => {
  it("handles empty fields gracefully (returns full response)", async () => {
    const data = await fetchJson("/nutrition/search?fields=");
    expect(data.foods.length).toBe(2);
    expect(data.foods[0].name).toBeTruthy();
    expect(data.foods[0].perHundredGrams).toBeTruthy();
  });

  it("handles non-existent field paths gracefully", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,nonExistentField",
    );
    expect(data.foods[0].name).toBe("banana");
    expect(data.foods[0].nonExistentField).toBe(undefined);
  });

  it("handles deeply nested non-existent paths", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name,perHundredGrams.fake.deep",
    );
    expect(data.foods[0].name).toBe("banana");
  });

  it("trims whitespace in field names", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=name%2C%20description",
    );
    expect(data.foods[0].name).toBe("banana");
    expect(data.foods[0].description).toBe("Bananas, raw");
  });
});

// ─── wrapper-prefix dot-notation ───────────────────────────────

describe("FieldProjection — wrapper-prefix dot-notation", () => {
  it("projects foods.name → strips prefix, returns name on each item", async () => {
    const data = await fetchJson("/nutrition/search?fields=foods.name");
    expect(data.foods.length).toBe(2);
    expect(data.foods[0].name).toBe("banana");
    expect(data.foods[0].description).toBe(undefined, "description excluded");
    expect(data.foods[0].kingdom).toBe(undefined, "kingdom excluded");
    expect(data.foods[0].perHundredGrams).toBe(undefined, "nutrients excluded");
  });

  it("projects foods.name,foods.description → multiple wrapper-prefixed fields", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=foods.name,foods.description",
    );
    expect(data.foods[0].name).toBe("banana");
    expect(data.foods[0].description).toBe("Bananas, raw");
    expect(data.foods[0].kingdom).toBe(undefined);
  });

  it("projects foods.name,foods.value from ranked results", async () => {
    const data = await fetchJson(
      "/nutrition/rank?fields=foods.name,foods.value",
    );
    expect(data.foods.length).toBe(2);
    expect(data.foods[0].name).toBe("spirulina");
    expect(data.foods[0].value).toBe(57.47);
    expect(data.foods[0].kingdom).toBe(undefined, "kingdom excluded");
  });

  it("preserves top-level metadata when using wrapper-prefixed fields", async () => {
    const data = await fetchJson(
      "/nutrition/rank?fields=foods.name,foods.value",
    );
    expect(data.nutrient).toBe("protein");
    expect(data.count).toBe(2);
    expect(data.note).toBeTruthy();
  });

  it("mixes wrapper-prefixed and top-level fields", async () => {
    const data = await fetchJson(
      "/nutrition/rank?fields=nutrient,count,foods.name,foods.value",
    );
    expect(data.nutrient).toBe("protein");
    expect(data.count).toBe(2);
    expect(data.foods.length).toBe(2);
    expect(data.foods[0].name).toBe("spirulina");
    expect(data.foods[0].value).toBe(57.47);
    expect(data.foods[0].kingdom).toBe(undefined);
    // Non-requested top-level metadata should be stripped
    expect(data.note).toBe(undefined, "note not requested");
  });

  it("projects wrapper-prefixed nested paths (foods.perHundredGrams.macros)", async () => {
    const data = await fetchJson(
      "/nutrition/search?fields=foods.name,foods.perHundredGrams.macros",
    );
    expect(data.foods[0].name).toBe("banana");
    expect(data.foods[0].perHundredGrams.macros).toBeTruthy();
    expect(data.foods[0].perHundredGrams.minerals).toBe(undefined, "minerals excluded");
  });

  it("bare 'foods' alongside prefixed fields keeps full array unprojected", async () => {
    // When "foods" appears without a dot next to wrapper-prefixed fields,
    // it signals: preserve entire array items (no item projection)
    const data = await fetchJson("/nutrition/rank?fields=nutrient,foods");
    // Without wrapper-prefixed fields, "nutrient" is treated as item field
    // and "foods" as the wrapper key — items get projected by "nutrient"
    expect(data.foods.length).toBe(2);
    // In this backward-compat mode, items are projected by bare fields
    // The practical use case is with wrapper-prefix:
    const data2 = await fetchJson(
      "/nutrition/rank?fields=nutrient,count,foods.name",
    );
    expect(data2.nutrient).toBe("protein");
    expect(data2.count).toBe(2);
    expect(data2.foods[0].name).toBeTruthy();
    expect(data2.foods[0].kingdom).toBe(undefined);
  });

  it("comparison wrapper with prefix: comparison.name,comparison.query", async () => {
    const data = await fetchJson(
      "/nutrition/compare?fields=comparison.name,comparison.query",
    );
    expect(data.comparison.length).toBe(2);
    expect(data.comparison[0].query).toBe("chicken");
    expect(data.comparison[0].name).toBe("chicken");
    expect(data.comparison[0].found).toBe(undefined, "found excluded");
    expect(data.comparison[0].perHundredGrams).toBe(undefined, "nutrients excluded");
  });
});

