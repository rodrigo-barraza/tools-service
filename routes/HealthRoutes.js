import { Router } from "express";
import {
  searchDrugLabels,
  getDrugAdverseEvents,
  getDrugRecalls,
} from "../fetchers/health/OpenFdaFetcher.js";
import {
  searchFoods,
  rankByNutrient,
  compareFoods,
  getNutrientTypes,
  getFoodCategories,
  getTopFoodsByCategory,
  listCategoryNutrients,
  searchByTaxonomy,
  getTaxonomyTree,
} from "../fetchers/health/NutritionFetcher.js";
import {
  searchDrugs,
  getDrugByNdc,
  getDosageForms,
  searchByIngredient,
  searchByPharmClass,
} from "../fetchers/health/FdaDrugFetcher.js";
import {
  searchExercises,
  getExerciseById,
  getExerciseCategories,
} from "../fetchers/health/ExercisesFetcher.js";
import { parseIntParam, asyncHandler } from "../utilities.js";

const router = Router();

// ─── USDA Nutrition (raw whole foods — in-memory database) ────

router.get("/nutrition/search", (req, res) => {
  const { q, limit, kingdom, foodType, nutrientTypes } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchFoods(q, {
    limit: parseIntParam(limit, 10),
    kingdom,
    foodType,
    nutrientTypes,
  }));
});

