import { asyncHandler } from "@rodrigo-barraza/utilities-library/node";
import { parseIntParam } from "@rodrigo-barraza/utilities-library";
import { Router } from "express";
import CONFIG from "../config.js";
import {
  getNextBus,
  getStopInfo,
  findStopsNearby,
  getRouteInfo,
} from "../fetchers/transit/TransLinkFetcher.js";
const router = Router();
// ─── Next Bus ──────────────────────────────────────────────────────
router.get("/nextbus/:stopNo", async (req, res) => {
  const stopNo = parseInt(req.params.stopNo, 10);
  if (isNaN(stopNo)) {
    return res.status(400).json({ error: "Invalid stop number" });
  }
  res.json(await getNextBus(stopNo, req.query.route));
});
// ─── Stop Info ─────────────────────────────────────────────────────
router.get("/stops/:stopNo", async (req, res) => {
  const stopNo = parseInt(req.params.stopNo, 10);
  if (isNaN(stopNo)) {
    return res.status(400).json({ error: "Invalid stop number" });
  }
  res.json(await getStopInfo(stopNo));
});
// ─── Find Nearby Stops ────────────────────────────────────────────
router.get("/stops/nearby", asyncHandler(
  (req) => {
    const lat = parseFloat(req.query.lat || CONFIG.LATITUDE);
    const lng = parseFloat(req.query.lng || CONFIG.LONGITUDE);
    const radius = parseIntParam(req.query.radius, 500);
    return findStopsNearby(lat, lng, radius);
  },
  "Nearby stops",
));
// ─── Route Info ────────────────────────────────────────────────────
router.get("/routes/:routeNo", asyncHandler(
  (req) => getRouteInfo(req.params.routeNo),
  "Route info",
));
// ─── Health ────────────────────────────────────────────────────────
export function getTransitHealth() {
  return {
    translink: CONFIG.TRANSLINK_API_KEY ? "ready" : "no-api-key",
  };
}
export default router;
