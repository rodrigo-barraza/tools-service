import { describe, it, expect, vi } from "vitest";

// The Python input-file tests serve their files through a stubbed global
// fetch. The SSRF guard's own transport and rules are tested in
// ModelUrlGuard.test.ts; the open routes here keep the real guard.
vi.mock("../src/fetchers/web/SsrfGuard.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/fetchers/web/SsrfGuard.ts")>()),
  fetchPublicOrOwnUrl: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}));
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import utilityRoutes from "../src/routes/UtilityRoutes.ts";

// ─── Unit Tests for Utility Domain Endpoints ────────────────────

const app = createTestApp("/utility", utilityRoutes);

// ═══════════════════════════════════════════════════════════════════
//  Airports — in-memory CSV data
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/airports/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/utility/airports/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns airport search results", async () => {
    const res = await request(app).get(
      "/utility/airports/search?q=vancouver&limit=5",
    );
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.airports)).toBeTruthy();
    expect(res.body.airports[0].name).toBeTruthy();
    expect(res.body.airports[0].iataCode).toBeTruthy();
  });
});

describe("GET /utility/airports/code/:code", () => {
  it("returns airport data for YVR", async () => {
    const res = await request(app).get("/utility/airports/code/YVR");
    expect(res.status).toBe(200);
    expect(res.body.iataCode).toBe("YVR");
    expect(res.body.name).toBeTruthy();
    expect(res.body.city).toBeTruthy();
    expect(res.body.countryCode).toBeTruthy();
    expect(typeof res.body.latitude === "number").toBeTruthy();
    expect(typeof res.body.longitude === "number").toBeTruthy();
  });

  it("returns 404 for nonexistent code", async () => {
    const res = await request(app).get("/utility/airports/code/ZZZZZ");
    expect(res.status).toBe(404);
  });
});

describe("GET /utility/airports/country/:code", () => {
  it("returns airports for a country", async () => {
    const res = await request(app).get("/utility/airports/country/CA?limit=10");
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.airports)).toBeTruthy();
    expect(res.body.countryCode).toBe("CA");
  });
});

describe("GET /utility/airports/nearest", () => {
  it("returns 400 when lat/lng are missing", async () => {
    const res = await request(app).get("/utility/airports/nearest");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns nearest airports to Vancouver", async () => {
    const res = await request(app).get(
      "/utility/airports/nearest?lat=49.19&lng=-123.18&limit=3",
    );
    expect(res.status).toBe(200);
    expect(typeof res.body.count === "number").toBeTruthy();
    expect(res.body.count > 0).toBeTruthy();
    expect(Array.isArray(res.body.airports)).toBeTruthy();
    expect(typeof res.body.airports[0].distanceKm === "number").toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Currency — validation-only (external API)
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/currency/convert (validation)", () => {
  it("returns 400 when from/to are missing", async () => {
    const res = await request(app).get("/utility/currency/convert?amount=100");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /utility/currency/list", () => {
  it("returns available currencies", async () => {
    const currencyFetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        result: "success",
        base_code: "USD",
        time_last_update_utc: "Thu, 04 Jun 2026 00:00:00 +0000",
        time_next_update_utc: "Fri, 05 Jun 2026 00:00:00 +0000",
        rates: {
          USD: 1.0,
          CAD: 1.37,
          EUR: 0.92,
        },
      }),
    } as Response);

    const res = await request(app).get("/utility/currency/list");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.currencies).toEqual(["CAD", "EUR", "USD"]);

    currencyFetchSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Places — validation-only (external API)
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/places/nearby (validation)", () => {
  it("returns 400 when type is missing", async () => {
    const res = await request(app).get("/utility/places/nearby");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /utility/places/search (validation)", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/utility/places/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /utility/scrape/metadata (validation)", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app).get("/utility/scrape/metadata");
    expect(res.status).toBe(400);
  });
});

