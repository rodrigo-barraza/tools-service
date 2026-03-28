import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  NUTRITION_NUTRIENT_TYPES,
  NUTRITION_MACRO_FIELDS,
  NUTRITION_MINERAL_FIELDS,
  NUTRITION_VITAMIN_FIELDS,
  NUTRITION_AMINO_ACID_FIELDS,
  NUTRITION_LIPID_FIELDS,
  NUTRITION_CARB_DETAIL_FIELDS,
  NUTRITION_STEROL_FIELDS,
} from "../../constants.js";

/**
 * USDA Nutrition Fetcher — Static In-Memory Database
 *
 * Loads ~1,346 raw whole foods from the curated USDA digest CSV
 * into memory at import time. Provides search, lookup, and
 * nutrient-specific queries without any external API calls.
 *
 * All nutrient values are per 100g of the food.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── CSV Parser (handles quoted fields with commas) ────────────

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── Load & Index ──────────────────────────────────────────────

const FOOD_DB = [];
const NUTRIENT_DB = [];
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  // Load food data
  const foodPath = join(__dirname, "data", "digest_food.csv");
  const foodRaw = readFileSync(foodPath, "utf-8");
  const foodLines = foodRaw.split("\n").filter((l) => l.trim());
  const foodHeaders = parseCSVLine(foodLines[0]);

  for (let i = 1; i < foodLines.length; i++) {
    const values = parseCSVLine(foodLines[i]);
    if (values.length < 40) continue;

    const row = {};
    foodHeaders.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });

    // Parse numeric nutrient fields (columns 36 onward are numeric)
    const numericStart = 35; // protein is index 35 (0-based)
    for (let n = numericStart; n < foodHeaders.length; n++) {
      const val = parseFloat(row[foodHeaders[n]]);
      row[foodHeaders[n]] = isNaN(val) ? null : val;
    }

    FOOD_DB.push(row);
  }

  // Load nutrient metadata
  const nutrientPath = join(__dirname, "data", "digest_nutrient.csv");
  const nutrientRaw = readFileSync(nutrientPath, "utf-8");
  const nutrientLines = nutrientRaw.split("\n").filter((l) => l.trim());
  const nutrientHeaders = parseCSVLine(nutrientLines[0]);

  for (let i = 1; i < nutrientLines.length; i++) {
    const values = parseCSVLine(nutrientLines[i]);
    const row = {};
    nutrientHeaders.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    NUTRIENT_DB.push(row);
  }

  console.log(
    `🥦 Nutrition DB loaded: ${FOOD_DB.length} foods, ${NUTRIENT_DB.length} nutrients`,
  );
}

// ─── Search Helpers ────────────────────────────────────────────

function normalizeSearch(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

function scoreMatch(food, terms) {
  const name = normalizeSearch(food.food_name || "");
  const desc = normalizeSearch(food.description_long || "");
  const keywords = normalizeSearch(food.food_keywords || "");
  const type = normalizeSearch(food.food_type || "");
  const part = normalizeSearch(food.food_part || "");

  let score = 0;
  let allMatch = true;

  for (const term of terms) {
    let termMatched = false;

    // Exact name match is strongest
    if (name === term) {
      score += 100;
      termMatched = true;
    } else if (name.startsWith(term)) {
      score += 50;
      termMatched = true;
    } else if (name.includes(term)) {
      score += 30;
      termMatched = true;
    }

    if (desc.includes(term)) {
      score += 10;
      termMatched = true;
    }
    if (keywords.includes(term)) {
      score += 15;
      termMatched = true;
    }
    if (type.includes(term)) {
      score += 5;
      termMatched = true;
    }
    if (part.includes(term)) {
      score += 5;
      termMatched = true;
    }

    if (!termMatched) allMatch = false;
  }

  // All terms must match somewhere
  return allMatch ? score : 0;
}

// ─── Nutrient Extraction ───────────────────────────────────────

function extractMacros(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_MACRO_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function extractMinerals(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_MINERAL_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function extractVitamins(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_VITAMIN_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function extractAminoAcids(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_AMINO_ACID_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function extractLipidProfile(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_LIPID_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function extractCarbDetails(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_CARB_DETAIL_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function extractSterols(food) {
  const result = {};
  for (const [key, label] of Object.entries(NUTRITION_STEROL_FIELDS)) {
    if (food[key] !== null && food[key] !== undefined) {
      result[label] = food[key];
    }
  }
  return result;
}

function formatFood(food, nutrientTypes = null) {
  const types = nutrientTypes
    ? nutrientTypes.split(",").map((t) => t.trim().toLowerCase())
    : null;

  const base = {
    name: food.food_name,
    description: food.description_long,
    kingdom: food.kingdom,
    foodType: food.food_type,
    foodSubtype: food.food_subtype || null,
    part: food.food_part || null,
    form: food.food_form || null,
    state: food.food_state || null,
    taxonomy: {
      taxon: food.taxon || null,
      genus: food.genus || null,
      species: food.species || null,
      family: food.family || null,
      binomial: food.binomial || null,
    },
    perHundredGrams: {},
  };

  // Always include macros unless specific types are requested
  const includeAll = !types;
  const include = (t) => includeAll || types.includes(t);

  if (include("macros") || include("macro")) {
    base.perHundredGrams.macros = extractMacros(food);
  }
  if (include("minerals") || include("mineral")) {
    base.perHundredGrams.minerals = extractMinerals(food);
  }
  if (include("vitamins") || include("vitamin")) {
    base.perHundredGrams.vitamins = extractVitamins(food);
  }
  if (include("amino_acids") || include("amino") || include("protein")) {
    base.perHundredGrams.aminoAcids = extractAminoAcids(food);
  }
  if (include("lipids") || include("fats") || include("fat")) {
    base.perHundredGrams.lipidProfile = extractLipidProfile(food);
  }
  if (include("carbs") || include("carbohydrates") || include("sugars")) {
    base.perHundredGrams.carbDetails = extractCarbDetails(food);
  }
  if (include("sterols") || include("cholesterol")) {
    base.perHundredGrams.sterols = extractSterols(food);
  }

  return base;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Search for foods by name/keyword.
 * @param {string} query - Search term (e.g. "chicken", "spinach", "salmon")
 * @param {object} opts
 * @param {number} [opts.limit=10] - Max results
 * @param {string} [opts.kingdom] - Filter by kingdom (animalia, plantae, fungi)
 * @param {string} [opts.foodType] - Filter by food type (animal, plant, fungus)
 * @param {string} [opts.nutrientTypes] - Comma-separated nutrient categories to include
 * @returns {object} Search results
 */
