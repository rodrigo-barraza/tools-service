// ─── Prism User Token ─────────────────────────────────────────────
// prism-service's x-prism-user-token rides a request only as far as this
// service's own calls back into Prism: they speak as that user
// (`Authorization: Bearer`) instead of with the service secret — one or
// the other — and without a token, with the secret. The token is taken off
// the request, is logged and stored nowhere, and every request keeps its
// own, however their awaits interleave.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import express from "express";
import request from "supertest";
import { createAuthMiddleware } from "@rodrigo-barraza/utilities-library/service";
import { DEFAULT_USERNAME } from "@rodrigo-barraza/utilities-library/taxonomy";

// What the request and tool-call loggers would store: Mongo stands in here.
const persisted: unknown[] = [];
vi.mock(
  "@rodrigo-barraza/utilities-library/service/mongo",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const collection = new Proxy(
      {},
      {
        get: (_target, method) =>
          method === "insertOne"
            ? async (document: unknown) => {
                persisted.push(document);
              }
            : async () => null,
      },
    );
    return { ...actual, getDatabase: () => ({ collection: () => collection }) };
  },
);

import CONFIG from "../src/config.ts";
import logger from "../src/logger.ts";
import {
  PRISM_USER_TOKEN_HEADER,
  prismUserTokenMiddleware,
} from "../src/middleware/PrismUserTokenMiddleware.ts";
import { requestLoggerMiddleware } from "../src/middleware/RequestLoggerMiddleware.ts";
import { toolCallLoggerMiddleware } from "../src/middleware/ToolCallLoggerMiddleware.ts";
import agenticRoutes from "../src/routes/AgenticRoutes.ts";
import { agenticScheduleCreate } from "../src/services/AgenticSchedulerService.ts";
import PrismService from "../src/services/PrismService.ts";
import { executeTool } from "../src/services/McpAdapter.ts";

const PRISM_SECRET = "prism-service-secret-for-tests";
const TOOLS_SECRET = "tools-service-secret-for-tests";
const TOKEN_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyb2RyaWdvIn0.signature-of-a";
const TOKEN_B = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzb21lb25lIn0.signature-of-b";
const ORIGINAL = {
  url: CONFIG.PRISM_SERVICE_URL,
  prism: CONFIG.PRISM_SERVICE_API_SECRET,
  tools: CONFIG.TOOLS_SERVICE_API_SECRET,
};
CONFIG.PRISM_SERVICE_URL = "http://prism.test";

/** Every call made to Prism (or back into this service): where, with what. */
interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}
let sent: Sent[] = [];
let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  CONFIG.PRISM_SERVICE_API_SECRET = PRISM_SECRET;
  CONFIG.TOOLS_SERVICE_API_SECRET = TOOLS_SECRET;
  sent = [];
  persisted.length = 0;
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      sent.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body,
      });
      if (body.name === "refused") {
        return Response.json(
          { error: "Invalid or expired token" },
          { status: 401 },
        );
      }
      return Response.json(
        init?.method === "GET" ? [] : { id: "task-1", name: body.name ?? null },
      );
    });
});
afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});
afterAll(() => {
  CONFIG.PRISM_SERVICE_URL = ORIGINAL.url;
  CONFIG.PRISM_SERVICE_API_SECRET = ORIGINAL.prism;
  CONFIG.TOOLS_SERVICE_API_SECRET = ORIGINAL.tools;
});

/** The middleware in server.ts's order, the agentic routes, and a few probes. */
function createApp() {
  const app = express();
  app.use(prismUserTokenMiddleware);
  app.use(express.json());
  app.use(requestLoggerMiddleware);
  app.use(toolCallLoggerMiddleware);
  app.use(
    createAuthMiddleware({
      defaultUsername: DEFAULT_USERNAME,
      traceContext: true,
    }),
  );
  app.use("/agentic", agenticRoutes);
  // What a handler still sees of the request.
  app.get("/headers", (req, res) => {
    res.json({
      header: req.headers[PRISM_USER_TOKEN_HEADER] ?? null,
      raw: req.rawHeaders,
    });
  });
  // The shared Prism client, as the creative routes use it.
  app.post("/speak", async (_req, res) => {
    await PrismService.textToSpeech({ text: "hello" });
    res.json({ ok: true });
  });
  // Schedules after waiting: the requests' awaits interleave.
  app.post("/schedule-later", async (req, res) => {
    await new Promise((resolve) =>
      setTimeout(resolve, Number(req.body.waitMs)),
    );
    res.json(
      await agenticScheduleCreate({
        project: "p",
        name: req.body.name,
        prompt: "do",
        type: "once",
      }),
    );
  });
  // A tool run through the MCP adapter for this turn.
  app.post("/mcp-tool", async (_req, res) => {
    res.json(
      await executeTool(
        "execute_command",
        { method: "POST", path: "/agentic/command/run" },
        { command: "ls" },
      ),
    );
  });
  return app;
}