describe("POST /utility/python/execute", () => {
  it("returns 400 when code is missing", async () => {
    const res = await request(app).post("/utility/python/execute").send({});
    expect(res.status).toBe(400);
  });

  it("executes valid python code successfully", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: "print('Hello, World!')" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stdout.trim()).toBe("Hello, World!");
  });

  it("executes python code with imports successfully", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: "import math\nprint(math.sqrt(16))" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stdout.trim()).toBe("4.0");
  });

  it("allows all standard library imports inside the sandbox", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: "import subprocess\nprint(subprocess.run(['echo', 'hello'], capture_output=True, text=True).stdout.strip())" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stdout.trim()).toBe("hello");
  });

  it("returns execution failure on syntax error", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: "invalid python code!" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stderr).toContain("SyntaxError");
  });

  it("returns figure urls + display for matplotlib plots, without base64", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({
        code: "import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])\n",
        timeout: 60000,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.figures).toHaveLength(1);
    // MinIO is not configured in tests → local fallback endpoint
    expect(res.body.figures[0].url).toContain("/utility/python/figure?id=");
    expect(res.body.figures[0].data).toBeUndefined();
    expect(res.body.display?.kind).toBe("image");
    expect(res.body.display?.url).toBe(res.body.figures[0].url);
    expect(res.body.message).toContain("figure");
  }, 70000);

  it("serves stored figures from the fallback endpoint", async () => {
    const executed = await request(app)
      .post("/utility/python/execute")
      .send({
        code: "import matplotlib.pyplot as plt\nplt.bar(['a'], [1])\n",
        timeout: 60000,
      });
    expect(executed.body.figures).toHaveLength(1);
    const figureId = String(executed.body.figures[0].url).split("id=")[1];

    const figure = await request(app).get(
      `/utility/python/figure?id=${figureId}`,
    );
    expect(figure.status).toBe(200);
    expect(figure.headers["content-type"]).toContain("image/png");
    expect(figure.body.subarray(0, 4).toString("hex")).toBe("89504e47");
  }, 70000);

  it("returns 404 for unknown figure ids", async () => {
    const res = await request(app).get("/utility/python/figure?id=nope");
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  POST /utility/python/execute — inputFiles staging
// ═══════════════════════════════════════════════════════════════════

describe("POST /utility/python/execute — inputFiles", () => {
  const csvText = "name,score\nAda,90\nGrace,95";
  const csvDataUri = `data:text/csv;base64,${Buffer.from(csvText, "utf-8").toString("base64")}`;

  it("stages a data: URI file the code can open(), and lists it in the result", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({
        code: 'print(open("input_1.csv").read().splitlines()[0])',
        inputFiles: [csvDataUri],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stdout.trim()).toBe("name,score");
    expect(res.body.inputFiles).toEqual([
      { filename: "input_1.csv", bytes: csvText.length, mimeType: "text/csv" },
    ]);
  });

  it("stages a URL download under its basename before the code runs", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/csv" : null,
      },
      arrayBuffer: async () => new TextEncoder().encode(csvText).buffer,
    } as unknown as Response);

    const res = await request(app)
      .post("/utility/python/execute")
      .send({
        code: 'print(len(open("scores.csv").read()))',
        inputFiles: ["https://example.com/data/scores.csv"],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stdout.trim()).toBe(String(csvText.length));
    expect(res.body.inputFiles[0].filename).toBe("scores.csv");
    fetchSpy.mockRestore();
  });

  it("accepts a single string (normalized to an array)", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({
        code: 'print(open("input_1.csv").read().splitlines()[-1])',
        inputFiles: csvDataUri,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stdout.trim()).toBe("Grace,95");
  });

  it("returns 400 with the standard re-attach error for the unresolved 'attached' sentinel", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: 'print("hi")', inputFiles: ["attached"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No attached document was found");
  });

  it("returns 400 for non-string inputFiles entries", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: 'print("hi")', inputFiles: [{ url: "x" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("'inputFiles' must be");
  });

  it("fails the run without executing code for disallowed schemes", async () => {
    const res = await request(app)
      .post("/utility/python/execute")
      .send({ code: 'print("should not run")', inputFiles: ["file:///etc/passwd"] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.stdout).toBe("");
    expect(res.body.error).toContain("Unsupported scheme");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Iterative map building — GET /utility/map with mapId
// ═══════════════════════════════════════════════════════════════════

describe("GET /utility/map (iterative)", () => {
  const markersParam = (markers: unknown) =>
    encodeURIComponent(JSON.stringify(markers));

  it("adds markers to an existing map under the same mapId", async () => {
    const first = await request(app).get(
      `/utility/map?markers=${markersParam([
        { latitude: 49.28, longitude: -123.12, label: "Vancouver" },
      ])}`,
    );
    expect(first.status).toBe(200);
    expect(first.body.mapId).toBeTruthy();
    expect(first.body.markerCount).toBe(1);
    expect(first.body.message).toContain(first.body.mapId);

    const second = await request(app).get(
      `/utility/map?mapId=${first.body.mapId}&markers=${markersParam([
        { latitude: 47.6, longitude: -122.33, label: "Seattle" },
        { latitude: 45.5, longitude: -122.68, label: "Portland" },
      ])}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.mapId).toBe(first.body.mapId);
    expect(second.body.markerCount).toBe(3);
    expect(second.body.newMarkerCount).toBe(2);
    expect(second.body.mapEmbedUrl).toContain(first.body.mapId);
  });

  it("rejects an unknown mapId with recovery guidance", async () => {
    const response = await request(app).get(
      `/utility/map?mapId=does-not-exist&markers=${markersParam([
        { latitude: 1, longitude: 2 },
      ])}`,
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not found or expired");
    expect(response.body.error).toContain("Omit mapId");
  });

  it("rejects the literal string 'null' as mapId", async () => {
    const response = await request(app).get(
      `/utility/map?mapId=null&markers=${markersParam([
        { latitude: 1, longitude: 2 },
      ])}`,
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid mapId");
  });

  it("enforces the marker cap on the combined map", async () => {
    // Batches stay small enough for a GET query string (431 above ~16KB),
    // so the cap is reached by appending rather than in one call.
    const bulk = Array.from({ length: 180 }, () => ({
      latitude: 1,
      longitude: 1,
    }));
    const first = await request(app).get(
      `/utility/map?markers=${markersParam(bulk)}`,
    );
    expect(first.status).toBe(200);
    const second = await request(app).get(
      `/utility/map?mapId=${first.body.mapId}&markers=${markersParam(bulk)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.markerCount).toBe(360);
    const third = await request(app).get(
      `/utility/map?mapId=${first.body.mapId}&markers=${markersParam(bulk)}`,
    );
    expect(third.status).toBe(400);
    expect(third.body.error).toContain("max 500");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Iterative chart building — POST /utility/chart with chartId
// ═══════════════════════════════════════════════════════════════════

describe("POST /utility/chart (iterative)", () => {
  const baseChart = {
    type: "bar",
    title: "Revenue",
    labels: ["Q1", "Q2"],
    datasets: [{ label: "2025", data: [10, 20] }],
  };

  it("adds a new dataset by label under the same chartId", async () => {
    const first = await request(app).post("/utility/chart").send(baseChart);
    expect(first.status).toBe(200);
    expect(first.body.chartId).toBeTruthy();
    expect(first.body.datasetCount).toBe(1);
    expect(first.body.message).toContain(first.body.chartId);

    const second = await request(app)
      .post("/utility/chart")
      .send({
        type: "bar",
        chartId: first.body.chartId,
        datasets: [{ label: "2026", data: [15, 25] }],
      });
    expect(second.status).toBe(200);
    expect(second.body.chartId).toBe(first.body.chartId);
    expect(second.body.datasetCount).toBe(2);
    expect(second.body.labelCount).toBe(2); // labels kept from first call
  });

  it("replaces an existing dataset when the label matches", async () => {
    const first = await request(app).post("/utility/chart").send(baseChart);
    const second = await request(app)
      .post("/utility/chart")
      .send({
        type: "bar",
        chartId: first.body.chartId,
        datasets: [{ label: "2025", data: [11, 21] }], // same label → replace
      });
    expect(second.status).toBe(200);
    expect(second.body.datasetCount).toBe(1);
  });

  it("keeps title and labels when only datasets are sent", async () => {
    const first = await request(app).post("/utility/chart").send(baseChart);
    const second = await request(app)
      .post("/utility/chart")
      .send({
        type: "bar",
        chartId: first.body.chartId,
        datasets: [{ label: "2026", data: [1, 2] }],
      });
    expect(second.status).toBe(200);
    expect(second.body.labelCount).toBe(2);
  });

  it("validates merged datasets against effective labels", async () => {
    const first = await request(app).post("/utility/chart").send(baseChart);
    const second = await request(app)
      .post("/utility/chart")
      .send({
        type: "bar",
        chartId: first.body.chartId,
        datasets: [{ label: "2026", data: [1, 2, 3] }], // 3 points, 2 labels
      });
    expect(second.status).toBe(400);
    expect(second.body.error).toContain("2 labels");
  });

  it("rejects an unknown chartId with recovery guidance", async () => {
    const response = await request(app)
      .post("/utility/chart")
      .send({ ...baseChart, chartId: "does-not-exist" });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not found or expired");
    expect(response.body.error).toContain("Omit chartId");
  });

  it("still requires datasets when creating a new chart", async () => {
    const response = await request(app)
      .post("/utility/chart")
      .send({ type: "bar", labels: ["a"] });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("datasets");
  });
});
