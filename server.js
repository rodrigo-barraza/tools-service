import express from "express";
import CONFIG, { applyLocation } from "./config.js";
import { connectDB } from "./db.js";
import { initLocation } from "./services/LocationService.js";
import { requestLoggerMiddleware } from "./middleware/RequestLoggerMiddleware.js";
import { toolCallLoggerMiddleware } from "./middleware/ToolCallLoggerMiddleware.js";
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
import { connectClockCrewDB, setupClockCrewCollections } from "./models/ClockCrewPost.js";
import { setupNewgroundsCollections } from "./models/NewgroundsProfile.js";
import { setupToolCallsCollection } from "./middleware/ToolCallLoggerMiddleware.js";
import { setupAgenticTaskCollection } from "./services/AgenticTaskService.js";

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
import computeRoutes, { getComputeHealth } from "./routes/ComputeRoutes.js";
import maritimeRoutes, { getMaritimeHealth } from "./routes/MaritimeRoutes.js";
import energyRoutes, { getEnergyHealth } from "./routes/EnergyRoutes.js";
import agenticRoutes, { getAgenticHealth } from "./routes/AgenticRoutes.js";
import communicationRoutes, { getCommunicationHealth } from "./routes/CommunicationRoutes.js";
import creativeRoutes, { getCreativeHealth } from "./routes/CreativeRoutes.js";
import clockcrewRoutes, { getClockCrewHealth } from "./routes/ClockCrewRoutes.js";
import newgroundsRoutes, { getNewgroundsHealth } from "./routes/NewgroundsRoutes.js";
import adminRoutes from "./routes/AdminRoutes.js";
import { mountMcpRoutes } from "./services/McpAdapter.js";

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
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Project, X-Username, X-Agent, X-Request-Id, X-Conversation-Id, X-Iteration");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(toolCallLoggerMiddleware);
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
app.use("/compute", computeRoutes);
app.use("/maritime", maritimeRoutes);
app.use("/energy", energyRoutes);
app.use("/agentic", agenticRoutes);
app.use("/communication", communicationRoutes);
app.use("/creative", creativeRoutes);
app.use("/clockcrew", clockcrewRoutes);
app.use("/newgrounds", newgroundsRoutes);
app.use("/admin", adminRoutes);
mountMcpRoutes(app);

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
      compute: getComputeHealth(),
      maritime: getMaritimeHealth(),
      energy: getEnergyHealth(),
      agentic: getAgenticHealth(),
      communication: getCommunicationHealth(),
      creative: getCreativeHealth(),
      clockcrew: getClockCrewHealth(),
      newgrounds: getNewgroundsHealth(),
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
      setupToolCallsCollection(),
      setupAgenticTaskCollection(),
    ]);

    // Connect to separate Clock Crew database (also hosts Newgrounds collections)
    await connectClockCrewDB(CONFIG.MONGODB_URI);
    await setupClockCrewCollections();
    await setupNewgroundsCollections();
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
      "   Domains: event, finance, market, product, trend, weather, knowledge, health, transit, utility, compute, maritime, energy, agentic, communication, creative, clockcrew, newgrounds",
    );
    console.log(
      "   Routes: /event/*, /finance/*, /market/*, /product/*, /trend/*, /weather/*, /knowledge/*, /health/*, /transit/*, /utility/*, /compute/*, /maritime/*, /energy/*, /agentic/*, /communication/*, /creative/*, /clockcrew/*, /newgrounds/*",
    );
  });
}

start();
