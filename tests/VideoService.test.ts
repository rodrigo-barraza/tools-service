import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import computeRoutes from "../src/routes/ComputeRoutes.ts";
import { checkFfmpegAvailability } from "../src/services/VideoService.ts";
import { ALLOWED_ROOTS } from "../src/services/AgenticFileService.ts";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const expressApp = createTestApp("/compute", computeRoutes);

describe("VideoService & POST /compute/video/gif", () => {
  const testRootDirectory = "/tmp/video-gif-test";
  const dummyVideoPath = path.join(testRootDirectory, "dummy-video.mp4");

  beforeAll(async () => {
    if (!ALLOWED_ROOTS.includes(testRootDirectory)) {
      ALLOWED_ROOTS.push(testRootDirectory);
    }
    if (!existsSync(testRootDirectory)) {
      mkdirSync(testRootDirectory, { recursive: true });
    }
    // Write a tiny 1-byte file to mock local file presence
    await fs.writeFile(dummyVideoPath, "MOCK VIDEO DATA");
  });

  afterAll(async () => {
    await fs.unlink(dummyVideoPath).catch(() => {});
    await fs.rmdir(testRootDirectory).catch(() => {});
  });

  it("checks ffmpeg availability in the environment", async () => {
    const status = await checkFfmpegAvailability();
    expect(typeof status.available).toBe("boolean");
  });

  it("returns 400 when the video input is missing", async () => {
    const expressResponse = await request(expressApp)
      .post("/compute/video/gif")
      .send({ quality: "high" });

    expect(expressResponse.status).toBe(400);
    expect(expressResponse.body.error).toContain("input");
  });

  it("fails local path validation if directory is outside allowlist sandbox", async () => {
    const expressResponse = await request(expressApp)
      .post("/compute/video/gif")
      .send({
        input: "/etc/shadow",
      });

    expect(expressResponse.status).toBe(400);
    expect(expressResponse.body.error).toContain("validation");
  });
});
