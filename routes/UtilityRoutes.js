import { asyncHandler, setupStreamingSSE } from "@rodrigo-barraza/utilities-library/node";
import { validateMaxLength } from "@rodrigo-barraza/utilities-library";
import { Router } from "express";
import BigNumber from "bignumber.js";
import CONFIG from "../config.js";
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
} from "../fetchers/utility/PlacesFetcher.js";
import {
  searchAirports,
  getAirportByCode,
  getAirportsByCountry,
  getNearestAirports,
} from "../fetchers/utility/AirportFetcher.js";
import { getPublicWebcams } from "../fetchers/utility/WebcamFetcher.js";
import {
  executePython,
  executePythonStreaming,
  getInterpreterInfo,
} from "../services/PythonInterpreterService.js";
import {
  storeChart,
  getStoredChart,
  renderChartPng,
} from "../services/ChartService.js";
import { MAX_CODE_LENGTH } from "../constants.js";
import { EphemeralStore, buildLocalUrl } from "../utilities.js";
import { crawlSingleStatic } from "../services/CrawlerService.js";
const router = Router();
// ─── Calculator (BigNumber) ────────────────────────────────────────
router.get("/calculate", (req, res) => {
  const { operation, a, b } = req.query;
  if (!operation || !a) {
    return res.status(400).json({ error: "Query parameters 'operation' and 'a' are required" });
  }
  try {
    const numA = new BigNumber(a);
    let numB;
    if (b !== undefined && b !== "") {
      numB = new BigNumber(b);
    }
    let result;
    switch (operation) {
      case "add":
        if (numB === undefined) throw new Error("'b' is required for add");
        result = numA.plus(numB);
        break;
      case "subtract":
        if (numB === undefined) throw new Error("'b' is required for subtract");
        result = numA.minus(numB);
        break;
      case "multiply":
        if (numB === undefined) throw new Error("'b' is required for multiply");
        result = numA.multipliedBy(numB);
        break;
      case "divide":
        if (numB === undefined) throw new Error("'b' is required for divide");
        result = numA.dividedBy(numB);
        break;
      case "modulo":
        if (numB === undefined) throw new Error("'b' is required for modulo");
        result = numA.modulo(numB);
        break;
      case "power":
        if (numB === undefined) throw new Error("'b' is required for power");
        result = numA.exponentiatedBy(numB);
        break;
      case "sqrt":
        result = numA.squareRoot();
        break;
      default:
        return res.status(400).json({ error: `Unsupported operation: ${operation}` });
    }
    if (result.isNaN()) {
      return res.status(400).json({ error: "Result is Not-a-Number (NaN)" });
    }
    res.json({
      operation,
      a,
      b: b || null,
      result: result.toFixed(),
    });
  } catch (err) {
    res.status(400).json({ error: `Calculation failed: ${err.message}` });
  }
});
// ─── Currency Conversion ───────────────────────────────────────────
router.get("/currency/convert", async (req, res) => {
  const { amount, from, to } = req.query;
  if (!from || !to) {
    return res
      .status(400)
      .json({ error: "Query parameters 'from' and 'to' are required" });
  }
  res.json(await convertCurrency(parseFloat(amount) || 1, from, to));
});
router.get("/currency/list", asyncHandler(
  async () => {
    const currencies = await listCurrencies();
    return { count: currencies.length, currencies };
  },
  "Currency list",
));
// ─── Timezone ──────────────────────────────────────────────────────
router.get("/timezone/:area/:location", asyncHandler(
  (req) => getTimeInTimezone(`${req.params.area}/${req.params.location}`),
  "Timezone lookup",
));
router.get("/timezone/list", asyncHandler(
  async (req) => {
    const timezones = await listTimezones(req.query.area);
    return {
      count: Array.isArray(timezones) ? timezones.length : 0,
      timezones,
    };
  },
  "Timezone list",
));
// ─── IP Geolocation (IPinfo) ───────────────────────────────────────
router.get("/ip/batch", async (req, res) => {
  const ips = req.query.ips;
  if (!ips) {
    return res
      .status(400)
      .json({ error: "Query parameter 'ips' (comma-separated) is required" });
  }
  const ipArray = ips
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  const result = await batchLookupIps(ipArray);
  res.json({ count: result.length, results: result });
});
router.get("/ip", asyncHandler(
  () => lookupIp(""),
  "IP lookup",
));
router.get("/ip/:ip", asyncHandler(
  (req) => {
    const raw = req.params.ip;
    const ip = raw === "self" || raw === ":ip" ? "" : raw;
    return lookupIp(ip);
  },
  "IP lookup",
));
// ─── Places — Nearby Search (Google Places API New) ────────────────
router.get("/places/nearby", async (req, res) => {
  const { type, latitude, longitude, radius, limit } = req.query;
  if (!type) {
    return res
      .status(400)
      .json({ error: "Query parameter 'type' is required (e.g. restaurant, cafe, gas_station)" });
  }
  res.json(await searchNearbyPlaces({
    type,
    latitude: latitude ? parseFloat(latitude) : undefined,
    longitude: longitude ? parseFloat(longitude) : undefined,
    radius: radius ? parseInt(radius) : undefined,
    limit: limit ? parseInt(limit) : undefined,
  }));
});
// ─── Places — Text Search (Google Places API New) ──────────────────
router.get("/places/search", async (req, res) => {
  const { q, latitude, longitude, radius, limit } = req.query;
  if (!q) {
    return res
      .status(400)
      .json({ error: "Query parameter 'q' is required" });
  }
  res.json(await searchPlacesByText({
    query: q,
    latitude: latitude ? parseFloat(latitude) : undefined,
    longitude: longitude ? parseFloat(longitude) : undefined,
    radius: radius ? parseInt(radius) : undefined,
    limit: limit ? parseInt(limit) : undefined,
  }));
});
// ─── Map Generation ───────────────────────────────────────────────
/**
 * In-memory map marker store — avoids multi-kb query-param URLs.
 * Maps are keyed by short UUID, expire after 1h.
 */
