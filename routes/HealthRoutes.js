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
import { parseIntParam } from "../utilities.js";

const router = Router();

// ─── Food / Nutrition ──────────────────────────────────────────────

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
  };
}

export default router;
