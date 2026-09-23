import http from "node:http";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import logger from "./logger.ts";
import CONFIG, { applyLocation } from "./config.ts";
import { connectDatabase } from "@rodrigo-barraza/utilities-library/service/mongo";
import {
  installExternalApiUsageTracking,
  setupExternalApiUsageCollection,
  flushExternalApiUsageNow,
} from "./services/ExternalApiUsageService.ts";
import { initLocation } from "./services/LocationService.ts";
import {
  requestLoggerMiddleware,
  setupRequestsCollection,
} from "./middleware/RequestLoggerMiddleware.ts";
import { toolCallLoggerMiddleware } from "./middleware/ToolCallLoggerMiddleware.ts";
import { fieldProjectionMiddleware } from "./middleware/FieldProjectionMiddleware.ts";
import {
  installTraceContextForwarding,
  traceContextMiddleware,
} from "./middleware/TraceContextMiddleware.ts";
import { createAuthMiddleware } from "@rodrigo-barraza/utilities-library/service";
import { DEFAULT_USERNAME, CORS_ALLOWED_HEADERS_STRING } from "@rodrigo-barraza/utilities-library/taxonomy";

// ─── Model Setup ───────────────────────────────────────────────────

import { setupEventCollection } from "./models/Event.ts";
import { setupCommodityCollection } from "./models/CommoditySnapshot.ts";
import { setupProductCollection } from "./models/Product.ts";
import { setupTrendCollection } from "./models/Trend.ts";
import { setupEarthquakeCollection } from "./models/Earthquake.ts";
import { setupNeoCollection } from "./models/Neo.ts";
import { setupSolarFlareCollection } from "./models/SolarFlare.ts";
import { setupCmeCollection } from "./models/Cme.ts";
import { setupGeomagneticStormCollection } from "./models/GeomagneticStorm.ts";
import { setupWebcamCollection } from "./models/Webcam.ts";
import { setupTurtleDrawingCollection } from "./models/TurtleDrawing.ts";
import { setupVectorAnimationCollection } from "./models/VectorAnimation.ts";
import { setupThreeDimensionalSceneCollection } from "./models/ThreeDimensionalScene.ts";
import { setupEmbedAssetCollection } from "./models/EmbedAsset.ts";
import { setupCurrencyCollection } from "./models/CurrencySnapshot.ts";
import { setupVideoCacheCollection } from "./models/VideoCache.ts";
import { setupCraigslistCollections } from "./models/CraigslistListing.ts";
import { setupClassifiedsCollections } from "./models/ClassifiedsArchive.ts";

import { setupVideoTrimCacheCollection } from "./models/VideoTrimCache.ts";


import {
  connectLuposDB,
  setupLuposCollections,
} from "./models/LuposMessage.ts";
import { setupToolCallsCollection } from "./middleware/ToolCallLoggerMiddleware.ts";
import { setupAgenticTaskCollection } from "./services/AgenticTaskService.ts";
import { setupAgenticDatastoreCollection } from "./services/AgenticDatastoreService.ts";
import {
  setupAgenticScheduleCollection,
  startSchedulePoller,
} from "./services/AgenticSchedulerService.ts";

// ─── Routes ────────────────────────────────────────────────────────

import eventRoutes, { getEventHealth } from "./routes/EventRoutes.ts";
import financeRoutes, { getFinanceHealth } from "./routes/FinanceRoutes.ts";
import marketRoutes, { getMarketHealth } from "./routes/MarketRoutes.ts";
import productRoutes, { getProductHealth } from "./routes/ProductRoutes.ts";
import musicRoutes from "./routes/MusicRoutes.ts";
import trendRoutes, { getTrendHealth } from "./routes/TrendRoutes.ts";
import weatherRoutes, { getWeatherHealth } from "./routes/WeatherRoutes.ts";
import knowledgeRoutes, {
  getKnowledgeHealth,
} from "./routes/KnowledgeRoutes.ts";
import healthRoutes, { getHealthDomainHealth } from "./routes/HealthRoutes.ts";
import transitRoutes, { getTransitHealth } from "./routes/TransitRoutes.ts";
import utilityRoutes, { getUtilityHealth } from "./routes/UtilityRoutes.ts";
import computeRoutes, { getComputeHealth } from "./routes/ComputeRoutes.ts";
import maritimeRoutes, { getMaritimeHealth } from "./routes/MaritimeRoutes.ts";
import energyRoutes, { getEnergyHealth } from "./routes/EnergyRoutes.ts";
import agenticRoutes, { getAgenticHealth } from "./routes/AgenticRoutes.ts";
import hookCommandRoutes from "./routes/HookCommandRoutes.ts";
import communicationRoutes, {
  getCommunicationHealth,
} from "./routes/CommunicationRoutes.ts";
import creativeRoutes, { getCreativeHealth } from "./routes/CreativeRoutes.ts";
import gamingRoutes, { getGamingHealth } from "./routes/GamingRoutes.ts";
import torrentRoutes, { getTorrentHealth } from "./routes/TorrentRoutes.ts";
import infrastructureRoutes, { getInfrastructureHealth } from "./routes/InfrastructureRoutes.ts";
import analyticsRoutes, { getAnalyticsHealth } from "./routes/AnalyticsRoutes.ts";