const mapStore = new EphemeralStore();
function storeMarkers(markerList) {
  return mapStore.set({ markers: markerList });
}
/**
 * Build the interactive embed HTML for Google Maps JS API.
 * Renders numbered markers with info windows showing name + address.
 */
function buildMapEmbedHtml(markerList, apiKey, { zoom, maptype = "roadmap" } = {}) {
  const markersJson = JSON.stringify(
    markerList.map((m, i) => ({
      lat: m.latitude,
      lng: m.longitude,
      label: String(i + 1),
      name: m.name || m.label || `Location ${i + 1}`,
      address: m.address || m.shortAddress || "",
    })),
  );
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body,#map{width:100%;height:100%}
</style>
</head><body>
<div id="map"></div>
<script>
const MARKERS=${markersJson};
const ZOOM=${zoom != null ? zoom : "null"};
const MAPTYPE="${maptype}";
function initMap(){
  const bounds=new google.maps.LatLngBounds();
  const map=new google.maps.Map(document.getElementById("map"),{
    mapTypeId:MAPTYPE,
    disableDefaultUI:false,
    zoomControl:true,
    mapTypeControl:false,
    streetViewControl:false,
    fullscreenControl:false,
    styles:[
      {featureType:"poi",stylers:[{visibility:"off"}]},
      {featureType:"transit",stylers:[{visibility:"off"}]}
    ]
  });
  const COLORS=["#e74c3c","#3498db","#2ecc71","#9b59b6","#e67e22","#f1c40f","#1abc9c","#e91e63","#00bcd4","#ff5722"];
  const infoWindow=new google.maps.InfoWindow();
  MARKERS.forEach((m,i)=>{
    const pos={lat:m.lat,lng:m.lng};
    bounds.extend(pos);
    const marker=new google.maps.Marker({
      position:pos,
      map,
      label:{text:m.label,color:"#fff",fontWeight:"700",fontSize:"12px"},
      icon:{
        path:google.maps.SymbolPath.CIRCLE,
        scale:14,
        fillColor:COLORS[i%COLORS.length],
        fillOpacity:1,
        strokeColor:"#fff",
        strokeWeight:2
      },
      title:m.name
    });
    marker.addListener("click",()=>{
      infoWindow.setContent(
        '<div style="font-family:system-ui;min-width:140px;padding:2px">'+
        '<strong style="font-size:13px">'+m.name+'</strong>'+
        (m.address?'<div style="font-size:11px;color:#666;margin-top:3px">'+m.address+'</div>':'')+
        '</div>'
      );
      infoWindow.open(map,marker);
    });
  });
  if(ZOOM!=null){
    map.setCenter(bounds.getCenter());
    map.setZoom(ZOOM);
  }else{
    map.fitBounds(bounds,{top:30,right:30,bottom:30,left:30});
  }
}
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap" async defer></script>
</body></html>`;
}
router.get("/map/embed", (req, res) => {
  const { id, markers, zoom, maptype } = req.query;
  if (!CONFIG.GOOGLE_API_KEY) {
    return res.status(400).send("Missing API key");
  }
  let markerList;
  // Resolve by stored ID (short URL) or inline JSON (backward compat)
  if (id) {
    const entry = mapStore.get(id);
    if (!entry) return res.status(404).send("Map not found or expired");
    markerList = entry.markers;
  } else if (markers) {
    try {
      markerList = JSON.parse(markers);
    } catch {
      return res.status(400).send("Invalid markers JSON");
    }
  } else {
    return res.status(400).send("Missing 'id' or 'markers' parameter");
  }
  if (!Array.isArray(markerList) || markerList.length === 0) {
    return res.status(400).send("markers must be a non-empty array");
  }
  const html = buildMapEmbedHtml(markerList, CONFIG.GOOGLE_API_KEY, {
    zoom: zoom ? parseInt(zoom) : undefined,
    maptype: maptype || "roadmap",
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
router.get("/map", async (req, res) => {
  const { markers, zoom, maptype } = req.query;
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
    // Store markers and build a short embed URL
    const mapId = storeMarkers(markerList);
    const embedParams = new URLSearchParams({ id: mapId });
    if (zoom) embedParams.set("zoom", zoom);
    if (maptype) embedParams.set("maptype", maptype);
    const mapEmbedUrl = buildLocalUrl("utility/map/embed", Object.fromEntries(embedParams));
    res.json({
      mapEmbedUrl,
      markerCount: markerList.length,
    });
  } catch (err) {
    res.status(502).json({ error: `Map generation failed: ${err.message}` });
  }
});
// ─── Webcams ───────────────────────────────────────────────────────
router.get("/webcams", asyncHandler(
  async (req) => {
    const { city, limit } = req.query;
    const webcams = await getPublicWebcams({ 
      city: city || "vancouver", 
      limit: parseInt(limit, 10) || 100 
    });
    return { count: webcams.length, webcams };
  },
  "Webcams fetch"
));
// ─── Airports ──────────────────────────────────────────────────────
router.get("/airports/search", (req, res) => {
  const { q, limit, country } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(searchAirports(q, {
    limit: parseInt(limit) || 10,
    country,
  }));
});
router.get("/airports/code/:code", (req, res) => {
  const result = getAirportByCode(req.params.code);
  if (!result) {
    return res.status(404).json({ error: `Airport not found: ${req.params.code}` });
  }
  res.json(result);
});
router.get("/airports/country/:code", asyncHandler(
  (req) => getAirportsByCountry(req.params.code, {
    limit: parseInt(req.query.limit) || 50,
  }),
  "Country airports lookup",
  500,
));
router.get("/airports/nearest", (req, res) => {
  const { lat, lng, limit } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: "Query parameters 'lat' and 'lng' are required" });
  }
  res.json(getNearestAirports(
    parseFloat(lat),
    parseFloat(lng),
    { limit: parseInt(limit) || 5 },
  ));
});
// ─── Python Code Interpreter ───────────────────────────────────────
router.post("/python/execute", async (req, res) => {
  const { code, timeout } = req.body;
  if (!code || typeof code !== "string") {
    return res
      .status(400)
      .json({ error: "Request body must include 'code' (string)" });
  }
  const lengthErr = validateMaxLength(code, MAX_CODE_LENGTH, "Code");
  if (lengthErr) {
    return res.status(400).json({ error: lengthErr });
  }
  const result = await executePython(code, {
    timeout: timeout ? Math.min(Math.max(parseInt(timeout), 1000), 60_000) : undefined,
  });
  res.json(result);
});
router.get("/python/info", asyncHandler(
  () => getInterpreterInfo(),
  "Python interpreter info",
));
// ── Python Streaming (SSE) ────────────────────────────────────
router.post("/python/stream", async (req, res) => {
  const { code, timeout } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Request body must include 'code' (string)" });
  }
  const lengthErr = validateMaxLength(code, MAX_CODE_LENGTH, "Code");
  if (lengthErr) return res.status(400).json({ error: lengthErr });
  const send = setupStreamingSSE(res);
  send({ event: "start", language: "python" });
  const result = await executePythonStreaming(code, {
    timeout: timeout ? Math.min(Math.max(parseInt(timeout), 1000), 60_000) : undefined,
    onChunk: (event, data) => send({ event, data }),
  });
  send({ event: "exit", exitCode: result.exitCode, executionTimeMs: result.executionTimeMs, success: result.success, timedOut: result.timedOut, error: result.error || undefined });
  res.end();
});
// ─── Chart Generation ──────────────────────────────────────────────
const VALID_CHART_TYPES = ["bar", "line", "pie"];
router.post("/chart", (req, res) => {
  const { type, title, labels, datasets } = req.body;
  if (!type || !VALID_CHART_TYPES.includes(type)) {
    return res.status(400).json({
      error: `'type' is required and must be one of: ${VALID_CHART_TYPES.join(", ")}`,
    });
  }
  if (!labels || !Array.isArray(labels) || labels.length === 0) {
    return res.status(400).json({
      error: "'labels' is required (non-empty array of category/axis labels)",
    });
  }
  if (!datasets || !Array.isArray(datasets) || datasets.length === 0) {
    return res.status(400).json({
      error: "'datasets' is required (non-empty array of { label, data } objects)",
    });
  }
  // Validate each dataset has a data array matching labels length
  for (const ds of datasets) {
    if (!ds.data || !Array.isArray(ds.data)) {
      return res.status(400).json({
        error: "Each dataset must have a 'data' array of numeric values",
      });
    }
  }
  const chartConfig = {
    type,
    title: title || "",
    labels,
    datasets,
    options: req.body.options || {},
  };
  const chartId = storeChart(chartConfig);
  const chartImageUrl = buildLocalUrl("utility/chart/render", { id: chartId });
  res.json({
    chartImageUrl,
    chartId,
    type,
    labelCount: labels.length,
    datasetCount: datasets.length,
  });
});
router.get("/chart/render", async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).send("Missing 'id' parameter");
  }
  const chartConfig = getStoredChart(id);
  if (!chartConfig) {
    return res.status(404).send("Chart not found or expired");
  }
  try {
    const pngBuffer = await renderChartPng(chartConfig);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(pngBuffer);
  } catch (err) {
    res.status(500).json({ error: `Chart render failed: ${err.message}` });
  }
});
// ─── Page Metadata Scraper (Crawlee) ───────────────────────────────
router.get("/scrape/metadata", asyncHandler(
  async (req) => {
    const { url } = req.query;
    if (!url) {
      throw Object.assign(new Error("Query parameter 'url' is required"), { status: 400 });
    }
    const result = await crawlSingleStatic(url, {
      extractFn: ($) => {
        const meta = {};
        // Title
        meta.title =
          $('meta[property="og:title"]').attr("content") ||
          $('meta[name="twitter:title"]').attr("content") ||
          $("title").first().text().trim() ||
          null;
        // Description
        meta.description =
          $('meta[property="og:description"]').attr("content") ||
          $('meta[name="description"]').attr("content") ||
          $('meta[name="twitter:description"]').attr("content") ||
          null;
        // Image
        meta.image =
          $('meta[property="og:image"]').attr("content") ||
          $('meta[name="twitter:image"]').attr("content") ||
          $('meta[itemprop="contentUrl"]').attr("content") ||
          null;
        // Video
        meta.video =
          $('meta[property="og:video"]').attr("content") ||
          $('meta[property="og:video:url"]').attr("content") ||
          null;
        // Keywords
        const keywords =
          $('meta[name="keywords"]').attr("content") ||
          $('meta[itemprop="keywords"]').attr("content") ||
          null;
        meta.keywords = keywords
          ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
          : null;
        // Site name
        meta.siteName =
          $('meta[property="og:site_name"]').attr("content") || null;
        // Canonical URL
        meta.canonicalUrl =
          $('link[rel="canonical"]').attr("href") ||
          $('meta[property="og:url"]').attr("content") ||
          null;
        // Strip null values
        for (const key of Object.keys(meta)) {
          if (meta[key] === null || meta[key] === "") delete meta[key];
        }
        return meta;
      },
    });
    if (result.error) {
      throw Object.assign(new Error(result.error), { status: 502 });
    }
    return { url, ...result.data };
  },
  "Page metadata scrape",
));
// ─── Health ────────────────────────────────────────────────────────
export function getUtilityHealth() {
  return {
    calculator: "on-demand (bignumber.js)",
    currency: "on-demand",
    timezone: "on-demand",
    ipinfo: "on-demand",
    places: "on-demand",
    webcams: "on-demand",
    airports: "on-demand (in-memory, ~4,555 airports)",
    pythonInterpreter: "on-demand (sandboxed subprocess)",
    chart: "on-demand (Chart.js embed)",
    scraper: "on-demand (Crawlee + Cheerio)",
  };
}
// ── Unified Airport Lookup Dispatcher ──────────────────────────────
router.get("/airports/lookup", async (req, res) => {
  const { action, q, code, country, lat, lng, limit } = req.query;
  if (!action) return res.status(400).json({ error: "'action' is required", actions: ["search", "code", "country", "nearest"] });
  switch (action) {
    case "search":
      req.url = `/airports/search?q=${q || ""}&limit=${limit || 10}&country=${country || ""}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "code":
      req.url = `/airports/code/${code || ""}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "country":
      req.url = `/airports/country/${code || country || ""}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    case "nearest":
      req.url = `/airports/nearest?lat=${lat || 0}&lng=${lng || 0}&limit=${limit || 10}`;
      return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
    default:
      return res.status(400).json({ error: `Unknown action: ${action}`, actions: ["search", "code", "country", "nearest"] });
  }
});
export default router;
