import {
  asyncHandler,
  setupStreamingServerSentEvents,
} from "@rodrigo-barraza/utilities-library/express";
import { validateMaxLength, MILLISECONDS_PER_HOUR } from "@rodrigo-barraza/utilities-library";
import { type Request, type Response, Router } from "express";
import BigNumber from "bignumber.js";
import CONFIG from "../config.ts";
import {
  convertCurrency,
  listCurrencies,
} from "../fetchers/utility/CurrencyFetcher.ts";
import {
  getTimeInTimezone,
  listTimezones,
} from "../fetchers/utility/TimezoneFetcher.ts";
import { lookupIp, batchLookupIps } from "../fetchers/utility/IpInfoFetcher.ts";
import {
  searchNearbyPlaces,
  searchPlacesByText,
} from "../fetchers/utility/PlacesFetcher.ts";
import {
  searchAirports,
  getAirportByCode,
  getAirportsByCountry,
  getNearestAirports,
} from "../fetchers/utility/AirportFetcher.ts";
import { getPublicWebcams } from "../fetchers/utility/WebcamFetcher.ts";
import {
  executePython,
  executePythonStreaming,
  getInterpreterInfo,
  normalizeInputFileSources,
  type PythonExecutionResult,
} from "../services/PythonInterpreterService.ts";
import {
  storeChart,
  storeChartWithId,
  getStoredChart,
  renderChartPng,
  validateChartData,
  VALID_CHART_TYPES,
} from "../services/ChartService.ts";
import { MAX_CODE_LENGTH } from "../constants.ts";
import {
  buildDisplay,
  buildCodeDisplay,
  buildLocalUrl,
  errorMessage,
} from "../utilities.ts";
import { PersistentStore } from "../models/EmbedAsset.ts";
import MinioService from "../services/MinioService.ts";
import { crawlSingleStatic } from "../services/CrawlerService.ts";

interface MapMarker {
  latitude: number;
  longitude: number;
  name?: string;
  label?: string;
  address?: string;
  shortAddress?: string;
}

