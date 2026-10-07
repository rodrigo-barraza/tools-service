// ─── URLs and Paths a Model Supplies ──────────────────────────────
// The gated tools that fetch a model's URL — image, video and audio
// inputs, speech-to-text, the /agentic/web readers, Python input files,
// webhooks, video downloads — reach public addresses, plus this fleet's
// own services at their exact configured origins (so one tool's hosted
// media can feed the next). A redirect from one of ours to a private
// address is refused. An audio path is read only where every read tool
// may read; anything else is a 400.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import CONFIG from "../src/config.ts";
import {
  fetchPublicOrOwnUrl,
  ownServiceOrigins,
} from "../src/fetchers/web/SsrfGuard.ts";
import { resolveInput } from "../src/services/ImageService.ts";
import {
  AudioSourceError,
  resolveAudioInput,
} from "../src/services/AudioInputService.ts";
import { readPdfUrl } from "../src/fetchers/web/PdfFetcher.ts";
import { readCsvSource } from "../src/fetchers/web/CsvFetcher.ts";
import { agenticFetchUrl } from "../src/services/AgenticWebService.ts";
import { sendWebhook } from "../src/fetchers/utility/NotificationFetcher.ts";
import { downloadVideo } from "../src/fetchers/web/GenericVideoFetcher.ts";
import { prismTempRoot } from "../src/services/tasks/TaskEngine.ts";
import creativeRoutes from "../src/routes/CreativeRoutes.ts";
import { createTestApp } from "./testApp.ts";

// Six of our own services: one local server each, on its own port.
const OWN_KEYS = [
  "TOOLS_SERVICE_URL",
  "TOOLS_SERVICE_PUBLIC_URL",
  "PRISM_SERVICE_URL",
  "PRISM_SERVICE_PUBLIC_URL",
  "MINIO_ENDPOINT",
  "MINIO_PUBLIC_URL",
] as const;
type OwnKey = (typeof OWN_KEYS)[number];
const ORIGINAL = Object.fromEntries(OWN_KEYS.map((key) => [key, CONFIG[key]]));

const hits: string[] = [];
const servers: http.Server[] = [];
const own = {} as Record<OwnKey, string>;
let privatePort = 0; // 127.0.0.2, ours by no configuration

