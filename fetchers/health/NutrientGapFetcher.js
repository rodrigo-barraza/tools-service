/**
 * Nutrient Gap Fetcher — Dietary Adequacy Assessment Engine
 *
 * Compares actual nutrient intake (from food log) against
 * authoritative requirements (DRI/AAFCO) to produce a
 * per-nutrient deficiency/surplus analysis.
 *
 * Bridges NutritionFetcher (food data) and NutritionRequirementFetcher
 * (target profiles) into a single gap analysis output.
 *
 * References:
 *   - IOM Dietary Reference Intakes (2006)
 *   - AAFCO Dog & Cat Food Nutrient Profiles (2023)
 */

import { searchFoods } from "./NutritionFetcher.js";
import { calculateTargetProfile } from "./NutritionRequirementFetcher.js";
import {
  NUTRITION_MACRO_FIELDS,
  NUTRITION_MINERAL_FIELDS,
  NUTRITION_VITAMIN_FIELDS,
  NUTRITION_AMINO_ACID_FIELDS,
  NUTRITION_LIPID_FIELDS,
  NUTRITION_STEROL_FIELDS,
} from "../../constants.js";

// ─── Mapping: requirement nutrient_id → food CSV column ────────
// The requirement CSV uses IDs like "protein", "calcium", "vitamin_a"
// The food CSV uses column names like "protein", "calcium", "vitamin_a_rae"
// This maps requirement IDs to food DB column names where they differ.

const REQUIREMENT_TO_FOOD_COLUMN = {
  // Direct matches (most nutrients share the same ID)
  protein: "protein",
  carbohydrate: "carbohydrate",
  lipid: "lipid",
  fiber: "fiber",
  water: "water",
  // Vitamins
  vitamin_a: "vitamin_a_rae",
  vitamin_c: "ascorbic_acid",
  vitamin_d: "vitamin_d",
  alpha_tocopherol: "alpha_tocopherol",
  phylloquinone: "phylloquinone",
  thiamin: "thiamin",
  riboflavin: "riboflavin",
  niacin: "niacin",
  vitamin_b5: "pantothenic_acid",
  vitamin_b6: "vitamin_b6",
  folate: "folate_total",
  cyanocobalamin: "cyanocobalamin",
  choline: "choline",
  // Minerals
  calcium: "calcium",
  phosphorus: "phosphorus",
  magnesium: "magnesium",
  sodium: "sodium",
  potassium: "potassium",
  iron: "iron",
  zinc: "zinc",
  copper: "copper",
  selenium: "selenium",
  iodine: "iodine",
  manganese: "manganese",
  fluoride: "fluoride",
  // Amino acids
  histidine: "histidine",
  isoleucine: "isoleucine",
  leucine: "leucine",
  lysine: "lysine",
  methionine: "methionine",
  phenylalanine: "phenylalanine",
  threonine: "threonine",
  tryptophan: "tryptophan",
  valine: "valine",
  cystine: "cystine",
  tyrosine: "tyrosine",
  arginine: "arginine",
  taurine: "taurine",
  // Lipids
  c18_d2_n6_cis_cis: "c18_d2_n6_cis_cis",
  c18_d3_n3_cis_cis_cis: "c18_d3_n3_cis_cis_cis",
  c20_d5_n3: "c20_d5_n3",
  c22_d6_n3: "c22_d6_n3_dha",
  c20_d4_n6: "c20_d4_undifferentiated",
  // Sterols
  cholesterol: "cholesterol",
  phytosterol: "phytosterol",
  // Other
  sugar: "sugar",
  caffeine: "caffeine",
  theobromine: "theobromine",
};

// ─── Unit Normalization ────────────────────────────────────────
// Requirements may be in different units than food data.
// Food data is always per 100g. We need to know what units
// the food DB uses for each nutrient.

const FOOD_COLUMN_UNITS = {};

// Build from all field maps
for (const [col, label] of Object.entries(NUTRITION_MACRO_FIELDS)) {
  FOOD_COLUMN_UNITS[col] = label.endsWith("_g") ? "g" : label.endsWith("_kcal") ? "kcal" : label.endsWith("_kj") ? "kj" : "g";
}
for (const [col, label] of Object.entries(NUTRITION_MINERAL_FIELDS)) {
  FOOD_COLUMN_UNITS[col] = label.endsWith("_mcg") ? "mcg" : "mg";
}
for (const [col, label] of Object.entries(NUTRITION_VITAMIN_FIELDS)) {
  FOOD_COLUMN_UNITS[col] = label.endsWith("_mcg") ? "mcg" : label.endsWith("_IU") ? "IU" : "mg";
}
for (const [col] of Object.entries(NUTRITION_AMINO_ACID_FIELDS)) {
  FOOD_COLUMN_UNITS[col] = "g";
}
for (const [col] of Object.entries(NUTRITION_LIPID_FIELDS)) {
  FOOD_COLUMN_UNITS[col] = "g";
}
for (const [col] of Object.entries(NUTRITION_STEROL_FIELDS)) {
  FOOD_COLUMN_UNITS[col] = "mg";
}

