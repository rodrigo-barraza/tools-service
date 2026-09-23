import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  installTraceContextForwarding,
  parseTraceparent,
  traceContextMiddleware,
} from "../src/middleware/TraceContextMiddleware.ts";

/**
 * TraceContextForwarding — prism-service's W3C trace context (`traceparent`,
 * `tracestate`) on a tool call rides on every fetch tools-service makes while
 * serving it, so the tool's own calls stay in the caller's trace.
 */

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACESTATE = "rojo=00f067aa0ba902b7,congo=t61rcWkgMzE";

const upstreamFetch = vi.fn(async () => new Response("{}", { status: 200 }));
const originalFetch = globalThis.fetch;

/** Headers of the n-th request the tool made upstream. */
const sentHeaders = (call = 0) =>
  new Headers((upstreamFetch.mock.calls[call] as unknown as [unknown, RequestInit])[1]?.headers);

function createToolApp() {
  const app = express();
  app.use(traceContextMiddleware);
  app.use(express.json());
  // A tool that calls out, the way the domain fetchers do — after an await.
  app.get("/tool", async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await fetch("https://api.example.com/data", { headers: { Accept: "application/json" } });
    res.json({ ok: true });
  });
  app.get("/tool-with-own-context", async (_req, res) => {
    await fetch("https://api.example.com/data", {
      headers: { traceparent: "00-11111111111111111111111111111111-2222222222222222-01" },
    });
    res.json({ ok: true });
  });
  app.get("/tool-with-request-object", async (_req, res) => {
    await fetch(new Request("https://api.example.com/data", { headers: { "X-Api-Key": "k" } }));
    res.json({ ok: true });
  });
  return app;
}

describe("trace context forwarding", () => {
  let app: express.Express;

  beforeAll(() => {
    globalThis.fetch = upstreamFetch as unknown as typeof fetch;
    installTraceContextForwarding();
    app = createToolApp();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    upstreamFetch.mockClear();
  });

  it("forwards the caller's traceparent and tracestate on the tool's outgoing calls", async () => {
    await request(app)
      .get("/tool")
      .set("traceparent", TRACEPARENT)
      .set("tracestate", TRACESTATE)
      .expect(200);

    const headers = sentHeaders();
    expect(headers.get("traceparent")).toBe(TRACEPARENT);
    expect(headers.get("tracestate")).toBe(TRACESTATE);
    expect(headers.get("accept")).toBe("application/json");
  });

  it("adds nothing for a request without trace context", async () => {
    await request(app).get("/tool").expect(200);

    expect(sentHeaders().has("traceparent")).toBe(false);
    expect(sentHeaders().get("accept")).toBe("application/json");
  });

  it.each([
    ["garbage", "not-a-traceparent"],
    ["an all-zero trace id", "00-00000000000000000000000000000000-00f067aa0ba902b7-01"],
    ["an all-zero parent id", "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"],
    ["the forbidden version ff", "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"],
    ["uppercase hex", "00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01"],
  ])("forwards no trace context from %s", async (_case, traceparent) => {
    await request(app)
      .get("/tool")
      .set("traceparent", traceparent)
      .set("tracestate", TRACESTATE)
      .expect(200);

    expect(sentHeaders().has("traceparent")).toBe(false);
    expect(sentHeaders().has("tracestate")).toBe(false);
  });

  it("leaves a traceparent the tool set itself alone", async () => {
    await request(app).get("/tool-with-own-context").set("traceparent", TRACEPARENT).expect(200);

    expect(sentHeaders().get("traceparent")).toBe(
      "00-11111111111111111111111111111111-2222222222222222-01",
    );
  });

  it("keeps a Request object's own headers", async () => {
    await request(app).get("/tool-with-request-object").set("traceparent", TRACEPARENT).expect(200);

    expect(sentHeaders().get("traceparent")).toBe(TRACEPARENT);
    expect(sentHeaders().get("x-api-key")).toBe("k");
  });

  it("forwards nothing outside a request", async () => {
    await fetch("https://api.example.com/collector");

    expect(sentHeaders().has("traceparent")).toBe(false);
  });

  it("parses only a valid version-00 traceparent", () => {
    expect(parseTraceparent(TRACEPARENT)).toBe(TRACEPARENT);
    expect(parseTraceparent(`  ${TRACEPARENT} `)).toBe(TRACEPARENT);
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(["a", "b"])).toBeNull();
  });
});