function listen(host: string, handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, host, () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

beforeAll(async () => {
  privatePort = await listen("127.0.0.2", (req, res) => {
    hits.push(`private ${req.url}`);
    res.end("an internal service");
  });
  for (const key of OWN_KEYS) {
    const port = await listen("127.0.0.1", (req, res) => {
      hits.push(`${key} ${req.url}`);
      if (req.url === "/to-private") {
        res.statusCode = 302;
        res.setHeader("location", `http://127.0.0.2:${privatePort}/secret`);
        res.end();
        return;
      }
      if (req.url === "/to-minio") {
        res.statusCode = 302;
        res.setHeader("location", `${own.MINIO_PUBLIC_URL}/media.bin`);
        res.end();
        return;
      }
      res.setHeader("content-type", "text/csv");
      res.end("name,value\nmedia,1\n");
    });
    own[key] = `http://127.0.0.1:${port}`;
    CONFIG[key] =
      key === "MINIO_PUBLIC_URL" ? `${own[key]}/artifacts-bucket` : own[key];
  }
});

afterEach(() => {
  hits.length = 0;
});

afterAll(async () => {
  for (const key of OWN_KEYS) CONFIG[key] = ORIGINAL[key];
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("our own services", () => {
  it("are the exact origins configured for them, read at call time", () => {
    expect([...ownServiceOrigins()].sort()).toEqual(Object.values(own).sort());
  });

  it("each pass, though their addresses are private", async () => {
    for (const key of OWN_KEYS) {
      const response = await fetchPublicOrOwnUrl(`${own[key]}/media.bin`);
      expect(response.status, key).toBe(200);
      expect(await response.text(), key).toBe("name,value\nmedia,1\n");
    }
    expect(hits).toHaveLength(OWN_KEYS.length);
  });

  it("feed the media tools", async () => {
    expect(
      (
        await resolveAudioInput(
          `${own.MINIO_PUBLIC_URL}/artifacts-bucket/a.mp3`,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await resolveInput(
          `${own.TOOLS_SERVICE_PUBLIC_URL}/compute/image/render?id=x`,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await readCsvSource(`${own.PRISM_SERVICE_URL}/files/table.csv`),
    ).not.toHaveProperty("error");
  });

  it("may redirect to one another, not to a private address", async () => {
    const chained = await fetchPublicOrOwnUrl(
      `${own.TOOLS_SERVICE_URL}/to-minio`,
    );
    expect(chained.status).toBe(200);
    expect(chained.url.startsWith(own.MINIO_PUBLIC_URL)).toBe(true);

    for (const key of OWN_KEYS) {
      await expect(
        fetchPublicOrOwnUrl(`${own[key]}/to-private`),
        key,
      ).rejects.toThrow(/Blocked private\/internal address: 127\.0\.0\.2/);
    }
    expect(hits.filter((hit) => hit.startsWith("private"))).toEqual([]);
  });

  it("do not extend to another port, scheme or path-alike on the same host", async () => {
    for (const url of [
      `http://127.0.0.1:${privatePort}/x`, // same host, another port
      own.TOOLS_SERVICE_URL.replace("http:", "https:") + "/x", // another scheme
      `http://127.0.0.2:${privatePort}/secret`,
    ]) {
      await expect(fetchPublicOrOwnUrl(url), url).rejects.toThrow(/Blocked/);
    }
  });
});

describe("a model's LAN URL", () => {
  const lan = (path: string) => `http://127.0.0.2:${privatePort}${path}`;

  it("is refused by every tool that fetches one", async () => {
    await expect(resolveInput(lan("/photo.png"))).rejects.toThrow(/Blocked/);
    await expect(resolveAudioInput(lan("/song.mp3"))).rejects.toThrow(
      AudioSourceError,
    );
    expect(await readPdfUrl(lan("/doc.pdf"))).toMatchObject({
      error: expect.stringContaining("Blocked"),
    });
    expect(await readCsvSource(lan("/table.csv"))).toMatchObject({
      error: expect.stringContaining("Blocked"),
    });
    expect(await agenticFetchUrl(lan("/admin"))).toMatchObject({
      error: expect.stringContaining("Blocked"),
    });
    await expect(
      sendWebhook({ url: lan("/hook"), payload: {} }),
    ).rejects.toThrow(/Blocked/);
    // Webhooks never chain media: even our own services are refused there.
    await expect(
      sendWebhook({ url: `${own.TOOLS_SERVICE_URL}/hook`, payload: {} }),
    ).rejects.toThrow(/Blocked/);
    // yt-dlp fetches by itself: the URL is refused before it starts.
    expect(await downloadVideo("http://192.168.1.10/video.mp4")).toMatchObject({
      error: expect.stringContaining("Blocked"),
    });
    expect(hits.filter((hit) => hit.startsWith("private"))).toEqual([]);
  });

  it("is a 400 from speech-to-text and remix-audio", async () => {
    const app = createTestApp("/creative", creativeRoutes);
    const transcribe = await request(app)
      .post("/creative/speech-to-text")
      .send({ audioUrl: lan("/speech.mp3") });
    expect(transcribe.status).toBe(400);
    expect(transcribe.body.error).toContain("Blocked");
    const remix = await request(app)
      .post("/creative/remix-audio")
      .send({ input: lan("/song.mp3"), operations: [{ type: "reverse" }] });
    expect(remix.status).toBe(400);
    expect(remix.body.error).toContain("Blocked");
  });
});

describe("an audio path", () => {
  const ownDirectory = join(prismTempRoot(), "model-url-guard-test");
  beforeAll(() => {
    mkdirSync(ownDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(ownDirectory, "clip.bin"),
      Buffer.from("RIFF-not-really-audio"),
    );
  });
  afterAll(() => rmSync(ownDirectory, { recursive: true, force: true }));

  it("is read under this service's own temp root", async () => {
    const buffer = await resolveAudioInput(join(ownDirectory, "clip.bin"));
    expect(buffer.toString()).toBe("RIFF-not-really-audio");
  });

  it("is refused anywhere else", async () => {
    for (const path of [
      "/etc/passwd",
      "/proc/self/environ",
      join(ownDirectory, "../../etc/hostname"),
    ]) {
      await expect(resolveAudioInput(path), path).rejects.toThrow(
        /Audio path not allowed/,
      );
    }
  });

  it("outside the allowed directories is a 400 from remix-audio", async () => {
    const app = createTestApp("/creative", creativeRoutes);
    const response = await request(app)
      .post("/creative/remix-audio")
      .send({ input: "/etc/passwd", operations: [{ type: "reverse" }] });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Audio path not allowed");
  });
});