router.get("/nutrition/rank", (req, res) => {
  const { nutrient, limit, kingdom, foodType } = req.query;
  if (!nutrient) {
    return res
      .status(400)
      .json({ error: "Query parameter 'nutrient' is required" });
  }
  const result = rankByNutrient(nutrient, {
    limit: parseIntParam(limit, 10),
    kingdom,
    foodType,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/nutrition/compare", (req, res) => {
  const { foods, nutrientTypes } = req.query;
  if (!foods) {
    return res
      .status(400)
      .json({
        error:
          "Query parameter 'foods' is required (comma-separated food names)",
      });
  }
  const foodList = foods
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (foodList.length < 2) {
    return res
      .status(400)
      .json({ error: "At least 2 food names are required for comparison" });
  }
  res.json(compareFoods(foodList, nutrientTypes));
});

router.get("/nutrition/categories", asyncHandler(
  () => getFoodCategories(),
  "Categories lookup",
  500,
));

router.get("/nutrition/nutrient-types", asyncHandler(
  () => getNutrientTypes(),
  "Nutrient types lookup",
  500,
));

router.get("/nutrition/top", (req, res) => {
  const { category, nutrient, limit, kingdom, foodType } = req.query;
  if (!category || !nutrient) {
    return res.status(400).json({
      error:
        "Query parameters 'category' and 'nutrient' are required. Categories: macros, minerals, vitamins, amino_acids, lipids, carbs, sterols.",
    });
  }
  const result = getTopFoodsByCategory(category, nutrient, {
    limit: parseIntParam(limit, 10),
    kingdom,
    foodType,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/nutrition/nutrients/:category", (req, res) => {
  const result = listCategoryNutrients(req.params.category);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/nutrition/taxonomy/search", (req, res) => {
  const { rank, value, limit, nutrientTypes } = req.query;
  if (!rank || !value) {
    return res.status(400).json({
      error:
        "Query parameters 'rank' and 'value' are required. Ranks: kingdom, phylum, class, order, family, genus, species, etc.",
    });
  }
  const result = searchByTaxonomy(rank, value, {
    limit: parseIntParam(limit, 25),
    nutrientTypes,
  });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get("/nutrition/taxonomy/tree", (req, res) => {
  const { rank, parentRank, parentValue } = req.query;
  const result = getTaxonomyTree(rank || null, parentRank || null, parentValue || null);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Drug Info (openFDA) ───────────────────────────────────────────

router.get("/drugs/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchDrugLabels(q, parseIntParam(limit, 5)));
});

router.get("/drugs/adverse-events", async (req, res) => {
  const { drug, limit } = req.query;
  if (!drug) {
    return res
      .status(400)
      .json({ error: "Query parameter 'drug' is required" });
  }
  res.json(await getDrugAdverseEvents(drug, parseIntParam(limit, 10)));
});

router.get("/drugs/recalls", asyncHandler(
  (req) => getDrugRecalls(req.query.q, parseIntParam(req.query.limit, 10)),
  "Drug recalls lookup",
));

// ─── FDA Drug NDC Database (In-Memory) ──────────────────────────────

router.get("/drugs/ndc/search", (req, res) => {
  const { q, limit, dosageForm, productType } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchDrugs(q, {
    limit: parseIntParam(limit, 10),
    dosageForm,
    productType,
  }));
});

router.get("/drugs/ndc/lookup/:ndc", (req, res) => {
  const result = getDrugByNdc(req.params.ndc);
  if (!result) {
    return res.status(404).json({ error: `Drug not found: ${req.params.ndc}` });
  }
  res.json(result);
});

router.get("/drugs/ndc/dosage-forms", asyncHandler(
  () => getDosageForms(),
  "Dosage forms lookup",
  500,
));

router.get("/drugs/ndc/ingredient", (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchByIngredient(q, {
    limit: parseIntParam(limit, 20),
  }));
});

router.get("/drugs/ndc/pharm-class", (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchByPharmClass(q, {
    limit: parseIntParam(limit, 20),
  }));
});

// ─── Gym Exercises (Free Exercise DB) ──────────────────────────────

router.get("/exercises/search", (req, res) => {
  const { q, limit, category, equipment, force, level, mechanic, muscle } = req.query;
  res.json(searchExercises(q, {
    limit: parseIntParam(limit, 10),
    category,
    equipment,
    force,
    level,
    mechanic,
    muscle,
  }));
});

router.get("/exercises/categories", asyncHandler(
  () => getExerciseCategories(),
  "Exercise categories lookup",
  500,
));

router.get("/exercises/:id", (req, res) => {
  const result = getExerciseById(req.params.id);
  if (!result) {
    return res.status(404).json({ error: `Exercise not found: ${req.params.id}` });
  }
  res.json(result);
});

// ─── Health ────────────────────────────────────────────────────────

export function getHealthDomainHealth() {
  return {
    openFda: "on-demand",
    usdaNutrition: "on-demand (in-memory, ~1346 raw whole foods)",
    fdaDrugNdc: "on-demand (in-memory, ~26,000 products)",
    freeExerciseDb: "on-demand (in-memory, ~1700+ exercises from multiple sources)",
  };
}


// ── Unified Drug Search Dispatcher ─────────────────────────────────

router.get("/drugs/unified", async (req, res) => {
  const { q, searchBy, limit, dosageForm, productType } = req.query;
  if (!q) return res.status(400).json({ error: "'q' is required" });

  const mode = searchBy || "name";
  switch (mode) {
    case "name":
      req.url = `/drugs/search?q=${encodeURIComponent(q)}&limit=${limit || 10}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "ndc_search":
      req.url = `/drugs/ndc/search?q=${encodeURIComponent(q)}&limit=${limit || 10}&dosageForm=${dosageForm || ""}&productType=${productType || ""}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "ndc_lookup":
      req.url = `/drugs/ndc/lookup/${encodeURIComponent(q)}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "ingredient":
      req.url = `/drugs/ndc/ingredient?q=${encodeURIComponent(q)}&limit=${limit || 10}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "pharm_class":
      req.url = `/drugs/ndc/pharm-class?q=${encodeURIComponent(q)}&limit=${limit || 10}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    default:
      return res.status(400).json({ error: `Unknown searchBy: ${mode}`, validModes: ["name", "ndc_search", "ndc_lookup", "ingredient", "pharm_class"] });
  }
});

export default router;