// ─── Unit Conversion Helpers ───────────────────────────────────

function convertToTarget(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;

  const normalized = `${fromUnit}→${toUnit}`;
  switch (normalized) {
    case "g→mg": return value * 1000;
    case "mg→g": return value / 1000;
    case "g→mcg": return value * 1_000_000;
    case "mcg→g": return value / 1_000_000;
    case "mg→mcg": return value * 1000;
    case "mcg→mg": return value / 1000;
    default: return value; // can't convert, pass through
  }
}

// ─── Status Classification ─────────────────────────────────────

function classifyStatus(pctDRI, hasUL, pctUL) {
  if (pctDRI === null) return "no_data";
  if (hasUL && pctUL > 100) return "over_UL";
  if (pctDRI >= 90 && pctDRI <= 110) return "adequate";
  if (pctDRI >= 110) return "surplus";
  if (pctDRI >= 50) return "low";
  return "deficient";
}

function statusEmoji(status) {
  switch (status) {
    case "deficient": return "🔴";
    case "low": return "🟡";
    case "adequate": return "🟢";
    case "surplus": return "🔵";
    case "over_UL": return "⛔";
    case "no_data": return "⚪";
    default: return "❓";
  }
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Analyze nutrient gaps between consumed foods and requirements.
 *
 * @param {object} params
 * @param {Array<{name: string, grams: number}>} params.foods - Foods consumed with amounts
 * @param {string} [params.species="human"] - Target species
 * @param {string} [params.lifeStage="adult_male"] - Life stage
 * @param {string} [params.authority] - Authority (auto-detected from species)
 * @param {number} [params.weightKg] - Body weight in kg
 * @param {number} [params.caloricIntake] - Daily caloric intake target
 * @returns {object} Gap analysis with per-nutrient status
 */
export function analyzeNutrientGaps({
  foods,
  species = "human",
  lifeStage = "adult_male",
  authority,
  weightKg,
  caloricIntake,
}) {
  // ── Validate ─────────────────────────────────────────────────
  if (!foods || !Array.isArray(foods) || foods.length === 0) {
    return {
      error: "Parameter 'foods' is required — provide an array of {name, grams} objects. Example: [{name: 'chicken breast', grams: 200}, {name: 'brown rice', grams: 150}]",
    };
  }

  for (const f of foods) {
    if (!f.name || !f.grams || f.grams <= 0) {
      return {
        error: `Invalid food entry: ${JSON.stringify(f)}. Each food must have 'name' (string) and 'grams' (positive number).`,
      };
    }
  }

  // ── Resolve foods from the database ──────────────────────────
  const resolvedFoods = [];
  const unresolvedFoods = [];

  for (const { name, grams } of foods) {
    const result = searchFoods(name, { limit: 1 });
    if (result.foods && result.foods.length > 0) {
      resolvedFoods.push({
        query: name,
        matched: result.foods[0].name,
        grams,
        food: result.foods[0],
      });
    } else {
      unresolvedFoods.push(name);
    }
  }

  if (resolvedFoods.length === 0) {
    return {
      error: "No foods could be matched in the database.",
      unresolvedFoods,
    };
  }

  // ── Aggregate consumed nutrients ─────────────────────────────
  // Food data is per 100g, scale by (grams / 100)
  const consumed = {};

  for (const { grams, food } of resolvedFoods) {
    const scale = grams / 100;
    const allNutrients = {
      ...(food.perHundredGrams.macros || {}),
      ...(food.perHundredGrams.minerals || {}),
      ...(food.perHundredGrams.vitamins || {}),
      ...(food.perHundredGrams.aminoAcids || {}),
      ...(food.perHundredGrams.lipidProfile || {}),
      ...(food.perHundredGrams.sterols || {}),
    };

    for (const [label, value] of Object.entries(allNutrients)) {
      if (value !== null && value !== undefined && typeof value === "number") {
        consumed[label] = (consumed[label] || 0) + value * scale;
      }
    }
  }

  // ── Get requirements ─────────────────────────────────────────
  const requirements = calculateTargetProfile({
    species,
    lifeStage,
    authority,
    weightKg,
    caloricIntake,
    includeCompositional: false,
  });

  if (requirements.error) {
    return { error: `Requirement calculation failed: ${requirements.error}` };
  }

  // ── Build reverse label→column map for matching ──────────────
  const ALL_FIELD_MAPS = {
    ...NUTRITION_MACRO_FIELDS,
    ...NUTRITION_MINERAL_FIELDS,
    ...NUTRITION_VITAMIN_FIELDS,
    ...NUTRITION_AMINO_ACID_FIELDS,
    ...NUTRITION_LIPID_FIELDS,
    ...NUTRITION_STEROL_FIELDS,
  };

  const labelToColumn = {};
  for (const [col, label] of Object.entries(ALL_FIELD_MAPS)) {
    labelToColumn[label] = col;
  }

  // ── Gap analysis per nutrient ────────────────────────────────
  const gaps = [];
  const { requirements: reqMap } = requirements;

  for (const [nutrientId, metrics] of Object.entries(reqMap)) {
    // Find the food column for this requirement nutrient
    const foodColumn = REQUIREMENT_TO_FOOD_COLUMN[nutrientId];
    if (!foodColumn) continue;

    // Find the label used in consumed data
    const label = ALL_FIELD_MAPS[foodColumn];
    if (!label) continue;

    const consumedValue = consumed[label] || 0;
    const foodUnit = FOOD_COLUMN_UNITS[foodColumn] || "unknown";

    // Find target value (use RDA > AI > MIN > RDA_multiplier_per_kg)
    let targetValue = null;
    let targetMetric = null;
    let targetUnit = null;
    let ulValue = null;

    for (const [metric, data] of Object.entries(metrics)) {
      if (metric === "NO_DRI") continue;

      const metricLower = metric.toLowerCase();
      if (metricLower === "ul") {
        ulValue = data.value;
        continue;
      }
      if (metricLower.includes("max")) continue;
      if (metricLower.includes("guideline_max")) continue;

      // Priority: RDA > RDA_multiplier_per_kg > AI > MIN_per_1000kcal > RECOMMENDATION
      if (!targetValue || priorityOf(metric) > priorityOf(targetMetric)) {
        targetValue = data.value;
        targetMetric = metric;
        targetUnit = data.unit;
      }
    }

    if (targetValue === null || targetValue === 0) continue;

    // Convert consumed value to match target unit if needed
    let consumedConverted = consumedValue;

    // Extract just the base unit from target (e.g. "mg" from "mg", "mcg RAE" → "mcg")
    const targetBaseUnit = (targetUnit || "").split(/\s/)[0].toLowerCase();
    const foodBaseUnit = foodUnit.toLowerCase();

    if (targetBaseUnit && foodBaseUnit && targetBaseUnit !== foodBaseUnit) {
      consumedConverted = convertToTarget(consumedValue, foodBaseUnit, targetBaseUnit);
    }

    const pctDRI = targetValue > 0
      ? Number(((consumedConverted / targetValue) * 100).toFixed(1))
      : null;
    const pctUL = ulValue
      ? Number(((consumedConverted / ulValue) * 100).toFixed(1))
      : null;

    const status = classifyStatus(pctDRI, !!ulValue, pctUL);

    gaps.push({
      nutrient: nutrientId,
      status,
      icon: statusEmoji(status),
      consumed: Number(consumedConverted.toFixed(4)),
      target: targetValue,
      unit: targetUnit,
      pctDRI,
      pctUL: pctUL || null,
      metric: targetMetric,
    });
  }

  // ── Sort: deficiencies first, then low, adequate, surplus, over_UL ──
  const statusOrder = { deficient: 0, low: 1, over_UL: 2, surplus: 3, adequate: 4, no_data: 5 };
  gaps.sort((a, b) => {
    const orderDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return (a.pctDRI || 0) - (b.pctDRI || 0);
  });

  // ── Summary ──────────────────────────────────────────────────
  const deficient = gaps.filter((g) => g.status === "deficient");
  const low = gaps.filter((g) => g.status === "low");
  const adequate = gaps.filter((g) => g.status === "adequate");
  const surplus = gaps.filter((g) => g.status === "surplus");
  const overUL = gaps.filter((g) => g.status === "over_UL");

  const totalCalories = consumed["calories_kcal"] || 0;

  return {
    _context: requirements._context,
    summary: {
      foodsAnalyzed: resolvedFoods.length,
      unresolvedFoods: unresolvedFoods.length > 0 ? unresolvedFoods : undefined,
      nutrientsEvaluated: gaps.length,
      totalCalories: Math.round(totalCalories),
      deficient: deficient.length,
      low: low.length,
      adequate: adequate.length,
      surplus: surplus.length,
      overUL: overUL.length,
      overallScore: gaps.length > 0
        ? Number(
          (
            (gaps.filter((g) => g.status === "adequate" || g.status === "surplus").length /
              gaps.length) *
            100
          ).toFixed(1),
        )
        : 0,
    },
    foodLog: resolvedFoods.map((f) => ({
      query: f.query,
      matched: f.matched,
      grams: f.grams,
    })),
    gaps,
    _note: "Status: 🔴 deficient (<50% DRI), 🟡 low (50-89% DRI), 🟢 adequate (90-110% DRI), 🔵 surplus (>110% DRI), ⛔ over_UL (exceeds tolerable upper limit).",
  };
}

// ─── Metric Priority Helper ───────────────────────────────────

function priorityOf(metric) {
  if (!metric) return -1;
  const m = metric.toLowerCase();
  if (m === "rda") return 10;
  if (m === "rda_multiplier_per_kg") return 9;
  if (m === "ai") return 8;
  if (m.includes("min_per_1000kcal")) return 7;
  if (m === "recommendation") return 6;
  if (m === "guideline") return 5;
  return 0;
}
