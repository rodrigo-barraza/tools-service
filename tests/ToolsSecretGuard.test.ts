// ─── Tools Secret Guard ───────────────────────────────────────────
// The gated routes answer only a caller with TOOLS_SERVICE_API_SECRET in
// x-api-secret. The census mounts every route of every router as server.ts
// mounts them, behind the real guard but with stand-in handlers, so nothing
// runs, and holds each route to the policy: whole families gated or open;
// in the mixed ones exactly the named routes gated; and every route another
// fleet app or a browser loads stays open.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler, type Router } from "express";
import request from "supertest";
import CONFIG from "../src/config.ts";
import {
  GATED_ROUTES,
  mountToolsSecretGuard,
  toolsSecretHeaders,
  toolsSecretMatches,
} from "../src/middleware/ToolsSecretMiddleware.ts";
import eventRoutes from "../src/routes/EventRoutes.ts";
import financeRoutes from "../src/routes/FinanceRoutes.ts";
import marketRoutes from "../src/routes/MarketRoutes.ts";
import productRoutes from "../src/routes/ProductRoutes.ts";
import musicRoutes from "../src/routes/MusicRoutes.ts";
import trendRoutes from "../src/routes/TrendRoutes.ts";
import weatherRoutes from "../src/routes/WeatherRoutes.ts";
import knowledgeRoutes from "../src/routes/KnowledgeRoutes.ts";
import healthRoutes from "../src/routes/HealthRoutes.ts";
import transitRoutes from "../src/routes/TransitRoutes.ts";
import utilityRoutes from "../src/routes/UtilityRoutes.ts";
import computeRoutes from "../src/routes/ComputeRoutes.ts";
import maritimeRoutes from "../src/routes/MaritimeRoutes.ts";
import energyRoutes from "../src/routes/EnergyRoutes.ts";
import hookCommandRoutes from "../src/routes/HookCommandRoutes.ts";
import workspaceTaskRoutes from "../src/routes/WorkspaceTaskRoutes.ts";
import workspaceHookRoutes from "../src/routes/WorkspaceHookRoutes.ts";
import agenticRoutes from "../src/routes/AgenticRoutes.ts";
import communicationRoutes from "../src/routes/CommunicationRoutes.ts";
import creativeRoutes from "../src/routes/CreativeRoutes.ts";
import gamingRoutes from "../src/routes/GamingRoutes.ts";
import torrentRoutes from "../src/routes/TorrentRoutes.ts";
import infrastructureRoutes from "../src/routes/InfrastructureRoutes.ts";
import analyticsRoutes from "../src/routes/AnalyticsRoutes.ts";
import discordRoutes from "../src/routes/DiscordRoutes.ts";
import lightsRoutes from "../src/routes/LightsRoutes.ts";
import adminRoutes from "../src/routes/AdminRoutes.ts";
import agentStatusRoutes from "../src/routes/AgentRoutes.ts";
import filesystemRoutes from "../src/routes/FilesystemRoutes.ts";

const SECRET = "tools-test-secret-7f3a";
const ORIGINAL_SECRET = CONFIG.TOOLS_SERVICE_API_SECRET;
const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

beforeEach(() => {
  CONFIG.TOOLS_SERVICE_API_SECRET = SECRET;
});
afterAll(() => {
  CONFIG.TOOLS_SERVICE_API_SECRET = ORIGINAL_SECRET;
});

// ─── The secret itself ────────────────────────────────────────────

describe("toolsSecretMatches", () => {
  it("accepts the secret and nothing near it", () => {
    expect(toolsSecretMatches(SECRET)).toBe(true);
    for (const wrong of [
      SECRET.slice(0, -1) + "x", // same length
      SECRET.slice(0, -1), // a prefix
      SECRET + "x", // longer
      SECRET.toUpperCase(),
      "",
      undefined,
      null,
      [SECRET],
      42,
    ]) {
      expect(toolsSecretMatches(wrong)).toBe(false);
    }
  });

  it("matches nothing while the secret is unset", () => {
    for (const unset of [undefined, ""]) {
      CONFIG.TOOLS_SERVICE_API_SECRET = unset;
      for (const provided of ["", "undefined", SECRET, undefined]) {
        expect(toolsSecretMatches(provided)).toBe(false);
      }
      expect(toolsSecretHeaders()).toEqual({});
    }
  });

  it("is what this service sends its own gated routes", () => {
    expect(toolsSecretHeaders()).toEqual({ "x-api-secret": SECRET });
  });
});