export function searchFoods(query, opts = {}) {
  ensureLoaded();

  const { limit = 10, kingdom, foodType, nutrientTypes } = opts;
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return { count: 0, query, foods: [] };
  }

  let candidates = FOOD_DB;

  // Apply filters
  if (kingdom) {
    const k = kingdom.toLowerCase();
    candidates = candidates.filter(
      (f) => f.kingdom && f.kingdom.toLowerCase() === k,
    );
  }
  if (foodType) {
    const ft = foodType.toLowerCase();
    candidates = candidates.filter(
      (f) => f.food_type && f.food_type.toLowerCase() === ft,
    );
  }

  // Score and rank
  const scored = candidates
    .map((food) => ({ food, score: scoreMatch(food, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    count: scored.length,
    query,
    note: "All nutrient values are per 100g of edible portion. Source: USDA National Nutrient Database.",
    foods: scored.map((s) => formatFood(s.food, nutrientTypes)),
  };
}

/**
 * Get detailed nutrition for a specific food by exact name.
 * @param {string} name - Food name (e.g. "chicken", "salmon")
 * @param {string} [nutrientTypes] - Comma-separated nutrient types to return
 * @returns {object|null} Food nutrition data or null
 */
export function getFoodByName(name, nutrientTypes = null) {
  ensureLoaded();

  const normalized = normalizeSearch(name);
  const food = FOOD_DB.find((f) => normalizeSearch(f.food_name) === normalized);

  if (!food) return null;
  return formatFood(food, nutrientTypes);
}

/**
 * Get all foods ranked by a specific nutrient (highest first).
 * @param {string} nutrient - Nutrient column name (e.g. "protein", "calcium", "vitamin_b6")
 * @param {object} opts
 * @param {number} [opts.limit=10] - Max results
 * @param {string} [opts.kingdom] - Filter by kingdom
 * @param {string} [opts.foodType] - Filter by food type
 * @returns {object} Ranked results
 */
export function rankByNutrient(nutrient, opts = {}) {
  ensureLoaded();

  const { limit = 10, kingdom, foodType } = opts;

  // Validate nutrient exists
  if (!FOOD_DB[0] || !(nutrient in FOOD_DB[0])) {
    // Try to find a close match
    const allKeys = Object.keys(FOOD_DB[0] || {}).filter(
      (k) => typeof FOOD_DB[0][k] === "number" || FOOD_DB[0][k] === null,
    );
    return {
      error: `Unknown nutrient: "${nutrient}"`,
      availableNutrients: allKeys.slice(35), // skip taxonomy fields
    };
  }

  let candidates = FOOD_DB;

  if (kingdom) {
    const k = kingdom.toLowerCase();
    candidates = candidates.filter(
      (f) => f.kingdom && f.kingdom.toLowerCase() === k,
    );
  }
  if (foodType) {
    const ft = foodType.toLowerCase();
    candidates = candidates.filter(
      (f) => f.food_type && f.food_type.toLowerCase() === ft,
    );
  }

  const ranked = candidates
    .filter((f) => f[nutrient] !== null && f[nutrient] > 0)
    .sort((a, b) => b[nutrient] - a[nutrient])
    .slice(0, limit);

  // Find unit from nutrient metadata
  const nutrientMeta = NUTRIENT_DB.find((n) => n.nutrient_id === nutrient);

  return {
    nutrient,
    nutrientName: nutrientMeta?.nutrient_name || nutrient,
    type: nutrientMeta?.nutrient_type || "unknown",
    count: ranked.length,
    note: "All values per 100g edible portion. Source: USDA National Nutrient Database.",
    foods: ranked.map((f) => ({
      name: f.food_name,
      description: f.description_long,
      kingdom: f.kingdom,
      foodType: f.food_type,
      value: f[nutrient],
    })),
  };
}

/**
 * List available nutrient types for filtering.
 * @returns {object} Available nutrient categories and fields
 */
export function getNutrientTypes() {
  ensureLoaded();

  return {
    types: NUTRITION_NUTRIENT_TYPES,
    totalFoods: FOOD_DB.length,
    totalNutrients: NUTRIENT_DB.length,
    source: "USDA National Nutrient Database (curated raw whole foods)",
  };
}

/**
 * List all unique food categories / kingdoms / types.
 * @returns {object} Available taxonomy filters
 */
export function getFoodCategories() {
  ensureLoaded();

  const kingdoms = [...new Set(FOOD_DB.map((f) => f.kingdom).filter(Boolean))];
  const foodTypes = [
    ...new Set(FOOD_DB.map((f) => f.food_type).filter(Boolean)),
  ];
  const foodSubtypes = [
    ...new Set(FOOD_DB.map((f) => f.food_subtype).filter(Boolean)),
  ];
  const parts = [...new Set(FOOD_DB.map((f) => f.food_part).filter(Boolean))];

  return {
    totalFoods: FOOD_DB.length,
    kingdoms: kingdoms.sort(),
    foodTypes: foodTypes.sort(),
    foodSubtypes: foodSubtypes.sort(),
    parts: parts.sort(),
  };
}

/**
 * Compare nutrition between two or more foods.
 * @param {string[]} foodNames - Array of food names to compare
 * @param {string} [nutrientTypes] - Comma-separated nutrient types
 * @returns {object} Comparison results
 */
export function compareFoods(foodNames, nutrientTypes = null) {
  ensureLoaded();

  const results = foodNames.map((name) => {
    const normalized = normalizeSearch(name);
    const terms = normalized.split(/\s+/).filter(Boolean);

    // Try exact match first, then scored search
    let food = FOOD_DB.find((f) => normalizeSearch(f.food_name) === normalized);

    if (!food) {
      const scored = FOOD_DB.map((f) => ({
        food: f,
        score: scoreMatch(f, terms),
      }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      food = scored[0]?.food || null;
    }

    if (!food) return { query: name, found: false };
    return { query: name, found: true, ...formatFood(food, nutrientTypes) };
  });

  return {
    count: results.filter((r) => r.found).length,
    note: "All nutrient values per 100g edible portion. Source: USDA.",
    comparison: results,
  };
}