import discordRoutes, { getDiscordHealth } from "./routes/DiscordRoutes.ts";
import lightsRoutes, { getLightsHealth } from "./routes/LightsRoutes.ts";
import adminRoutes, { loadUserWorkspaceRoots } from "./routes/AdminRoutes.ts";
import agentStatusRoutes from "./routes/AgentRoutes.ts";
import filesystemRoutes from "./routes/FilesystemRoutes.ts";
import MinioService from "./services/MinioService.ts";
import { mountMcpRoutes } from "./services/McpAdapter.ts";
import { initAgentWebSocket } from "./services/AgentConnectionManager.ts";

// ─── Collectors ────────────────────────────────────────────────────

import { startEventCollectors } from "./collectors/EventCollector.ts";
import { startFinanceCollectors } from "./collectors/FinanceCollector.ts";
import { startMarketCollectors } from "./collectors/MarketCollector.ts";
import { startProductCollectors } from "./collectors/ProductCollector.ts";
import { startTrendCollectors } from "./collectors/TrendCollector.ts";
import { startWeatherCollectors } from "./collectors/WeatherCollector.ts";
import { startEmojiKitchenCollectors } from "./collectors/EmojiKitchenCollector.ts";
import { startCurrencyCollector } from "./collectors/CurrencyCollector.ts";

import { startAisStream } from "./fetchers/maritime/AisStreamFetcher.ts";
import { preloadStaticDatasets } from "./fetchers/preloadStaticDatasets.ts";

import { errorMessage } from "./utilities.ts";

// ─── Express App ───────────────────────────────────────────────────

const app = express();