// ─── The census ───────────────────────────────────────────────────

type Policy = "gated" | "open" | "mixed";

// As server.ts mounts them (checked against its source below).
const MOUNTS: Array<{
  path: string;
  name: string;
  router: Router;
  policy: Policy;
}> = [
  { path: "/event", name: "eventRoutes", router: eventRoutes, policy: "open" },
  {
    path: "/finance",
    name: "financeRoutes",
    router: financeRoutes,
    policy: "open",
  },
  {
    path: "/market",
    name: "marketRoutes",
    router: marketRoutes,
    policy: "open",
  },
  {
    path: "/product",
    name: "productRoutes",
    router: productRoutes,
    policy: "mixed",
  },
  { path: "/music", name: "musicRoutes", router: musicRoutes, policy: "mixed" },
  { path: "/trend", name: "trendRoutes", router: trendRoutes, policy: "open" },
  {
    path: "/weather",
    name: "weatherRoutes",
    router: weatherRoutes,
    policy: "open",
  },
  {
    path: "/knowledge",
    name: "knowledgeRoutes",
    router: knowledgeRoutes,
    policy: "mixed",
  },
  {
    path: "/health",
    name: "healthRoutes",
    router: healthRoutes,
    policy: "open",
  },
  {
    path: "/transit",
    name: "transitRoutes",
    router: transitRoutes,
    policy: "open",
  },
  {
    path: "/utility",
    name: "utilityRoutes",
    router: utilityRoutes,
    policy: "mixed",
  },
  {
    path: "/compute",
    name: "computeRoutes",
    router: computeRoutes,
    policy: "mixed",
  },
  {
    path: "/maritime",
    name: "maritimeRoutes",
    router: maritimeRoutes,
    policy: "open",
  },
  {
    path: "/energy",
    name: "energyRoutes",
    router: energyRoutes,
    policy: "open",
  },
  {
    path: "/agentic/hook-command",
    name: "hookCommandRoutes",
    router: hookCommandRoutes,
    policy: "gated",
  },
  {
    path: "/agentic/tasks",
    name: "workspaceTaskRoutes",
    router: workspaceTaskRoutes,
    policy: "gated",
  },
  {
    path: "/agentic",
    name: "workspaceHookRoutes",
    router: workspaceHookRoutes,
    policy: "gated",
  },
  {
    path: "/agentic",
    name: "agenticRoutes",
    router: agenticRoutes,
    policy: "gated",
  },
  {
    path: "/communication",
    name: "communicationRoutes",
    router: communicationRoutes,
    policy: "gated",
  },
  {
    path: "/creative",
    name: "creativeRoutes",
    router: creativeRoutes,
    policy: "mixed",
  },
  {
    path: "/gaming",
    name: "gamingRoutes",
    router: gamingRoutes,
    policy: "open",
  },
  {
    path: "/torrent",
    name: "torrentRoutes",
    router: torrentRoutes,
    policy: "gated",
  },
  {
    path: "/infrastructure",
    name: "infrastructureRoutes",
    router: infrastructureRoutes,
    policy: "gated",
  },
  {
    path: "/analytics",
    name: "analyticsRoutes",
    router: analyticsRoutes,
    policy: "gated",
  },
  {
    path: "/discord",
    name: "discordRoutes",
    router: discordRoutes,
    policy: "mixed",
  },
  {
    path: "/lights",
    name: "lightsRoutes",
    router: lightsRoutes,
    policy: "gated",
  },
  { path: "/admin", name: "adminRoutes", router: adminRoutes, policy: "gated" },
  {
    path: "/agents",
    name: "agentStatusRoutes",
    router: agentStatusRoutes,
    policy: "gated",
  },
  {
    path: "/filesystem",
    name: "filesystemRoutes",
    router: filesystemRoutes,
    policy: "gated",
  },
];

