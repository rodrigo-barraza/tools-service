import { describe, it, expect, vi, beforeAll } from "vitest";

// These tests feed documents through a stubbed global fetch. The SSRF
// guard's own transport and rules are tested in ModelUrlGuard.test.ts.
vi.mock("../src/fetchers/web/SsrfGuard.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/fetchers/web/SsrfGuard.ts")>()),
  fetchPublicOrOwnUrl: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}));
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import { Express } from "express";

// ═══════════════════════════════════════════════════════════════
// read_csv — /agentic/web/csv-read Endpoint Tests
//
// Unit coverage for the parser/profiler lives in
// src/fetchers/web/__tests__/CsvFetcher.test.ts; this file covers
// the Express route contract (param validation, URL fetch path,
// data: URI path, sentinel error).
// ═══════════════════════════════════════════════════════════════

const SAMPLE_CSV = "name,score\nAda,90\nGrace,95\nLinus,88";

function toDataUri(csv: string): string {
  return `data:text/csv;base64,${Buffer.from(csv, "utf-8").toString("base64")}`;
}

describe("Web CSV Read Endpoint", () => {
  let expressApp: Express;

  beforeAll(async () => {
    const { default: router } = await import("../src/routes/AgenticRoutes.ts");
    expressApp = createTestApp("/agentic", router);
  });

  it("returns 400 when source is missing", async () => {
    const response = await request(expressApp)
      .post("/agentic/web/csv-read")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Request body must include 'source'");
  });

  it("profiles a CSV passed as a data: URI", async () => {
    const response = await request(expressApp)
      .post("/agentic/web/csv-read")
      .send({ source: toDataUri(SAMPLE_CSV) });

    expect(response.status).toBe(200);
    expect(response.body.headers).toEqual(["name", "score"]);
    expect(response.body.totalRows).toBe(3);
    expect(response.body.columns).toEqual([
      { name: "name", type: "string" },
      { name: "score", type: "number", min: 88, max: 95, mean: 91 },
    ]);
    expect(response.body.sampleRows[0]).toEqual({ name: "Ada", score: "90" });
  });

  it("fetches and profiles a CSV from a URL", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      // TextEncoder yields an exact-size ArrayBuffer (Buffer.from(...).buffer
      // would expose the whole shared pool slab)
      arrayBuffer: async () => new TextEncoder().encode("a;b\n1;2\n3;4").buffer,
    } as unknown as Response);

    const response = await request(expressApp)
      .post("/agentic/web/csv-read")
      .send({ source: "https://example.com/data.csv" });

    expect(response.status).toBe(200);
    expect(response.body.delimiterName).toBe("semicolon");
    expect(response.body.totalRows).toBe(2);
    expect(response.body.source).toBe("https://example.com/data.csv");
    fetchSpy.mockRestore();
  });

  it("passes delimiter, maxRows, and columns options through", async () => {
    const csv = "a|b|c\n" +
      Array.from({ length: 30 }, (_, index) => `${index}|x|y`).join("\n");
    const response = await request(expressApp)
      .post("/agentic/web/csv-read")
      .send({
        source: toDataUri(csv),
        delimiter: "|",
        maxRows: 3,
        columns: ["a"],
      });

    expect(response.status).toBe(200);
    expect(response.body.headers).toEqual(["a"]);
    expect(response.body.sampleRowCount).toBe(3);
    expect(response.body.totalRows).toBe(30);
    expect(response.body.sampleTruncated).toBe(true);
  });

  it("returns the standard re-attach error for the unresolved 'attached' sentinel", async () => {
    const response = await request(expressApp)
      .post("/agentic/web/csv-read")
      .send({ source: "attached" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("No attached document was found");
  });
});
