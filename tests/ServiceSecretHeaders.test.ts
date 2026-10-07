// ─── Service Secrets on Outbound Calls ────────────────────────────
// prism-service admits a service only with PRISM_SERVICE_API_SECRET in
// x-api-secret: the shared client and every plain fetch to it send it. The
// MCP adapter's calls to this service's own gated routes carry the tools
// secret instead — and neither secret goes where the other belongs.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";
import CONFIG from "../src/config.ts";
import PrismService, {
  prismServiceAuthHeaders,
} from "../src/services/PrismService.ts";
import {
  agenticScheduleCreate,
  agenticScheduleDelete,
  agenticScheduleList,
  agenticTriggerFire,
} from "../src/services/AgenticSchedulerService.ts";
import agenticRoutes from "../src/routes/AgenticRoutes.ts";
import { executeTool } from "../src/services/McpAdapter.ts";
import { createTestApp } from "./testApp.ts";

const PRISM_SECRET = "prism-test-secret";
const TOOLS_SECRET = "tools-test-secret";
const ORIGINAL = {
  url: CONFIG.PRISM_SERVICE_URL,
  prism: CONFIG.PRISM_SERVICE_API_SECRET,
  tools: CONFIG.TOOLS_SERVICE_API_SECRET,
};

// The shared Prism client is built once, at its first call — configure first.
CONFIG.PRISM_SERVICE_URL = "http://prism.test";

let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  CONFIG.PRISM_SERVICE_API_SECRET = PRISM_SECRET;
  CONFIG.TOOLS_SERVICE_API_SECRET = TOOLS_SECRET;
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) =>
      Response.json(init?.method && init.method !== "GET" ? { ok: true } : []),
    );
});
afterEach(() => {
  fetchSpy.mockRestore();
});
afterAll(() => {
  CONFIG.PRISM_SERVICE_URL = ORIGINAL.url;
  CONFIG.PRISM_SERVICE_API_SECRET = ORIGINAL.prism;
  CONFIG.TOOLS_SERVICE_API_SECRET = ORIGINAL.tools;
});

/** Every fetch made so far: its URL and its headers. */
function calls(): Array<{ url: string; headers: Record<string, string> }> {
  return fetchSpy.mock.calls.map(([input, init]) => ({
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
  }));
}

function expectPrismSecretOnEveryCall(expectedCount: number) {
  const made = calls();
  expect(made).toHaveLength(expectedCount);
  for (const { url, headers } of made) {
    expect(url.startsWith("http://prism.test/"), url).toBe(true);
    expect(headers["x-api-secret"], url).toBe(PRISM_SECRET);
  }
}

describe("calls to prism-service", () => {
  it("the shared client sends the service secret", async () => {
    await PrismService.chat({ messages: [{ role: "user", content: "hi" }] });
    await PrismService.getSettings();
    expectPrismSecretOnEveryCall(2);
    expect(calls().map(({ url }) => url)).toEqual([
      "http://prism.test/chat?stream=false",
      "http://prism.test/settings",
    ]);
  });

  it("prismServiceAuthHeaders is the secret, or nothing while it is unset", () => {
    expect(prismServiceAuthHeaders()).toEqual({ "x-api-secret": PRISM_SECRET });
    CONFIG.PRISM_SERVICE_API_SECRET = undefined;
    expect(prismServiceAuthHeaders()).toEqual({});
  });

  it("every scheduled-task call sends it", async () => {
    await agenticScheduleCreate(
      { project: "p", name: "n", prompt: "do", type: "once" },
      "rodrigo",
    );
    await agenticScheduleList("p", {}, "rodrigo");
    await agenticScheduleDelete("p", "task-1", "rodrigo");
    await agenticTriggerFire("p", "trigger-1", {}, "rodrigo");
    expectPrismSecretOnEveryCall(4);
  });

  it("every agentic route that reaches Prism sends it", async () => {
    const app = createTestApp("/agentic", agenticRoutes);
    await request(app)
      .post("/agentic/memory/save")
      .send({ content: "remember this" })
      .expect(200);
    await request(app)
      .post("/agentic/custom-agent/create")
      .send({ name: "Helper" })
      .expect(201);
    await request(app).get("/agentic/custom-agent/list").expect(200);
    await request(app).get("/agentic/agent/list").expect(200);
    await request(app)
      .post("/agentic/custom-agent/update")
      .send({ id: "agent-1", name: "Helper" })
      .expect(200);
    expectPrismSecretOnEveryCall(5);
  });

  it("never carries the tools secret", async () => {
    await PrismService.chat({ messages: [{ role: "user", content: "hi" }] });
    await agenticScheduleList("p");
    for (const { headers } of calls()) {
      expect(Object.values(headers)).not.toContain(TOOLS_SECRET);
    }
  });
});

describe("the MCP adapter's calls to this service", () => {
  it("carry the tools secret to the gated routes", async () => {
    await executeTool(
      "execute_command",
      { method: "POST", path: "/agentic/command/run" },
      { command: "ls" },
    );
    await executeTool("get_current_weather", {
      method: "GET",
      path: "/weather/weather/current",
    });
    const made = calls();
    expect(made).toHaveLength(2);
    for (const { headers } of made) {
      expect(headers["x-api-secret"]).toBe(TOOLS_SECRET);
      expect(Object.values(headers)).not.toContain(PRISM_SECRET);
    }
  });

  it("carry no secret while it is unset", async () => {
    CONFIG.TOOLS_SERVICE_API_SECRET = undefined;
    await executeTool(
      "execute_command",
      { method: "POST", path: "/agentic/command/run" },
      { command: "ls" },
    );
    expect(calls()[0].headers["x-api-secret"]).toBeUndefined();
  });
});