const createTask = (app: express.Express, name: string, token?: string) => {
  const call = request(app)
    .post("/agentic/scheduled-task/create")
    .send({ project: "p", name, prompt: "do", type: "once" });
  return token ? call.set(PRISM_USER_TOKEN_HEADER, token) : call;
};

describe("calls back into prism-service", () => {
  it("speak as the user when prism-service sent a token, with the bearer alone", async () => {
    const response = await createTask(createApp(), "nightly", TOKEN_A);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("http://prism.test/scheduled-tasks");
    expect(sent[0].headers.get("authorization")).toBe(`Bearer ${TOKEN_A}`);
    expect(sent[0].headers.has("x-api-secret")).toBe(false);
  });

  it("carry the service secret when no token came", async () => {
    await createTask(createApp(), "nightly");
    expect(sent[0].headers.get("x-api-secret")).toBe(PRISM_SECRET);
    expect(sent[0].headers.has("authorization")).toBe(false);
  });

  it("go the same way through the shared Prism client", async () => {
    const app = createApp();
    await request(app)
      .post("/speak")
      .set(PRISM_USER_TOKEN_HEADER, TOKEN_B)
      .expect(200);
    await request(app).post("/speak").expect(200);
    expect(sent.map(({ url }) => url)).toEqual([
      "http://prism.test/text-to-audio",
      "http://prism.test/text-to-audio",
    ]);
    expect(sent[0].headers.get("authorization")).toBe(`Bearer ${TOKEN_B}`);
    expect(sent[0].headers.has("x-api-secret")).toBe(false);
    expect(sent[1].headers.get("x-api-secret")).toBe(PRISM_SECRET);
    expect(sent[1].headers.has("authorization")).toBe(false);
  });

  it("keep each request's own token while their awaits interleave", async () => {
    const app = createApp();
    // alpha waits longest, so beta and gamma start and finish inside its wait
    await Promise.all([
      request(app)
        .post("/schedule-later")
        .set(PRISM_USER_TOKEN_HEADER, TOKEN_A)
        .send({ name: "alpha", waitMs: 80 }),
      request(app)
        .post("/schedule-later")
        .set(PRISM_USER_TOKEN_HEADER, TOKEN_B)
        .send({ name: "beta", waitMs: 0 }),
      request(app).post("/schedule-later").send({ name: "gamma", waitMs: 40 }),
    ]);
    const byName = Object.fromEntries(
      sent.map(({ body, headers }) => [body.name, headers]),
    );
    expect(sent.map(({ body }) => body.name)).toEqual([
      "beta",
      "gamma",
      "alpha",
    ]);
    expect(byName.alpha.get("authorization")).toBe(`Bearer ${TOKEN_A}`);
    expect(byName.beta.get("authorization")).toBe(`Bearer ${TOKEN_B}`);
    expect(byName.gamma.has("authorization")).toBe(false);
    expect(byName.gamma.get("x-api-secret")).toBe(PRISM_SECRET);
  });
});

describe("the token", () => {
  it("is taken off the request before any handler", async () => {
    const response = await request(createApp())
      .get("/headers")
      .set(PRISM_USER_TOKEN_HEADER, TOKEN_A);
    expect(response.body.header).toBeNull();
    expect(JSON.stringify(response.body.raw)).not.toContain(TOKEN_A);
  });

  it("goes back into this service with an MCP tool of the same turn", async () => {
    await request(createApp())
      .post("/mcp-tool")
      .set(PRISM_USER_TOKEN_HEADER, TOKEN_A)
      .expect(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].url.endsWith("/agentic/command/run")).toBe(true);
    expect(sent[0].headers.get(PRISM_USER_TOKEN_HEADER)).toBe(TOKEN_A);
    expect(sent[0].headers.get("x-api-secret")).toBe(TOOLS_SECRET);
  });

  it("appears in no log line and no stored log, accepted or refused", async () => {
    const logged: unknown[][] = [];
    for (const [name, method] of Object.entries(logger)) {
      if (typeof method === "function") {
        vi.spyOn(
          logger as unknown as Record<string, (...args: unknown[]) => void>,
          name,
        ).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        });
      }
    }
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }

    const app = createApp();
    const accepted = await createTask(app, "nightly", TOKEN_A);
    const refused = await createTask(app, "refused", TOKEN_A);
    // The loggers write on "finish", after the response.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(refused.body.error).toBe("Invalid or expired token");
    expect(logged.length).toBeGreaterThan(0);
    expect(persisted.length).toBeGreaterThan(0);
    for (const output of [logged, persisted, accepted.body, refused.body]) {
      expect(JSON.stringify(output)).not.toContain(TOKEN_A);
    }
  });
});
