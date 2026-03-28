import { Router } from "express";
import CONFIG from "../config.js";
import {
  getNextBus,
  getStopInfo,
  findStopsNearby,
  getRouteInfo,
} from "../fetchers/transit/TransLinkFetcher.js";
import { parseIntParam } from "../utilities.js";

const router = Router();

// ─── Next Bus ──────────────────────────────────────────────────────

router.get("/nextbus/:stopNo", async (req, res) => {
  const stopNo = parseInt(req.params.stopNo, 10);
  if (isNaN(stopNo)) {
    return res.status(400).json({ error: "Invalid stop number" });
  }
  try {
    const result = await getNextBus(stopNo, req.query.route);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Next bus failed: ${err.message}` });
  }
});

// ─── Stop Info ─────────────────────────────────────────────────────

router.get("/stops/:stopNo", async (req, res) => {
  const stopNo = parseInt(req.params.stopNo, 10);
  if (isNaN(stopNo)) {
    return res.status(400).json({ error: "Invalid stop number" });
  }
  try {
    const result = await getStopInfo(stopNo);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Stop info failed: ${err.message}` });
  }
});

// ─── Find Nearby Stops ────────────────────────────────────────────

router.get("/stops/nearby", async (req, res) => {
  const lat = parseFloat(req.query.lat || CONFIG.LATITUDE);
  const lng = parseFloat(req.query.lng || CONFIG.LONGITUDE);
  const radius = parseIntParam(req.query.radius, 500);

  try {
    const result = await findStopsNearby(lat, lng, radius);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Nearby stops failed: ${err.message}` });
  }
});

// ─── Route Info ────────────────────────────────────────────────────

router.get("/routes/:routeNo", async (req, res) => {
  try {
    const result = await getRouteInfo(req.params.routeNo);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Route info failed: ${err.message}` });
  }
});

// ─── Health ────────────────────────────────────────────────────────

export function getTransitHealth() {
  return {
    translink: CONFIG.TRANSLINK_API_KEY ? "ready" : "no-api-key",
  };
}

export default router;