const router: ReturnType<typeof Router> = Router();
const dispatchToRoute = router as unknown as (request: Request, response: Response, fallback: () => void) => void;
// ─── Calculator (BigNumber) ────────────────────────────────────────
router.get("/calculate", (req: Request, res: Response) => {
  const operation = req.query.operation as string | undefined;
  const firstOperand = req.query['a'] as string | undefined;
  const secondOperand = req.query['b'] as string | undefined;
  if (!operation || !firstOperand) {
    return res
      .status(400)
      .json({ error: "Query parameters 'operation' and 'a' are required" });
  }
  try {
    const operandA = new BigNumber(firstOperand);
    let operandB: BigNumber | undefined;
    if (secondOperand !== undefined && secondOperand !== "") {
      operandB = new BigNumber(secondOperand);
    }
    let result: BigNumber;
    switch (operation) {
      case "add":
        if (operandB === undefined) throw new Error("'b' is required for add");
        result = operandA.plus(operandB);
        break;
      case "subtract":
        if (operandB === undefined) throw new Error("'b' is required for subtract");
        result = operandA.minus(operandB);
        break;
      case "multiply":
        if (operandB === undefined) throw new Error("'b' is required for multiply");
        result = operandA.multipliedBy(operandB);
        break;
      case "divide":
        if (operandB === undefined) throw new Error("'b' is required for divide");
        result = operandA.dividedBy(operandB);
        break;
      case "modulo":
        if (operandB === undefined) throw new Error("'b' is required for modulo");
        result = operandA.modulo(operandB);
        break;
      case "power":
        if (operandB === undefined) throw new Error("'b' is required for power");
        result = operandA.exponentiatedBy(operandB);
        break;
      case "sqrt":
        result = operandA.squareRoot();
        break;
      default:
        return res
          .status(400)
          .json({ error: `Unsupported operation: ${operation}` });
    }
    if (result.isNaN()) {
      return res.status(400).json({ error: "Result is Not-a-Number (NaN)" });
    }
    res.json({
      operation,
      firstOperand,
      b: secondOperand || null,
      result: result.toFixed(),
    });
  } catch (error: unknown) {
    res
      .status(400)
      .json({ error: `Calculation failed: ${errorMessage(error)}` });
  }
});
// ─── Currency Conversion ───────────────────────────────────────────
router.get(
  "/currency/convert",
  asyncHandler(async (req: Request, res: Response) => {
    const { amount, from, to } = req.query as Record<
      string,
      string | undefined
    >;
    if (!from || !to) {
      return res
        .status(400)
        .json({ error: "Query parameters 'from' and 'to' are required" });
    }
    res.json(await convertCurrency(parseFloat(amount || "") || 1, from, to));
  }),
);
router.get(
  "/currency/list",
  asyncHandler(async () => {
    const currencies = await listCurrencies();
    return { count: currencies.length, currencies };
  }, "Currency list"),
);
// ─── Timezone ──────────────────────────────────────────────────────
router.get(
  "/timezone/:area/:location",
  asyncHandler(
    (req: Request) =>
      getTimeInTimezone(
        `${req.params.area as string}/${req.params.location as string}`,
      ),
    "Timezone lookup",
  ),
);
router.get(
  "/timezone/list",
  asyncHandler(async (req: Request) => {
    const timezones = await listTimezones(req.query.area as string);
    return {
      count: Array.isArray(timezones) ? timezones.length : 0,
      timezones,
    };
  }, "Timezone list"),
);
// ─── IP Geolocation (IPinfo) ───────────────────────────────────────
router.get(
  "/ip/batch",
  asyncHandler(async (req: Request, res: Response) => {
    const ips = req.query.ips as string;
    if (!ips) {
      return res
        .status(400)
        .json({ error: "Query parameter 'ips' (comma-separated) is required" });
    }
    const ipArray = ips
      .split(",")
      .map((ip: string) => ip.trim())
      .filter(Boolean);
    const result = await batchLookupIps(ipArray);
    res.json({ count: result.length, results: result });
  }),
);
router.get(
  "/ip",
  asyncHandler(async () => lookupIp(""), "IP lookup"),
);
router.get(
  "/ip/:ip",
  asyncHandler((req: Request) => {
    const raw = req.params.ip as string;
    const clientIp = raw === "self" || raw === ":ip" ? "" : raw;
    return lookupIp(clientIp);
  }, "IP lookup"),
);
// ─── Places — Nearby Search (Google Places API New) ────────────────
router.get(
  "/places/nearby",
  asyncHandler(async (req: Request, res: Response) => {
    const { type, latitude, longitude, radius, limit } = req.query as Record<
      string,
      string | undefined
    >;
    if (!type) {
      return res
        .status(400)
        .json({
          error:
            "Query parameter 'type' is required (e.g. restaurant, cafe, gas_station)",
        });
    }
    res.json(
      await searchNearbyPlaces({
        type,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        radius: radius ? parseInt(radius) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      }),
    );
  }),
);
// ─── Places — Text Search (Google Places API New) ──────────────────
router.get(
  "/places/search",
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query['q'] as string | undefined;
    const latitude = req.query.latitude as string | undefined;
    const longitude = req.query.longitude as string | undefined;
    const radius = req.query.radius as string | undefined;
    const limit = req.query.limit as string | undefined;
    if (!query) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    res.json(
      await searchPlacesByText({
        query: query,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        radius: radius ? parseInt(radius) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      }),
    );
  }),
);
// ─── Map Generation ───────────────────────────────────────────────
/**
 * In-memory map marker store — avoids multi-kb query-param URLs.
 * Maps are keyed by short UUID, expire after 1h.
 */
const mapStore = new PersistentStore<{ markers: MapMarker[] }>("map");
function storeMarkers(markerList: MapMarker[]) {
  return mapStore.set({ markers: markerList });
}
/**
 * Build the interactive embed HTML for Google Maps JS API.
 * Renders numbered markers with info windows showing name + address.
 */