// A caller's W3C trace context rides on every fetch made serving its request.
installTraceContextForwarding();

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Headers",
    CORS_ALLOWED_HEADERS_STRING,
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(traceContextMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(requestLoggerMiddleware);
app.use(toolCallLoggerMiddleware);
app.use(fieldProjectionMiddleware);
app.use(
  createAuthMiddleware({
    defaultUsername: DEFAULT_USERNAME,
    traceContext: true,
  }),
);

// ─── Mount Domain Routers ──────────────────────────────────────────

app.use("/event", eventRoutes);
app.use("/finance", financeRoutes);
app.use("/market", marketRoutes);
app.use("/product", productRoutes);
app.use("/music", musicRoutes);
app.use("/trend", trendRoutes);
app.use("/weather", weatherRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/health", healthRoutes);
app.use("/transit", transitRoutes);
app.use("/utility", utilityRoutes);
app.use("/compute", computeRoutes);
app.use("/maritime", maritimeRoutes);
app.use("/energy", energyRoutes);
// Before /agentic: its own router, not one of the agentic tools.
app.use("/agentic/hook-command", hookCommandRoutes);
app.use("/agentic", agenticRoutes);
app.use("/communication", communicationRoutes);
app.use("/creative", express.json({ limit: "50mb" }), creativeRoutes);
app.use("/gaming", gamingRoutes);
app.use("/torrent", torrentRoutes);
app.use("/infrastructure", infrastructureRoutes);
app.use("/analytics", analyticsRoutes);

app.use("/discord", discordRoutes);
app.use("/lights", lightsRoutes);
app.use("/admin", adminRoutes);
app.use("/agents", agentStatusRoutes);
app.use("/filesystem", filesystemRoutes);
mountMcpRoutes(app);

// ─── Global Error Handler ──────────────────────────────────────────
// Defense-in-depth — catches any unhandled route errors and returns
// a structured JSON response instead of Express's default HTML page.

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`[GlobalErrorHandler] ${error.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// ─── Unified Health ────────────────────────────────────────────────

app.get("/health", async (_req: Request, res: Response) => {
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
      gaming: getGamingHealth(),
      torrent: await getTorrentHealth(),

      discord: getDiscordHealth(),
      lights: getLightsHealth(),
      infrastructure: getInfrastructureHealth(),
      analytics: getAnalyticsHealth(),
    },
  });
});

// ─── Startup ───────────────────────────────────────────────────────

async function start() {
  // Count outbound third-party calls from the very first fetch — counts
  // buffer in memory until Mongo connects, then flush on an interval.
  installExternalApiUsageTracking();

  // Fail fast if the static CSV datasets didn't ship with the build — a
  // missing file must abort startup (the healthcheck fails the deploy),
  // not surface later as empty tool results.
  try {
    preloadStaticDatasets();
  } catch (error: unknown) {
    logger.error(`Static dataset preload failed: ${errorMessage(error)}`);
    process.exit(1);
  }

  try {
    await connectDatabase(CONFIG.MONGODB_URI!, { dbName: CONFIG.MONGODB_DB_NAME });

    // Resolve location from IP geolocation + NOAA (cached in DB, 24h TTL)
    const location = await initLocation();
    applyLocation(location);

    logger.info(`LATITUDE ........... ${CONFIG.LATITUDE}`);
    logger.info(`LONGITUDE .......... ${CONFIG.LONGITUDE}`);
    logger.info(`TIMEZONE ........... ${CONFIG.TIMEZONE}`);
    logger.info(`RADIUS_MILES ....... ${CONFIG.RADIUS_MILES}`);
    logger.info(`TIDE_STATION_ID .... ${CONFIG.TIDE_STATION_ID}`);

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
      setupTurtleDrawingCollection(),
      setupVectorAnimationCollection(),
      setupThreeDimensionalSceneCollection(),
      setupEmbedAssetCollection(),
      setupCurrencyCollection(),
      setupVideoCacheCollection(),
      setupCraigslistCollections(),
      setupClassifiedsCollections(),

      setupVideoTrimCacheCollection(),
      setupToolCallsCollection(),

      setupRequestsCollection(),
      setupExternalApiUsageCollection(),
      setupAgenticTaskCollection(),
      setupAgenticDatastoreCollection(),
      setupAgenticScheduleCollection(),
    ]);

    // Connect to separate Lupos database (Discord message archive)
    await connectLuposDB(CONFIG.MONGODB_URI!);
    await setupLuposCollections();

    // Load user-configured workspace roots from MongoDB
    await loadUserWorkspaceRoots();

    // Connect the shared MinIO manager (ensures artifacts bucket + policy),
    // then seed the standalone workspace-agent.mjs file
    await MinioService.init();
    await MinioService.seedWorkspaceAgent();
  } catch (error: unknown) {
    logger.error(`Failed to connect to MongoDB: ${errorMessage(error)}`);
    process.exit(1);
  }

  // Start all domain collectors
  startEventCollectors();
  startFinanceCollectors();
  startMarketCollectors();
  startProductCollectors();
  startTrendCollectors();
  startWeatherCollectors();
  startEmojiKitchenCollectors();
  startCurrencyCollector();


  // Start AIS Stream WebSocket (if API key is configured)
  startAisStream();

  // Start schedule poller (checks for due schedules every 60s)
  startSchedulePoller();

  const port = CONFIG.TOOLS_SERVICE_PORT;
  const httpServer = http.createServer(app);

  // Request lifecycle ceilings — a hung handler must not hold a socket
  // forever. Sized above the longest legitimate operation (commands cap at
  // 120s, the agentic handler backstop at 150s); SSE streams send data
  // continuously so they survive the idle timeout.
  httpServer.requestTimeout = 300_000;
  httpServer.headersTimeout = 60_000;

  // Initialize workspace agent WebSocket (handles upgrade on /ws/agent)
  initAgentWebSocket(httpServer);

  httpServer.listen(port, () => {
    logger.success(`Tools API running on port ${port}`);
    logger.info(`Database: ${CONFIG.MONGODB_URI}`);
    logger.info(
      "Domains: event, finance, market, product, trend, weather, knowledge, health, transit, utility, compute, maritime, energy, agentic, communication, creative, gaming, torrent, discord, lights",
    );
    logger.info(
      "Routes: /event/*, /finance/*, /market/*, /product/*, /trend/*, /weather/*, /knowledge/*, /health/*, /transit/*, /utility/*, /compute/*, /maritime/*, /energy/*, /agentic/*, /communication/*, /creative/*, /gaming/*, /torrent/*, /discord/*, /lights/*, /infrastructure/*",
    );
    logger.info("Agent WebSocket: /ws/agent");
  });
}

// ─── Graceful Shutdown Hooks ────────────────────────────────────────

import { killAll as killAllBackgroundProcesses } from "./services/BackgroundProcessRegistry.ts";
import { agenticLspShutdown } from "./services/AgenticLspService.ts";
import { agenticDebugShutdown } from "./services/AgenticDebugService.ts";

async function gracefulShutdown(signal: string) {
  logger.info(`[Server] Received ${signal}, terminating active background tasks...`);
  killAllBackgroundProcesses();
  // Language servers and debug adapters are child processes — reap them so a
  // restart never leaves orphaned tsserver/debugpy processes behind (2s cap).
  await Promise.race([
    Promise.allSettled([agenticLspShutdown(), agenticDebugShutdown()]),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  // Best-effort: persist buffered external-API usage counts (2s cap).
  await Promise.race([
    flushExternalApiUsageNow().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

start();
