import { Router } from "express";
import {
  getTrackedVessels,
  getVesselByMmsi,
  getRecentMessages,
  getVesselsInArea,
  searchVessels,
  getAisStreamHealth,
} from "../fetchers/maritime/AisStreamFetcher.js";

const router = Router();

// ─── Tracked Vessels (latest known state per MMSI) ─────────────────

router.get("/vessels", (_req, res) => {
  const limit = parseInt(_req.query.limit, 10) || 100;
  const vessels = getTrackedVessels(limit);
  res.json({ count: vessels.length, vessels });
});

// ─── Vessel by MMSI ────────────────────────────────────────────────

router.get("/vessels/:mmsi", (req, res) => {
  const vessel = getVesselByMmsi(req.params.mmsi);
  if (!vessel) {
    return res
      .status(404)
      .json({ error: `Vessel MMSI ${req.params.mmsi} not found in buffer` });
  }
  res.json(vessel);
});

// ─── Vessel Search ─────────────────────────────────────────────────

router.get("/search", (req, res) => {
  const { q, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  const results = searchVessels(q, parseInt(limit, 10) || 20);
  res.json({ query: q, count: results.length, vessels: results });
});

// ─── Vessels in Area ───────────────────────────────────────────────

router.get("/area", (req, res) => {
  const { minLat, maxLat, minLng, maxLng, limit } = req.query;
  if (!minLat || !maxLat || !minLng || !maxLng) {
    return res
      .status(400)
      .json({ error: "Parameters minLat, maxLat, minLng, maxLng are required" });
  }
  const vessels = getVesselsInArea(
    parseFloat(minLat),
    parseFloat(maxLat),
    parseFloat(minLng),
    parseFloat(maxLng),
    parseInt(limit, 10) || 100,
  );
  res.json({ count: vessels.length, vessels });
});

// ─── Recent Messages (raw stream buffer) ───────────────────────────

router.get("/messages", (req, res) => {
  const { limit, type } = req.query;
  const messages = getRecentMessages(parseInt(limit, 10) || 50, type || null);
  res.json({ count: messages.length, messages });
});

// ─── Health ────────────────────────────────────────────────────────

export function getMaritimeHealth() {
  return {
    aisStream: getAisStreamHealth(),
  };
}

export default router;