function buildMapEmbedHtml(
  markerList: MapMarker[],
  apiKey: string,
  { zoom, maptype = "roadmap" }: Record<string, unknown> = {},
) {
  const markersJson = JSON.stringify(
    markerList.map((marker: MapMarker, i: number) => ({
      lat: marker.latitude,
      lng: marker.longitude,
      label: String(i + 1),
      name: marker.name || marker.label || `Location ${i + 1}`,
      address: marker.address || marker.shortAddress || "",
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
  MARKERS.forEach((marker,index)=>{
    const pos={lat:marker.lat,lng:marker.lng};
    bounds.extend(pos);
    const googleMarker=new google.maps.Marker({
      position:pos,
      map,
      label:{text:marker.label,color:"#fff",fontWeight:"700",fontSize:"12px"},
      icon:{
        path:google.maps.SymbolPath.CIRCLE,
        scale:14,
        fillColor:COLORS[index%COLORS.length],
        fillOpacity:1,
        strokeColor:"#fff",
        strokeWeight:2
      },
      title:marker.name
    });
    googleMarker.addListener("click",()=>{
      infoWindow.setContent(
        '<div style="font-family:system-ui;min-width:140px;padding:2px">'+
        '<strong style="font-size:13px">'+marker.name+'</strong>'+
        (marker.address?'<div style="font-size:11px;color:#666;margin-top:3px">'+marker.address+'</div>':'')+
        '</div>'
      );
      infoWindow.open(map,googleMarker);
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
router.get("/map/embed", asyncHandler(async (req: Request, res: Response) => {
  const { id, markers, zoom, maptype } = req.query as Record<
    string,
    string | undefined
  >;
  if (!CONFIG.GOOGLE_CLOUD_API_KEY) {
    return res.status(400).send("Missing API key");
  }
  let markerList: MapMarker[];
  if (id) {
    const entry = await mapStore.getWithFallback(id);
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
  const html = buildMapEmbedHtml(markerList, CONFIG.GOOGLE_CLOUD_API_KEY, {
    zoom: zoom ? parseInt(zoom) : undefined,
    maptype: maptype || "roadmap",
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}));
const MAX_MAP_MARKERS = 500;
router.get(
  "/map",
  asyncHandler(async (req: Request, res: Response) => {
    const { markers, zoom, maptype, mapId } = req.query as Record<
      string,
      string | undefined
    >;
    if (!markers) {
      return res
        .status(400)
        .json({
          error:
            "Query parameter 'markers' is required (JSON array of {latitude, longitude, label?})",
        });
    }
    try {
      let markerList: MapMarker[];
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

      // Iterative mode: append new markers to a previously created map.
      let existing: { markers: MapMarker[] } | null = null;
      if (mapId !== undefined && mapId !== "") {
        if (mapId === "null" || mapId === "undefined") {
          return res.status(400).json({
            error:
              `Invalid mapId (got: ${JSON.stringify(mapId)}). Pass the exact mapId string ` +
              `returned by a previous call, or omit it to create a new map.`,
          });
        }
        existing = await mapStore.getWithFallback(mapId);
        if (!existing) {
          return res.status(400).json({
            error:
              `Map '${mapId}' not found or expired. Omit mapId and resend all markers to ` +
              `create a new map — the response returns a mapId you can pass back to add more.`,
          });
        }
      }

      const allMarkers = existing
        ? [...existing.markers, ...markerList]
        : markerList;
      if (allMarkers.length > MAX_MAP_MARKERS) {
        return res.status(400).json({
          error: `Map would have ${allMarkers.length} markers (max ${MAX_MAP_MARKERS}).`,
        });
      }

      // Store markers and build a short embed URL
      let activeMapId: string;
      if (existing && mapId) {
        activeMapId = mapId;
        mapStore.setWithId(activeMapId, { markers: allMarkers });
      } else {
        activeMapId = storeMarkers(allMarkers);
      }
      const embedParams = new URLSearchParams({ id: activeMapId });
      if (zoom) embedParams.set("zoom", zoom);
      if (maptype) embedParams.set("maptype", maptype);
      const mapEmbedUrl = buildLocalUrl(
        "utility/map/embed",
        Object.fromEntries(embedParams),
      );
      res.json({
        message:
          `Map ${existing ? "extended" : "created"}: ${allMarkers.length} marker(s). The ` +
          `user can see this version now. To add more markers, call again with mapId ` +
          `'${activeMapId}' and only the new markers.`,
        mapEmbedUrl,
        display: buildDisplay("embed", mapEmbedUrl, { height: 360, title: "Map" }),
        mapId: activeMapId,
        markerCount: allMarkers.length,
        newMarkerCount: markerList.length,
      });
    } catch (error: unknown) {
      res
        .status(502)
        .json({ error: `Map generation failed: ${errorMessage(error)}` });
    }
  }),
);
// ─── Webcams ───────────────────────────────────────────────────────
router.get(
  "/webcams",
  asyncHandler(async (req: Request) => {
    const { city, state, province, region, country, limit } = req.query as Record<string, string | undefined>;
    const webcams = await getPublicWebcams({
      city,
      state,
      province,
      region,
      country,
      limit: parseInt(limit || "", 10) || 100,
    });
    return { count: webcams.length, webcams };
  }, "Webcams fetch"),
);
// ─── Airports ──────────────────────────────────────────────────────
router.get("/airports/search", (req: Request, res: Response) => {
  const query = req.query['q'] as string | undefined;
  const limit = req.query.limit as string | undefined;
  const country = req.query.country as string | undefined;
  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  res.json(
    searchAirports(query, {
      limit: parseInt(limit || "") || 10,
      country,
    }),
  );
});
router.get("/airports/code/:code", (req: Request, res: Response) => {
  const result = getAirportByCode(req.params.code as string);
  if (!result) {
    return res
      .status(404)
      .json({ error: `Airport not found: ${req.params.code as string}` });
  }
  res.json(result);
});
router.get(
  "/airports/country/:code",
  asyncHandler(
    async (req: Request) =>
      getAirportsByCountry(req.params.code as string, {
        limit: parseInt(req.query.limit as string) || 50,
      }),
    "Country airports lookup",
    500,
  ),
);
router.get("/airports/nearest", (req: Request, res: Response) => {
  const { lat, lng, limit } = req.query as Record<string, string | undefined>;
  if (!lat || !lng) {
    return res
      .status(400)
      .json({ error: "Query parameters 'lat' and 'lng' are required" });
  }
  res.json(
    getNearestAirports(parseFloat(lat), parseFloat(lng), {
      limit: parseInt(limit || "") || 5,
    }),
  );
});
// ─── Python Code Interpreter ───────────────────────────────────────
// Rich results (auto-captured matplotlib figures → image display) follow the
// Jupyter/e2b code-interpreter result model: https://github.com/e2b-dev/code-interpreter
const pythonFigureStore = new PersistentStore<{ mimeType: string; base64: string }>(
  "python-figure",
  MILLISECONDS_PER_HOUR,
);

interface PublishedPythonFigure {
  filename: string;
  url: string;
  bytes: number;
}

/**
 * Upload captured figures to MinIO (falling back to the persistent store +
 * local render endpoint) and return URL-bearing entries — base64 never
 * reaches the LLM context.
 */
async function publishPythonFigures(
  result: PythonExecutionResult,
): Promise<PublishedPythonFigure[]> {
  const published: PublishedPythonFigure[] = [];
  for (const figure of result.figures ?? []) {
    const buffer = Buffer.from(figure.data, "base64");
    let url = await MinioService.uploadToolAsset(buffer, figure.mimeType);
    if (!url) {
      const id = pythonFigureStore.set({
        mimeType: figure.mimeType,
        base64: figure.data,
      });
      url = buildLocalUrl("utility/python/figure", { id });
    }
    published.push({ filename: figure.filename, url, bytes: figure.bytes });
  }
  return published;
}

function buildPythonFigurePayload(
  result: PythonExecutionResult,
  figures: PublishedPythonFigure[],
) {
  if (figures.length === 0) return {};
  const total = result.totalFigureFiles ?? figures.length;
  return {
    figures,
    display: buildDisplay("image", figures[0].url, { title: "Python figure" }),
    message:
      `${figures.length} figure(s) captured — the user can see the first one now.` +
      (figures.length > 1
        ? " Reference the other figure URLs in your reply to show them."
        : "") +
      (total > figures.length
        ? ` (${total - figures.length} more image file(s) exceeded the figure cap and were dropped.)`
        : ""),
  };
}

router.post(
  "/python/execute",
  asyncHandler(async (req: Request, res: Response) => {
    const { code, timeout, inputFiles } = req.body;
    if (!code || typeof code !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'code' (string)" });
    }
    const lengthError = validateMaxLength(code, MAX_CODE_LENGTH, "Code");
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }
    // Normalize + sentinel-check input files up front (routes return 400
    // for the unresolved "attached" sentinel, per AttachedMediaSentinel).
    const normalizedInputs = normalizeInputFileSources(inputFiles);
    if ("error" in normalizedInputs) {
      return res.status(400).json({ error: normalizedInputs.error });
    }
    const result = await executePython(code, {
      timeout: timeout
        ? Math.min(Math.max(parseInt(timeout), 1000), 60_000)
        : undefined,
      inputFiles: normalizedInputs.sources,
    });
    const published = await publishPythonFigures(result);
    const { figures: _rawFigures, totalFigureFiles: _total, ...textResult } = result;
    // Figure display (image) wins when present; otherwise surface stdout
    // as a whitespace-exact code block.
    res.json({
      ...textResult,
      ...(published.length === 0 &&
        result.stdout && {
          display: buildCodeDisplay("stdout", {
            language: "text",
            title: "stdout",
          }),
        }),
      ...buildPythonFigurePayload(result, published),
    });
  }),
);
// Fallback figure host for when MinIO is not configured (local dev)
router.get(
  "/python/figure",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.query as Record<string, string | undefined>;
    if (!id) {
      return res.status(400).send("Missing 'id' parameter");
    }
    const stored = await pythonFigureStore.getWithFallback(id);
    if (!stored) {
      return res.status(404).send("Figure not found or expired");
    }
    res.setHeader("Content-Type", stored.mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(stored.base64, "base64"));
  }),
);
router.get(
  "/python/info",
  asyncHandler(async () => getInterpreterInfo(), "Python interpreter info"),
);
// ── Python Streaming (SSE) ────────────────────────────────────
router.post(
  "/python/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const { code, timeout, inputFiles } = req.body;
    if (!code || typeof code !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'code' (string)" });
    }
    const lengthError = validateMaxLength(code, MAX_CODE_LENGTH, "Code");
    if (lengthError) return res.status(400).json({ error: lengthError });
    const normalizedInputs = normalizeInputFileSources(inputFiles);
    if ("error" in normalizedInputs) {
      return res.status(400).json({ error: normalizedInputs.error });
    }
    const send = setupStreamingServerSentEvents(res);
    send({ event: "start", language: "python" });
    const result = await executePythonStreaming(code, {
      timeout: timeout
        ? Math.min(Math.max(parseInt(timeout), 1000), 60_000)
        : undefined,
      inputFiles: normalizedInputs.sources,
      onChunk: (event: string, data: string) => send({ event, data }),
    });
    const published = await publishPythonFigures(result);
    send({
      event: "exit",
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
      success: result.success,
      timedOut: result.timedOut,
      error: result.error || undefined,
      ...(result.inputFiles && { inputFiles: result.inputFiles }),
      ...buildPythonFigurePayload(result, published),
    });
    res.end();
  }),
);
// ─── Chart Generation (ECharts SSR) ────────────────────────────────
router.post("/chart", asyncHandler(async (req: Request, res: Response) => {
  const { type, title, labels, datasets, chartId } = req.body;

  // Iterative mode: load the existing chart and merge changes into it.
  let existing: import("../types/chart.ts").ChartConfig | null = null;
  if (chartId !== undefined && chartId !== null && chartId !== "") {
    if (typeof chartId !== "string" || chartId === "null" || chartId === "undefined") {
      return res.status(400).json({
        error:
          `Invalid chartId (got: ${JSON.stringify(chartId)}). Pass the exact chartId string ` +
          `returned by a previous call, or omit it to create a new chart.`,
      });
    }
    existing = await getStoredChart(chartId);
    if (!existing) {
      return res.status(400).json({
        error:
          `Chart '${chartId}' not found or expired. Omit chartId and resend the complete ` +
          `chart (type, labels, datasets) to create a new one — the response returns a ` +
          `chartId you can pass back to add or update datasets.`,
      });
    }
  }

  const effectiveType = type || existing?.type;
  if (!effectiveType || !VALID_CHART_TYPES.includes(effectiveType)) {
    return res.status(400).json({
      error: `'type' is required and must be one of: ${VALID_CHART_TYPES.join(", ")}`,
    });
  }
  // Scatter plots data numeric [x, y] pairs — category labels are unused
  const rawLabels = labels ?? existing?.labels;
  const effectiveLabels: string[] = Array.isArray(rawLabels) ? rawLabels : [];
  if (effectiveType !== "scatter" && effectiveLabels.length === 0) {
    return res.status(400).json({
      error: "'labels' is required (non-empty array of category/axis labels)",
    });
  }
  if (effectiveLabels.length > 1000) {
    return res.status(400).json({
      error: `Maximum 1000 labels allowed (got ${effectiveLabels.length}). Reduce your data points for chart rendering.`,
    });
  }
  if (!existing && (!datasets || !Array.isArray(datasets) || datasets.length === 0)) {
    return res.status(400).json({
      error:
        "'datasets' is required (non-empty array of { label, data } objects)",
    });
  }
  if (datasets !== undefined && (!Array.isArray(datasets) || datasets.length === 0)) {
    return res.status(400).json({
      error: "'datasets' must be a non-empty array of { label, data } objects when provided",
    });
  }
  const newDatasets = datasets || [];
  for (let datasetIndex = 0; datasetIndex < newDatasets.length; datasetIndex++) {
    const dataset = newDatasets[datasetIndex];
    if (!dataset.data || !Array.isArray(dataset.data)) {
      return res.status(400).json({
        error: `Dataset at index ${datasetIndex} must have a 'data' array of numeric values`,
      });
    }
    if (!dataset.label || typeof dataset.label !== "string") {
      return res.status(400).json({
        error: `Dataset at index ${datasetIndex} must have a 'label' string (used for the chart legend)`,
      });
    }
  }

  // Merge datasets by label: an incoming dataset replaces the existing one
  // with the same label; unseen labels are appended as new series.
  let mergedDatasets: import("../types/chart.ts").ChartDataset[];
  if (existing) {
    mergedDatasets = [...existing.datasets];
    for (const dataset of newDatasets) {
      const matchIndex = mergedDatasets.findIndex(
        (candidate) => candidate.label === dataset.label,
      );
      if (matchIndex !== -1) mergedDatasets[matchIndex] = dataset;
      else mergedDatasets.push(dataset);
    }
  } else {
    mergedDatasets = newDatasets;
  }

  const shapeError = validateChartData(effectiveType, effectiveLabels, mergedDatasets);
  if (shapeError) {
    return res.status(400).json({ error: shapeError });
  }

  const chartConfig = {
    type: effectiveType,
    title: title !== undefined ? title : existing?.title || "",
    labels: effectiveLabels,
    datasets: mergedDatasets,
    options: req.body.options || existing?.options || {},
  };

  // Render PNG eagerly and attempt MinIO upload for permanent URL
  const pngBuffer = await renderChartPng(chartConfig);
  const minioUrl = await MinioService.uploadToolAsset(pngBuffer, "image/png");

  // Store config under a stable id so later calls can build on this chart
  // (also serves the legacy render endpoint as a MinIO fallback)
  let activeChartId: string;
  if (existing && typeof chartId === "string") {
    activeChartId = chartId;
    storeChartWithId(activeChartId, chartConfig);
  } else {
    activeChartId = storeChart(chartConfig);
  }
  const chartImageUrl = minioUrl || buildLocalUrl("utility/chart/render", { id: activeChartId });

  res.json({
    message:
      `Chart ${existing ? "updated" : "created"}: ${mergedDatasets.length} dataset(s), ` +
      `${effectiveLabels.length} label(s). The user can see this version now. To build on ` +
      `it, call again with chartId '${activeChartId}' — datasets merge by label (same ` +
      `label replaces that series, new labels add series); type/title/labels/options ` +
      `update when provided and are otherwise kept.`,
    chartImageUrl,
    display: buildDisplay("image", chartImageUrl, { title: "Chart" }),
    chartId: activeChartId,
    type: effectiveType,
    labelCount: effectiveLabels.length,
    datasetCount: mergedDatasets.length,
  });
}));
router.get(
  "/chart/render",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.query as Record<string, string | undefined>;
    if (!id) {
      return res.status(400).send("Missing 'id' parameter");
    }
    const chartConfig = await getStoredChart(id);
    if (!chartConfig) {
      return res.status(404).send("Chart not found or expired");
    }
    try {
      const pngBuffer = await renderChartPng(chartConfig);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(pngBuffer);
    } catch (error: unknown) {
      res
        .status(500)
        .json({ error: `Chart render failed: ${errorMessage(error)}` });
    }
  }),
);
// ─── Page Metadata Scraper (Crawlee) ───────────────────────────────
router.get(
  "/scrape/metadata",
  asyncHandler(async (req: Request) => {
    const { url } = req.query as Record<string, string | undefined>;
    if (!url) {
      throw Object.assign(new Error("Query parameter 'url' is required"), {
        status: 400,
      });
    }
    const result = await crawlSingleStatic(url, {
      extractFunction: (context) => {
        const CHEERIOAPI = context.$;
        const meta: Record<string, unknown> = {};
        // Title
        meta.title =
          CHEERIOAPI('meta[property="og:title"]').attr("content") ||
          CHEERIOAPI('meta[name="twitter:title"]').attr("content") ||
          CHEERIOAPI("title").first().text().trim() ||
          null;
        // Description
        meta.description =
          CHEERIOAPI('meta[property="og:description"]').attr("content") ||
          CHEERIOAPI('meta[name="description"]').attr("content") ||
          CHEERIOAPI('meta[name="twitter:description"]').attr("content") ||
          null;
        // Image
        meta.image =
          CHEERIOAPI('meta[property="og:image"]').attr("content") ||
          CHEERIOAPI('meta[name="twitter:image"]').attr("content") ||
          CHEERIOAPI('meta[itemprop="contentUrl"]').attr("content") ||
          null;
        // Video
        meta.video =
          CHEERIOAPI('meta[property="og:video"]').attr("content") ||
          CHEERIOAPI('meta[property="og:video:url"]').attr("content") ||
          null;
        // Keywords
        const keywords =
          CHEERIOAPI('meta[name="keywords"]').attr("content") ||
          CHEERIOAPI('meta[itemprop="keywords"]').attr("content") ||
          null;
        meta.keywords = keywords
          ? keywords
              .split(",")
              .map((k: string) => k.trim())
              .filter(Boolean)
          : null;
        // Site name
        meta.siteName =
          CHEERIOAPI('meta[property="og:site_name"]').attr("content") || null;
        // Canonical URL
        meta.canonicalUrl =
          CHEERIOAPI('link[rel="canonical"]').attr("href") ||
          CHEERIOAPI('meta[property="og:url"]').attr("content") ||
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
    const metadata =
      typeof result.data === "object" && result.data !== null
        ? result.data
        : {};
    return { url, ...metadata };
  }, "Page metadata scrape"),
);
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
    scraper: "on-demand (Cheerio, public addresses only)",
  };
}
// ── Unified Airport Lookup Dispatcher ──────────────────────────────
router.get(
  "/airports/lookup",
  asyncHandler(async (req: Request, res: Response) => {
    const action = req.query.action as string | undefined;
    const searchQuery = req.query['q'] as string | undefined;
    const code = req.query.code as string | undefined;
    const country = req.query.country as string | undefined;
    const lat = req.query.lat as string | undefined;
    const lng = req.query.lng as string | undefined;
    const limit = req.query.limit as string | undefined;
    if (!action)
      return res
        .status(400)
        .json({
          error: "'action' is required",
          actions: ["search", "code", "country", "nearest"],
        });
    switch (action) {
      case "search":
        req.url = `/airports/search?q=${searchQuery || ""}&limit=${limit || 10}&country=${country || ""}`;
        return dispatchToRoute(req, res, () =>
          res.status(404).json({ error: "Route not found" }),
        );
      case "code":
        req.url = `/airports/code/${code || ""}`;
        return dispatchToRoute(req, res, () =>
          res.status(404).json({ error: "Route not found" }),
        );
      case "country":
        req.url = `/airports/country/${code || country || ""}`;
        return dispatchToRoute(req, res, () =>
          res.status(404).json({ error: "Route not found" }),
        );
      case "nearest":
        req.url = `/airports/nearest?lat=${lat || 0}&lng=${lng || 0}&limit=${limit || 10}`;
        return dispatchToRoute(req, res, () =>
          res.status(404).json({ error: "Route not found" }),
        );
      default:
        return res
          .status(400)
          .json({
            error: `Unknown action: ${action}`,
            actions: ["search", "code", "country", "nearest"],
          });
    }
  }),
);
// ─── DNS Lookup ────────────────────────────────────────────────────
import {
  dnsLookup,
  whoisLookup,
  sslCertificateCheck,
  portScan,
  httpHeaders,
  pingHost,
} from "../fetchers/utility/NetworkDiagnosticsFetcher.ts";

router.get(
  "/dns/:hostname",
  asyncHandler(async (req: Request) => {
    const hostname = req.params.hostname as string;
    const recordType = (req.query.type as string) || "A";
    return dnsLookup(hostname, recordType);
  }, "DNS lookup"),
);
// ─── WHOIS Lookup ──────────────────────────────────────────────────
router.get(
  "/whois/:domain",
  asyncHandler(
    (req: Request) => whoisLookup(req.params.domain as string),
    "WHOIS lookup",
  ),
);
// ─── SSL Certificate Check ─────────────────────────────────────────
router.get(
  "/ssl/:hostname",
  asyncHandler(async (req: Request) => {
    const hostname = req.params.hostname as string;
    const port = parseInt((req.query.port as string) || "443", 10);
    return sslCertificateCheck(hostname, port);
  }, "SSL certificate check"),
);
// ─── Port Scan ─────────────────────────────────────────────────────
router.get(
  "/ports/:host",
  asyncHandler(async (req: Request) => {
    const host = req.params.host as string;
    const portsParam = req.query.ports as string | undefined;
    const ports = portsParam
      ? portsParam.split(",").map((portString) => parseInt(portString.trim(), 10)).filter((portNumber) => !isNaN(portNumber))
      : undefined;
    return portScan(host, ports);
  }, "Port scan"),
);
// ─── HTTP Headers ──────────────────────────────────────────────────
router.get(
  "/headers",
  asyncHandler(async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ error: "Query parameter 'url' is required" });
    }
    res.json(await httpHeaders(url));
  }),
);
// ─── Ping Host ─────────────────────────────────────────────────────
router.get(
  "/ping/:host",
  asyncHandler(async (req: Request) => {
    const host = req.params.host as string;
    const count = parseInt((req.query.count as string) || "4", 10);
    return pingHost(host, count);
  }, "Ping host"),
);
// ─── Breach Check (HIBP) ──────────────────────────────────────────
import {
  checkPasswordBreach,
  checkEmailBreach,
} from "../fetchers/utility/BreachFetcher.ts";

router.get(
  "/breach/check",
  asyncHandler(async (req: Request, res: Response) => {
    const { type, value } = req.query as Record<string, string | undefined>;
    if (!type || !value) {
      return res.status(400).json({
        error: "Query parameters 'type' (email|password) and 'value' are required",
      });
    }
    if (type === "password") {
      res.json(await checkPasswordBreach(value));
    } else if (type === "email") {
      if (!CONFIG.HIBP_API_KEY) {
        return res.status(400).json({
          error: "Email breach checks require an HIBP API key (HIBP_API_KEY). Password checks are free.",
        });
      }
      res.json(await checkEmailBreach(value, CONFIG.HIBP_API_KEY));
    } else {
      return res.status(400).json({ error: "Invalid type. Use 'email' or 'password'." });
    }
  }),
);
// ─── Google Calendar ───────────────────────────────────────────────
import {
  getCalendarEvents,
  createCalendarEvent,
  getFreeBusy,
} from "../fetchers/utility/GoogleCalendarFetcher.ts";

router.get(
  "/calendar/events",
  asyncHandler(async (req: Request, res: Response) => {
    if (!CONFIG.GOOGLE_CALENDAR_CREDENTIALS) {
      return res.status(400).json({ error: "Google Calendar credentials not configured" });
    }
    const { calendarId, timeMin, timeMax, limit } = req.query as Record<
      string,
      string | undefined
    >;
    res.json(
      await getCalendarEvents(
        CONFIG.GOOGLE_CALENDAR_CREDENTIALS,
        calendarId || "primary",
        timeMin,
        timeMax,
        parseInt(limit || "25", 10),
      ),
    );
  }),
);
router.post(
  "/calendar/events",
  asyncHandler(async (req: Request, res: Response) => {
    if (!CONFIG.GOOGLE_CALENDAR_CREDENTIALS) {
      return res.status(400).json({ error: "Google Calendar credentials not configured" });
    }
    const { calendarId, summary, startDateTime, endDateTime, description, location, attendees, timeZone } = req.body;
    if (!summary || !startDateTime || !endDateTime) {
      return res.status(400).json({
        error: "'summary', 'startDateTime', and 'endDateTime' are required",
      });
    }
    res.json(
      await createCalendarEvent(CONFIG.GOOGLE_CALENDAR_CREDENTIALS, {
        calendarId,
        summary,
        startDateTime,
        endDateTime,
        description,
        location,
        attendees,
        timeZone,
      }),
    );
  }),
);
router.post(
  "/calendar/freebusy",
  asyncHandler(async (req: Request, res: Response) => {
    if (!CONFIG.GOOGLE_CALENDAR_CREDENTIALS) {
      return res.status(400).json({ error: "Google Calendar credentials not configured" });
    }
    const { calendarIds, timeMin, timeMax } = req.body;
    if (!calendarIds || !timeMin || !timeMax) {
      return res.status(400).json({
        error: "'calendarIds' (array), 'timeMin', and 'timeMax' are required",
      });
    }
    res.json(
      await getFreeBusy(
        CONFIG.GOOGLE_CALENDAR_CREDENTIALS,
        calendarIds,
        timeMin,
        timeMax,
      ),
    );
  }),
);
export default router;
