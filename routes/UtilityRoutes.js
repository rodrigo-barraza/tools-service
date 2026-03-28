import { Router } from "express";
import {
  convertCurrency,
  listCurrencies,
} from "../fetchers/utility/CurrencyFetcher.js";
import {
  getTimeInTimezone,
  listTimezones,
} from "../fetchers/utility/TimezoneFetcher.js";
import { lookupIp, batchLookupIps } from "../fetchers/utility/IpInfoFetcher.js";
import {
  searchNearbyPlaces,
  searchPlacesByText,
  buildStaticMapUrl,
} from "../fetchers/utility/PlacesFetcher.js";

const router = Router();

// ─── Currency Conversion ───────────────────────────────────────────

router.get("/currency/convert", async (req, res) => {
  const { amount, from, to } = req.query;
  if (!from || !to) {
    return res
      .status(400)
      .json({ error: "Query parameters 'from' and 'to' are required" });
  }
  try {
    const result = await convertCurrency(parseFloat(amount) || 1, from, to);
    res.json(result);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Currency conversion failed: ${err.message}` });
  }
});

router.get("/currency/list", async (_req, res) => {
  try {
    const currencies = await listCurrencies();
    res.json({ count: currencies.length, currencies });
  } catch (err) {
    res.status(502).json({ error: `Currency list failed: ${err.message}` });
  }
});

// ─── Timezone ──────────────────────────────────────────────────────

router.get("/timezone/:area/:location", async (req, res) => {
  const timezone = `${req.params.area}/${req.params.location}`;
  try {
    const result = await getTimeInTimezone(timezone);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Timezone lookup failed: ${err.message}` });
  }
});

router.get("/timezone/list", async (req, res) => {
  try {
    const timezones = await listTimezones(req.query.area);
    res.json({
      count: Array.isArray(timezones) ? timezones.length : 0,
      timezones,
    });
  } catch (err) {
    res.status(502).json({ error: `Timezone list failed: ${err.message}` });
  }
});

// ─── IP Geolocation (IPinfo) ───────────────────────────────────────

router.get("/ip/batch", async (req, res) => {
  const ips = req.query.ips;
  if (!ips) {
    return res
      .status(400)
      .json({ error: "Query parameter 'ips' (comma-separated) is required" });
  }
  try {
    const ipArray = ips
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean);
    const result = await batchLookupIps(ipArray);
    res.json({ count: result.length, results: result });
  } catch (err) {
    res.status(502).json({ error: `Batch IP lookup failed: ${err.message}` });
  }
});

router.get("/ip", async (_req, res) => {
  try {
    const result = await lookupIp("");
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `IP lookup failed: ${err.message}` });
  }
});

router.get("/ip/:ip", async (req, res) => {
  try {
    // Detect literal ":ip" (unresolved path template) or "self" → self-lookup
    const raw = req.params.ip;
    const ip = raw === "self" || raw === ":ip" ? "" : raw;
    const result = await lookupIp(ip);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `IP lookup failed: ${err.message}` });
  }
});

// ─── Places — Nearby Search (Google Places API New) ────────────────

router.get("/places/nearby", async (req, res) => {
  const { type, latitude, longitude, radius, limit } = req.query;
  if (!type) {
    return res
      .status(400)
      .json({ error: "Query parameter 'type' is required (e.g. restaurant, cafe, gas_station)" });
  }
  try {
    const result = await searchNearbyPlaces({
      type,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      radius: radius ? parseInt(radius) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Places nearby search failed: ${err.message}` });
  }
});

// ─── Places — Text Search (Google Places API New) ──────────────────

router.get("/places/search", async (req, res) => {
  const { q, latitude, longitude, radius, limit } = req.query;
  if (!q) {
    return res
      .status(400)
      .json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = await searchPlacesByText({
      query: q,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      radius: radius ? parseInt(radius) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Places text search failed: ${err.message}` });
  }
});

// ─── Map Generation (Google Maps Static API) ──────────────────────

router.get("/map", async (req, res) => {
  const { markers, center, zoom, size, maptype } = req.query;
  if (!markers) {
    return res
      .status(400)
      .json({ error: "Query parameter 'markers' is required (JSON array of {latitude, longitude, label?})" });
  }
  try {
    let markerList;
    try {
      markerList = JSON.parse(markers);
    } catch {
      return res
        .status(400)
        .json({ error: "'markers' must be a valid JSON array" });
    }

    if (!Array.isArray(markerList) || markerList.length === 0) {
      return res
        .status(400)
        .json({ error: "'markers' must be a non-empty array" });
    }

    let centerObj = null;
    if (center) {
      try {
        centerObj = JSON.parse(center);
      } catch {
        /* ignore */
      }
    }

    const mapUrl = buildStaticMapUrl(markerList, centerObj || {}, {
      size: size || "800x400",
      zoom: zoom ? parseInt(zoom) : undefined,
      maptype: maptype || "roadmap",
    });

    if (!mapUrl) {
      return res
        .status(500)
        .json({ error: "GOOGLE_API_KEY is not configured" });
    }

    res.json({
      staticMapUrl: mapUrl,
      markerCount: markerList.length,
    });
  } catch (err) {
    res.status(502).json({ error: `Map generation failed: ${err.message}` });
  }
});

// ─── Health ────────────────────────────────────────────────────────

export function getUtilityHealth() {
  return {
    currency: "on-demand",
    timezone: "on-demand",
    ipinfo: "on-demand",
    places: "on-demand",
  };
}

export default router;