// Routes registered on the app itself: the MCP adapter's and the health check.
const APP_ROUTES: Array<{
  method: string;
  path: string;
  policy: Policy;
  source: string;
}> = [
  {
    method: "GET",
    path: "/mcp/sse",
    policy: "gated",
    source: "services/McpAdapter.ts",
  },
  {
    method: "POST",
    path: "/mcp/messages",
    policy: "gated",
    source: "services/McpAdapter.ts",
  },
  { method: "GET", path: "/health", policy: "open", source: "server.ts" },
];

// The mixed families' gated routes, exactly; every other route of theirs is
// open — except discord and product, where every write is gated.
const MIXED_GATED = new Set([
  "POST /compute/js/execute",
  "GET /compute/js/info",
  "POST /compute/js/stream",
  "POST /compute/shell/execute",
  "GET /compute/shell/binaries",
  "POST /compute/shell/stream",
  "POST /compute/image/process",
  "POST /compute/image/ascii",
  "POST /compute/barcode/scan",
  "POST /compute/video/gif",
  "POST /utility/python/execute",
  "POST /utility/python/stream",
  "GET /utility/python/info",
  "GET /utility/calendar/events",
  "POST /utility/calendar/events",
  "POST /utility/calendar/freebusy",
  "GET /utility/ports/:host",
  "GET /utility/ping/:host",
  "GET /knowledge/video/download",
  "POST /knowledge/video/trim",
  "POST /creative/generate-image",
  "POST /creative/describe-image",
  "POST /creative/detect-objects",
  "POST /creative/remove-background",
  "POST /creative/text-to-speech",
  "POST /creative/sound-effect",
  "POST /creative/speech-to-text",
  "POST /creative/generate-audio",
  "POST /creative/remix-audio",
  "GET /music/spotify/get",
  "POST /music/spotify/control",
  "GET /music/spotify/auth/login",
  "GET /music/spotify/auth/status",
]);
const WRITES_GATED = new Set(["/discord", "/product"]);

// What other fleet apps call here, with no secret (2026-10-06).
const FLEET_ROUTES: Record<string, string[]> = {
  "lupos-bot": ["GET /utility/scrape/metadata"],
  "classic-whitemane-client": [
    "GET /discord/messages/search",
    "GET /discord/messages/stream",
  ],
  "clock-crew-client": [
    "GET /discord/messages/search",
    "GET /discord/messages/stream",
  ],
  "lights-service": ["GET /weather/weather/current", "GET /weather/twilight"],
  "gauge-service": [
    "GET /weather/weather",
    "GET /weather/weather/current",
    "GET /weather/weather/forecast",
    "GET /weather/weather/air",
    "GET /weather/weather/daylight",
    "GET /weather/environment",
    "GET /weather/live",
    "GET /weather/space-weather",
    "GET /weather/kp/current",
    "GET /weather/earthquakes",
    "GET /weather/iss",
    "GET /weather/pollen/today",
    "GET /weather/launches/next",
  ],
  "docker healthcheck": ["GET /health"],
};

interface CensusRoute {
  method: string;
  path: string;
  policy: Policy;
}

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

const ROUTES: CensusRoute[] = [
  ...MOUNTS.flatMap(({ path: mountPath, router, policy }) =>
    (router as unknown as { stack: RouteLayer[] }).stack.flatMap(({ route }) =>
      route
        ? Object.keys(route.methods).map((method) => ({
            method: method.toUpperCase(),
            path: route.path === "/" ? mountPath : mountPath + route.path,
            policy,
          }))
        : [],
    ),
  ),
  ...APP_ROUTES.map(({ method, path, policy }) => ({ method, path, policy })),
];

const routeKey = (route: { method: string; path: string }) =>
  `${route.method} ${route.path}`;
const ROUTE_KEYS = new Set(ROUTES.map(routeKey));

function expectedGated(route: CensusRoute): boolean {
  if (route.policy !== "mixed") return route.policy === "gated";
  const family = MOUNTS.find(
    (mount) =>
      route.path.startsWith(`${mount.path}/`) || route.path === mount.path,
  );
  if (family && WRITES_GATED.has(family.path)) return route.method !== "GET";
  return MIXED_GATED.has(routeKey(route));
}

const stub: RequestHandler = (_req, res) => {
  res.json({ reached: true });
};

