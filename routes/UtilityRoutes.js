import { Router } from "express";
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

// ─── Map Generation ───────────────────────────────────────────────

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
  const { markers, zoom, maptype } = req.query;
  if (!markers || !CONFIG.GOOGLE_API_KEY) {
    return res.status(400).send("Missing markers or API key");
  }
  try {
    const markerList = JSON.parse(markers);
    if (!Array.isArray(markerList) || markerList.length === 0) {
      return res.status(400).send("markers must be a non-empty array");
    }
    const html = buildMapEmbedHtml(markerList, CONFIG.GOOGLE_API_KEY, {
      zoom: zoom ? parseInt(zoom) : undefined,
      maptype: maptype || "roadmap",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(500).send(`Map embed failed: ${err.message}`);
  }
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


    // Build embed URL with the same markers param
    const embedParams = new URLSearchParams({ markers });
    if (zoom) embedParams.set("zoom", zoom);
    if (maptype) embedParams.set("maptype", maptype);
    const mapEmbedUrl = `http://localhost:${CONFIG.TOOLS_PORT}/utility/map/embed?${embedParams.toString()}`;

    res.json({
      mapEmbedUrl,
      markerCount: markerList.length,
    });
  } catch (err) {
    res.status(502).json({ error: `Map generation failed: ${err.message}` });
  }
});

// ─── Airports ──────────────────────────────────────────────────────

router.get("/airports/search", (req, res) => {
  const { q, limit, country } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  try {
    const result = searchAirports(q, {
      limit: parseInt(limit) || 10,
      country,
    });
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Airport search failed: ${err.message}` });
  }
});

router.get("/airports/code/:code", (req, res) => {
  try {
    const result = getAirportByCode(req.params.code);
    if (!result) {
      return res.status(404).json({ error: `Airport not found: ${req.params.code}` });
    }
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Airport lookup failed: ${err.message}` });
  }
});

router.get("/airports/country/:code", (req, res) => {
  const { limit } = req.query;
  try {
    const result = getAirportsByCountry(req.params.code, {
      limit: parseInt(limit) || 50,
    });
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Country airports lookup failed: ${err.message}` });
  }
});

router.get("/airports/nearest", (req, res) => {
  const { lat, lng, limit } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: "Query parameters 'lat' and 'lng' are required" });
  }
  try {
    const result = getNearestAirports(
      parseFloat(lat),
      parseFloat(lng),
      { limit: parseInt(limit) || 5 },
    );
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Nearest airports lookup failed: ${err.message}` });
  }
});

// ─── Health ────────────────────────────────────────────────────────

export function getUtilityHealth() {
  return {
    currency: "on-demand",
    timezone: "on-demand",
    ipinfo: "on-demand",
    places: "on-demand",
    airports: "on-demand (in-memory, ~4,555 airports)",
  };
}

export default router;

