import { OPEN_FOOD_FACTS_BASE_URL } from "../../constants.js";

/**
 * Open Food Facts API fetcher.
 * https://world.openfoodfacts.org/data — no auth, fully open.
 * Returns nutritional info for 3M+ products: calories, macros, Nutri-Score, allergens.
 */

// ─── Helpers ───────────────────────────────────────────────────────

function normalizeProduct(p) {
  const nutriments = p.nutriments || {};

  return {
    code: p.code || p._id || null,
    name: p.product_name || p.product_name_en || null,
    brand: p.brands || null,
    categories: p.categories || null,
    imageUrl: p.image_front_url || p.image_url || null,
    quantity: p.quantity || null,

    // Nutri-Score & Nova
    nutriScore: p.nutriscore_grade?.toUpperCase() || null,
    nutriScoreValue: p.nutriscore_score ?? null,
    novaGroup: p.nova_group || null,
    ecoScore: p.ecoscore_grade?.toUpperCase() || null,

    // Nutrition per 100g
    nutrition: {
      calories:
        nutriments["energy-kcal_100g"] ?? nutriments.energy_100g ?? null,
      caloriesUnit: nutriments["energy-kcal_100g"] != null ? "kcal" : "kJ",
      fat: nutriments.fat_100g ?? null,
      saturatedFat: nutriments["saturated-fat_100g"] ?? null,
      carbohydrates: nutriments.carbohydrates_100g ?? null,
      sugars: nutriments.sugars_100g ?? null,
      fiber: nutriments.fiber_100g ?? null,
      proteins: nutriments.proteins_100g ?? null,
      salt: nutriments.salt_100g ?? null,
      sodium: nutriments.sodium_100g ?? null,
    },

    // Allergens & ingredients
    allergens: p.allergens || null,
    ingredients: p.ingredients_text || p.ingredients_text_en || null,
    additives: p.additives_tags
      ? p.additives_tags.map((a) => a.replace("en:", "")).slice(0, 10)
      : [],

    // Metadata
    servingSize: p.serving_size || null,
    countries: p.countries || null,
    stores: p.stores || null,
    url: p.code ? `${OPEN_FOOD_FACTS_BASE_URL}/product/${p.code}` : null,
  };
}

// ─── Search Products ───────────────────────────────────────────────

/**
 * Search for food products by name.
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<object>}
 */
export async function searchFoodProducts(query, limit = 10) {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(Math.min(limit, 50)),
    fields:
      "code,product_name,product_name_en,brands,categories,image_front_url,image_url,quantity,nutriscore_grade,nutriscore_score,nova_group,ecoscore_grade,nutriments,allergens,ingredients_text,ingredients_text_en,additives_tags,serving_size,countries,stores",
  });

  const url = `${OPEN_FOOD_FACTS_BASE_URL}/cgi/search.pl?${params}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SunToolsAPI/1.0 (tools-api@sun.dev)",
    },
  });

  if (!res.ok) {
    throw new Error(`Open Food Facts → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    totalResults: data.count || 0,
    count: (data.products || []).length,
    products: (data.products || []).slice(0, limit).map(normalizeProduct),
  };
}

// ─── Get Product by Barcode ────────────────────────────────────────

/**
 * Get a specific product by barcode (EAN/UPC).
 * @param {string} barcode
 * @returns {Promise<object>}
 */
export async function getProductByBarcode(barcode) {
  const url = `${OPEN_FOOD_FACTS_BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}.json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SunToolsAPI/1.0 (tools-api@sun.dev)",
    },
  });

  if (!res.ok) {
    throw new Error(`Open Food Facts → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.status === 0 || !data.product) {
    return { found: false, barcode };
  }

  return { found: true, ...normalizeProduct(data.product) };
}
