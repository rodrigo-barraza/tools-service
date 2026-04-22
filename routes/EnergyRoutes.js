import { Router } from "express";
import {
  browseRoute,
  getFacetValues,
  getData,
  getEnergyIndicators,
} from "../fetchers/energy/EiaFetcher.js";
import { asyncHandler } from "../utilities.js";

const router = Router();

// ─── Key Energy Indicators (curated snapshot) ──────────────────────

router.get(
  "/indicators",
  asyncHandler(() => getEnergyIndicators(), "Energy indicators fetch"),
);

// ─── Browse Data Tree ──────────────────────────────────────────────

router.get("/browse", asyncHandler((req) => {
  const route = req.query.route || "";
  return browseRoute(route);
}, "EIA browse"));

// ─── Facet Values ──────────────────────────────────────────────────

router.get("/facets", async (req, res) => {
  const { route, facetId } = req.query;
  if (!route || !facetId) {
    return res
      .status(400)
      .json({ error: "Parameters 'route' and 'facetId' are required" });
  }
  try {
    res.json(await getFacetValues(route, facetId));
  } catch (err) {
    res
      .status(502)
      .json({ error: `Facet fetch failed: ${err.message}` });
  }
});

// ─── Data Query ────────────────────────────────────────────────────

router.get("/data", asyncHandler(async (req) => {
  const { route, frequency, start, end, sort, length, offset, ...rest } =
    req.query;

  if (!route) {
    return { error: "Parameter 'route' is required" };
  }

  // Parse data[] columns from query string
  const dataColumns = req.query["data[]"]
    ? Array.isArray(req.query["data[]"])
      ? req.query["data[]"]
      : [req.query["data[]"]]
    : req.query.data
      ? Array.isArray(req.query.data)
        ? req.query.data
        : [req.query.data]
      : undefined;

  // Parse facets from query string — facets[stateid][]=CO format
  const facets = {};
  for (const key of Object.keys(rest)) {
    const match = key.match(/^facets\[(\w+)\]\[\]$/);
    if (match) {
      const facetId = match[1];
      facets[facetId] = Array.isArray(rest[key]) ? rest[key] : [rest[key]];
    }
  }

  return getData(route, {
    data: dataColumns,
    facets: Object.keys(facets).length > 0 ? facets : undefined,
    frequency,
    start,
    end,
    sort,
    length: parseInt(length, 10) || 100,
    offset: parseInt(offset, 10) || 0,
  });
}, "EIA data"));

// ─── Convenience: Electricity ──────────────────────────────────────

router.get(
  "/electricity/retail-sales",
  asyncHandler((req) => {
    const { state, sector, frequency, start, end, length } = req.query;
    const facets = {};
    if (state) facets.stateid = Array.isArray(state) ? state : [state];
    if (sector) facets.sectorid = Array.isArray(sector) ? sector : [sector];
    return getData("electricity/retail-sales", {
      data: ["price", "revenue", "sales", "customers"],
      facets: Object.keys(facets).length > 0 ? facets : undefined,
      frequency: frequency || "monthly",
      start,
      end,
      length: parseInt(length, 10) || 50,
      sort: "period:desc",
    });
  }, "Electricity retail sales fetch"),
);

// ─── Convenience: Petroleum Prices ─────────────────────────────────

router.get(
  "/petroleum/prices",
  asyncHandler((req) => {
    const { product, area, frequency, start, end, length } = req.query;
    const facets = {};
    if (product) facets.product = Array.isArray(product) ? product : [product];
    if (area) facets.duoarea = Array.isArray(area) ? area : [area];
    return getData("petroleum/pri/gnd", {
      data: ["value"],
      facets: Object.keys(facets).length > 0 ? facets : undefined,
      frequency: frequency || "weekly",
      start,
      end,
      length: parseInt(length, 10) || 50,
      sort: "period:desc",
    });
  }, "Petroleum prices fetch"),
);

// ─── Convenience: Natural Gas Prices ───────────────────────────────

router.get(
  "/natural-gas/prices",
  asyncHandler((req) => {
    const { process: process_, area, frequency, start, end, length } = req.query;
    const facets = {};
    if (process_) facets.process = Array.isArray(process_) ? process_ : [process_];
    if (area) facets.duoarea = Array.isArray(area) ? area : [area];
    return getData("natural-gas/pri/sum", {
      data: ["value"],
      facets: Object.keys(facets).length > 0 ? facets : undefined,
      frequency: frequency || "monthly",
      start,
      end,
      length: parseInt(length, 10) || 50,
      sort: "period:desc",
    });
  }, "Natural gas prices fetch"),
);

// ─── Health ────────────────────────────────────────────────────────

export function getEnergyHealth() {
  return {
    eia: "on-demand",
  };
}

export default router;
