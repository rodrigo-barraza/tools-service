import { Router } from "express";
import {
  searchFoodProducts,
  getProductByBarcode,
} from "../fetchers/health/OpenFoodFactsFetcher.js";
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
} from "../fetchers/health/NutritionFetcher.js";
import { parseIntParam } from "../utilities.js";

const router = Router();

// ─── Food / Nutrition (Open Food Facts — packaged products) ───

router.get("/food/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = await searchFoodProducts(q, parseIntParam(limit, 10));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Food search failed: ${err.message}` });
  }
});

router.get("/food/barcode/:barcode", async (req, res) => {
  try {
    const result = await getProductByBarcode(req.params.barcode);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Barcode lookup failed: ${err.message}` });
  }
});

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

// ─── Health ────────────────────────────────────────────────────────

export function getHealthDomainHealth() {
  return {
    openFoodFacts: "on-demand",
    openFda: "on-demand",
    usdaNutrition: "on-demand (in-memory, ~1346 raw whole foods)",
  };
}

export default router;