function censusApp(): express.Express {
  const app = express();
  mountToolsSecretGuard(app);
  for (const { method, path } of ROUTES) {
    if (method === "GET") app.get(path, stub);
    else if (method === "POST") app.post(path, stub);
    else if (method === "PUT") app.put(path, stub);
    else if (method === "PATCH") app.patch(path, stub);
    else if (method === "DELETE") app.delete(path, stub);
    else throw new Error(`census: no stand-in for ${method} ${path}`);
  }
  return app;
}

let server: http.Server;
beforeAll(async () => {
  server = http.createServer(censusApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Agent = Record<string, (path: string) => request.Test>;

/** Each route's status, sent with `secret` (or none). Params become "x". */
async function statuses(secret?: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const batchSize = 40;
  for (let start = 0; start < ROUTES.length; start += batchSize) {
    const batch = ROUTES.slice(start, start + batchSize);
    const responses = await Promise.all(
      batch.map((route) => {
        const call = (request(server) as unknown as Agent)[
          route.method.toLowerCase()
        ](route.path.replace(/:\w+/g, "x"));
        return secret === undefined ? call : call.set("x-api-secret", secret);
      }),
    );
    batch.forEach((route, index) =>
      result.set(routeKey(route), responses[index].status),
    );
  }
  return result;
}

// Sent with no secret while it is configured — read by several tests.
let withoutSecret: Promise<Map<string, number>> | undefined;
const statusesWithoutSecret = () => (withoutSecret ??= statuses());

function failures(
  observed: Map<string, number>,
  expected: (route: CensusRoute) => number,
): string[] {
  return ROUTES.filter(
    (route) => observed.get(routeKey(route)) !== expected(route),
  ).map(
    (route) =>
      `${routeKey(route)}: ${observed.get(routeKey(route))}, expected ${expected(route)}`,
  );
}

describe("census of every route", () => {
  it("mirrors the mounts and app routes in the source", () => {
    const serverSource = readFileSync(join(SOURCE_ROOT, "server.ts"), "utf8");
    const mounted = [
      ...serverSource.matchAll(
        /app\.use\(\s*"([^"]+)",\s*(?:express\.json\([^)]*\),\s*)?(\w+)\s*\)/g,
      ),
    ].map(([, path, name]) => `${path} ${name}`);
    expect(mounted.sort()).toEqual(
      MOUNTS.map(({ path, name }) => `${path} ${name}`).sort(),
    );

    for (const { source, method, path } of APP_ROUTES) {
      const text = readFileSync(join(SOURCE_ROOT, source), "utf8");
      expect(text).toContain(`app.${method.toLowerCase()}("${path}"`);
    }
    expect(ROUTES.length).toBeGreaterThan(500);
  });

  it("refuses every gated route without the secret, and runs only the open ones", async () => {
    const observed = await statusesWithoutSecret();
    expect(
      failures(observed, (route) => (expectedGated(route) ? 401 : 200)),
    ).toEqual([]);
  });

  it("refuses every gated route with a wrong secret", async () => {
    const observed = await statuses("not-the-secret");
    expect(
      failures(observed, (route) => (expectedGated(route) ? 401 : 200)),
    ).toEqual([]);
  });

  it("admits every route with the secret", async () => {
    const observed = await statuses(SECRET);
    expect(failures(observed, () => 200)).toEqual([]);
  });

  it("closes every gated route while the secret is unset, and leaves the open ones open", async () => {
    for (const [unset, sent] of [
      [undefined, undefined],
      [undefined, "undefined"],
      ["", ""],
    ] as const) {
      CONFIG.TOOLS_SERVICE_API_SECRET = unset;
      const observed = await statuses(sent);
      expect(
        failures(observed, (route) => (expectedGated(route) ? 503 : 200)),
      ).toEqual([]);
    }
  });

  it("names only routes that exist, and every entry of the guard covers one", () => {
    for (const key of MIXED_GATED) expect(ROUTE_KEYS.has(key), key).toBe(true);
    for (const entry of GATED_ROUTES) {
      const covered = ROUTES.filter((route) =>
        entry.family
          ? route.path === entry.path || route.path.startsWith(`${entry.path}/`)
          : route.path === entry.path,
      );
      expect(covered.filter(expectedGated), entry.path).not.toEqual([]);
      expect(entry.reason, entry.path).not.toBe("");
    }
  });

  it("keeps open what other fleet apps call", async () => {
    const observed = await statusesWithoutSecret();
    for (const [app, routes] of Object.entries(FLEET_ROUTES)) {
      for (const key of routes) {
        expect(ROUTE_KEYS.has(key), `${app}: ${key}`).toBe(true);
        expect(observed.get(key), `${app}: ${key}`).toBe(200);
      }
    }
  });

  it("keeps open every URL handed to browsers and Discord to load", async () => {
    // Embeds and renders built with buildLocalUrl, and Spotify's OAuth
    // redirect: their loaders cannot send a header.
    const loaded = new Set(["GET /music/spotify/auth/callback"]);
    const sourceFiles = readdirSync(SOURCE_ROOT, {
      recursive: true,
      encoding: "utf8",
    }).filter((file) => file.endsWith(".ts") && !file.includes("__tests__"));
    for (const file of sourceFiles) {
      const text = readFileSync(join(SOURCE_ROOT, file), "utf8");
      for (const [, path] of text.matchAll(/buildLocalUrl\(\s*"([^"]+)"/g)) {
        loaded.add(`GET /${path}`);
      }
    }
    expect(loaded.size).toBeGreaterThan(15);
    const observed = await statusesWithoutSecret();
    for (const key of loaded) {
      expect(ROUTE_KEYS.has(key), key).toBe(true);
      expect(observed.get(key), key).toBe(200);
    }
  });

  it("guards every spelling of a gated path that reaches its handler", async () => {
    for (const [method, path] of [
      ["post", "/AGENTIC/command/run"],
      ["post", "/agentic/command/run/"],
      ["post", "/Compute/Shell/Execute"],
      ["post", "/utility/python/execute/"],
      ["get", "/AGENTS"],
      ["post", "/LIGHTS/state"],
      ["get", "/mcp/SSE"],
    ] as const) {
      expect(
        (await request(server)[method](path)).status,
        `${method} ${path}`,
      ).toBe(401);
    }
  });
});

// ─── The guard in front of the real routers ───────────────────────

describe("the guard in front of the real routers", () => {
  const app = express();
  app.use(express.json());
  mountToolsSecretGuard(app);
  for (const { path, router } of MOUNTS) app.use(path, router);

  it("runs a gated handler only for the secret", async () => {
    for (const path of [
      "/agentic/command/allowed",
      "/agents",
      "/admin/tool-schemas/disabled",
      "/compute/js/info",
      "/compute/shell/binaries",
    ]) {
      expect((await request(app).get(path)).status, path).toBe(401);
      expect(
        (await request(app).get(path).set("x-api-secret", "wrong")).status,
        path,
      ).toBe(401);
      expect(
        (await request(app).get(path).set("x-api-secret", SECRET)).status,
        path,
      ).toBe(200);
    }
  });

  it("answers a refused caller with the reason, and an unconfigured service with 503", async () => {
    const refused = await request(app)
      .post("/compute/shell/execute")
      .send({ command: "id" });
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({
      error: "This route needs the tools-service secret in x-api-secret.",
      code: "UNAUTHENTICATED",
    });
    CONFIG.TOOLS_SERVICE_API_SECRET = undefined;
    const closed = await request(app)
      .post("/compute/shell/execute")
      .set("x-api-secret", "")
      .send({ command: "id" });
    expect(closed.status).toBe(503);
    expect(closed.body.code).toBe("SECRET_NOT_CONFIGURED");
  });

  it("lets a gated write reach its own checks only with the secret", async () => {
    // Outside a Discord conversation the handler refuses on its own (403).
    const body = { nickname: "Lupos" };
    expect(
      (await request(app).post("/discord/guild/nickname").send(body)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/discord/guild/nickname")
          .set("x-api-secret", SECRET)
          .send(body)
      ).status,
    ).toBe(403);
  });

  it("answers open routes without a secret", async () => {
    expect((await request(app).get("/compute/uuid")).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/compute/json/transform")
          .send({ data: [3, 1, 2] })
      ).status,
    ).toBe(200);
    // Missing url: the handler's own 400, not the guard's 401.
    expect((await request(app).get("/utility/scrape/metadata")).status).toBe(
      400,
    );
  });
});
