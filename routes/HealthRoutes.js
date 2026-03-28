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
import { parseIntParam } from "../utilities.js";

const router = Router();

// ─── USDA Nutrition (raw whole foods — in-memory database) ────

router.get("/nutrition/search", (req, res) => {
  const { q, limit, kingdom, foodType, nutrientTypes } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = searchFoods(q, {
      limit: parseIntParam(limit, 10),
      kingdom,
      foodType,
      nutrientTypes,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Nutrition search failed: ${err.message}` });
  }
});

router.get("/nutrition/rank", (req, res) => {
  const { nutrient, limit, kingdom, foodType } = req.query;
  if (!nutrient) {
    return res
      .status(400)
      .json({ error: "Query parameter 'nutrient' is required" });
  }
  try {
    const result = rankByNutrient(nutrient, {
      limit: parseIntParam(limit, 10),
      kingdom,
      foodType,
    });
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Nutrient ranking failed: ${err.message}` });
  }
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
  try {
    const foodList = foods
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    if (foodList.length < 2) {
      return res
        .status(400)
        .json({ error: "At least 2 food names are required for comparison" });
    }
    const result = compareFoods(foodList, nutrientTypes);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Food comparison failed: ${err.message}` });
  }
});

router.get("/nutrition/categories", (_req, res) => {
  try {
    const result = getFoodCategories();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Categories lookup failed: ${err.message}` });
  }
});

router.get("/nutrition/nutrient-types", (_req, res) => {
  try {
    const result = getNutrientTypes();
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Nutrient types lookup failed: ${err.message}` });
  }
});

router.get("/nutrition/top", (req, res) => {
  const { category, nutrient, limit, kingdom, foodType } = req.query;
  if (!category || !nutrient) {
    return res.status(400).json({
      error:
        "Query parameters 'category' and 'nutrient' are required. Categories: macros, minerals, vitamins, amino_acids, lipids, carbs, sterols.",
    });
  }
  try {
    const result = getTopFoodsByCategory(category, nutrient, {
      limit: parseIntParam(limit, 10),
      kingdom,
      foodType,
    });
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Top foods lookup failed: ${err.message}` });
  }
});

router.get("/nutrition/nutrients/:category", (req, res) => {
  try {
    const result = listCategoryNutrients(req.params.category);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Category nutrients lookup failed: ${err.message}` });
  }
});

router.get("/nutrition/taxonomy/search", (req, res) => {
  const { rank, value, limit, nutrientTypes } = req.query;
  if (!rank || !value) {
    return res.status(400).json({
      error:
        "Query parameters 'rank' and 'value' are required. Ranks: kingdom, phylum, class, order, family, genus, species, etc.",
    });
  }
  try {
    const result = searchByTaxonomy(rank, value, {
      limit: parseIntParam(limit, 25),
      nutrientTypes,
    });
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Taxonomy search failed: ${err.message}` });
  }
});

router.get("/nutrition/taxonomy/tree", (req, res) => {
  const { rank, parentRank, parentValue } = req.query;
  try {
    const result = getTaxonomyTree(rank || null, parentRank || null, parentValue || null);
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Taxonomy tree lookup failed: ${err.message}` });
  }
});

// ─── Drug Info (openFDA) ───────────────────────────────────────────

router.get("/drugs/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = await searchDrugLabels(q, parseIntParam(limit, 5));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Drug search failed: ${err.message}` });
  }
});

router.get("/drugs/adverse-events", async (req, res) => {
  const { drug, limit } = req.query;
  if (!drug) {
    return res
      .status(400)
      .json({ error: "Query parameter 'drug' is required" });
  }
  try {
    const result = await getDrugAdverseEvents(drug, parseIntParam(limit, 10));
    res.json(result);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Adverse events lookup failed: ${err.message}` });
  }
});

router.get("/drugs/recalls", async (req, res) => {
  const { q, limit } = req.query;
  try {
    const result = await getDrugRecalls(q, parseIntParam(limit, 10));
    res.json(result);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Drug recalls lookup failed: ${err.message}` });
  }
});

// ─── FDA Drug NDC Database (In-Memory) ──────────────────────────────

router.get("/drugs/ndc/search", (req, res) => {
  const { q, limit, dosageForm, productType } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = searchDrugs(q, {
      limit: parseIntParam(limit, 10),
      dosageForm,
      productType,
    });
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Drug search failed: ${err.message}` });
  }
});

router.get("/drugs/ndc/lookup/:ndc", (req, res) => {
  try {
    const result = getDrugByNdc(req.params.ndc);
    if (!result) {
      return res.status(404).json({ error: `Drug not found: ${req.params.ndc}` });
    }
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Drug lookup failed: ${err.message}` });
  }
});

router.get("/drugs/ndc/dosage-forms", (_req, res) => {
  try {
    const result = getDosageForms();
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Dosage forms lookup failed: ${err.message}` });
  }
});

router.get("/drugs/ndc/ingredient", (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = searchByIngredient(q, {
      limit: parseIntParam(limit, 20),
    });
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Ingredient search failed: ${err.message}` });
  }
});

router.get("/drugs/ndc/pharm-class", (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = searchByPharmClass(q, {
      limit: parseIntParam(limit, 20),
    });
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Pharm class search failed: ${err.message}` });
  }
});

// ─── Health ────────────────────────────────────────────────────────

export function getHealthDomainHealth() {
  return {
    openFda: "on-demand",
    usdaNutrition: "on-demand (in-memory, ~1346 raw whole foods)",
    fdaDrugNdc: "on-demand (in-memory, ~26,000 products)",
  };
}

export default router;
