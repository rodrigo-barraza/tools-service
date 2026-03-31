import express from "express";
import CONFIG, { applyLocation } from "./config.js";
import { connectDB } from "./db.js";
import { initLocation } from "./services/LocationService.js";
import { requestLoggerMiddleware } from "./middleware/RequestLoggerMiddleware.js";
import { fieldProjectionMiddleware } from "./middleware/FieldProjectionMiddleware.js";

// ─── Model Setup ───────────────────────────────────────────────────

import { setupEventCollection } from "./models/Event.js";
import { setupCommodityCollection } from "./models/CommoditySnapshot.js";
import { setupProductCollection } from "./models/Product.js";
import { setupTrendCollection } from "./models/Trend.js";
import { setupEarthquakeCollection } from "./models/Earthquake.js";
import { setupNeoCollection } from "./models/Neo.js";
import { setupSolarFlareCollection } from "./models/SolarFlare.js";
import { setupCmeCollection } from "./models/Cme.js";
import { setupGeomagneticStormCollection } from "./models/GeomagneticStorm.js";
import { setupWebcamCollection } from "./models/Webcam.js";

// ─── Routes ────────────────────────────────────────────────────────

import eventRoutes, { getEventHealth } from "./routes/EventRoutes.js";
import financeRoutes, { getFinanceHealth } from "./routes/FinanceRoutes.js";
import marketRoutes, { getMarketHealth } from "./routes/MarketRoutes.js";
import productRoutes, { getProductHealth } from "./routes/ProductRoutes.js";
import trendRoutes, { getTrendHealth } from "./routes/TrendRoutes.js";
import weatherRoutes, { getWeatherHealth } from "./routes/WeatherRoutes.js";
import knowledgeRoutes, {
  getKnowledgeHealth,
} from "./routes/KnowledgeRoutes.js";
import healthRoutes, { getHealthDomainHealth } from "./routes/HealthRoutes.js";
import transitRoutes, { getTransitHealth } from "./routes/TransitRoutes.js";
import utilityRoutes, { getUtilityHealth } from "./routes/UtilityRoutes.js";
import maritimeRoutes, { getMaritimeHealth } from "./routes/MaritimeRoutes.js";
import energyRoutes, { getEnergyHealth } from "./routes/EnergyRoutes.js";
import adminRoutes from "./routes/AdminRoutes.js";

// ─── Collectors ────────────────────────────────────────────────────

import { startEventCollectors } from "./collectors/EventCollector.js";
import { startFinanceCollectors } from "./collectors/FinanceCollector.js";
import { startMarketCollectors } from "./collectors/MarketCollector.js";
import { startProductCollectors } from "./collectors/ProductCollector.js";
import { startTrendCollectors } from "./collectors/TrendCollector.js";
import { startWeatherCollectors } from "./collectors/WeatherCollector.js";
import { startAisStream } from "./fetchers/maritime/AisStreamFetcher.js";

// ─── Express App ───────────────────────────────────────────────────

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(fieldProjectionMiddleware);

// ─── Mount Domain Routers ──────────────────────────────────────────

app.use("/event", eventRoutes);
app.use("/finance", financeRoutes);
app.use("/market", marketRoutes);
app.use("/product", productRoutes);
app.use("/trend", trendRoutes);
app.use("/weather", weatherRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/health", healthRoutes);
app.use("/transit", transitRoutes);
app.use("/utility", utilityRoutes);
app.use("/maritime", maritimeRoutes);
app.use("/energy", energyRoutes);
app.use("/admin", adminRoutes);

// ─── Unified Health ────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    domains: {
      event: getEventHealth(),
      finance: getFinanceHealth(),
      market: getMarketHealth(),
      product: getProductHealth(),
      trend: getTrendHealth(),
      weather: getWeatherHealth(),
      knowledge: getKnowledgeHealth(),
      health: getHealthDomainHealth(),
      transit: getTransitHealth(),
      utility: getUtilityHealth(),
      maritime: getMaritimeHealth(),
      energy: getEnergyHealth(),
    },
  });
});

// ─── Startup ───────────────────────────────────────────────────────

async function start() {
  try {
    await connectDB(CONFIG.MONGODB_URI);

    // Resolve location from IP geolocation + NOAA (cached in DB, 24h TTL)
    const location = await initLocation();
    applyLocation(location);

    console.log(`   📍 LATITUDE ........... ${CONFIG.LATITUDE}`);
    console.log(`   📍 LONGITUDE .......... ${CONFIG.LONGITUDE}`);
    console.log(`   🌐 TIMEZONE ........... ${CONFIG.TIMEZONE}`);
    console.log(`   📏 RADIUS_MILES ....... ${CONFIG.RADIUS_MILES}`);
    console.log(`   🌊 TIDE_STATION_ID .... ${CONFIG.TIDE_STATION_ID}`);

    await Promise.all([
      setupEventCollection(),
      setupCommodityCollection(),
      setupProductCollection(),
      setupTrendCollection(),
      setupEarthquakeCollection(),
      setupNeoCollection(),
      setupSolarFlareCollection(),
      setupCmeCollection(),
      setupGeomagneticStormCollection(),
      setupWebcamCollection(),
    ]);
  } catch (error) {
    console.error(`Failed to connect to MongoDB: ${error.message}`);
    process.exit(1);
  }

  // Start all domain collectors
  startEventCollectors();
  startFinanceCollectors();
  startMarketCollectors();
  startProductCollectors();
  startTrendCollectors();
  startWeatherCollectors();

  // Start AIS Stream WebSocket (if API key is configured)
  startAisStream();

  const port = CONFIG.TOOLS_PORT;
  app.listen(port, () => {
    console.log(`🔧 Tools API running on port ${port}`);
    console.log(`   Database: ${CONFIG.MONGODB_URI}`);
    console.log(
      "   Domains: event, finance, market, product, trend, weather, knowledge, health, transit, utility, maritime, energy",
    );
    console.log(
      "   Routes: /event/*, /finance/*, /market/*, /product/*, /trend/*, /weather/*, /knowledge/*, /health/*, /transit/*, /utility/*, /maritime/*, /energy/*",
    );
  });
}

start();
