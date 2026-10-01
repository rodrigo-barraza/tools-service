import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/PrismService.ts", () => ({
  default: {
    getSettings: vi.fn().mockResolvedValue({}),
    soundEffect: vi.fn(),
  },
}));

vi.mock("../src/services/MinioService.ts", () => ({
  default: {
    uploadToolAsset: vi.fn().mockResolvedValue("https://files.example/sfx.mp3"),
  },
}));

import PrismService from "../src/services/PrismService.ts";
import creativeRoutes from "../src/routes/CreativeRoutes.ts";
import { createTestApp } from "./testApp.ts";

const app = createTestApp("/creative", creativeRoutes);

describe("POST /creative/sound-effect", () => {
  beforeEach(() => {
    vi.mocked(PrismService.soundEffect).mockReset();
    vi.mocked(PrismService.soundEffect).mockResolvedValue({
      audioBase64: Buffer.from("mp3-bytes").toString("base64"),
      contentType: "audio/mpeg",
    });
  });

  it("returns the clip as audio the agent harness attaches, hosted for display", async () => {
    const response = await request(app)
      .post("/creative/sound-effect")
      .send({ prompt: "  lone wolf howling across a frozen valley  ", durationSeconds: 4 })
      .expect(200);

    expect(PrismService.soundEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "lone wolf howling across a frozen valley",
        durationSeconds: 4,
        loop: undefined,
      }),
    );
    expect(response.body.success).toBe(true);
    expect(response.body.audio).toEqual({
      data: Buffer.from("mp3-bytes").toString("base64"),
      mimeType: "audio/mpeg",
    });
    expect(response.body.durationSeconds).toBe(4);
    // The hosted URL is what Prism reuses as the result's audioRef.
    expect(response.body.display).toMatchObject({
      kind: "audio",
      url: "https://files.example/sfx.mp3",
    });
  });

  it("coerces a string duration and a string loop flag from a model", async () => {
    await request(app)
      .post("/creative/sound-effect")
      .send({ prompt: "rain on a tin roof", durationSeconds: "12", loop: "true" })
      .expect(200);

    expect(PrismService.soundEffect).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 12, loop: true }),
    );
  });

  it("rejects a missing prompt", async () => {
    const response = await request(app)
      .post("/creative/sound-effect")
      .send({ durationSeconds: 3 })
      .expect(400);

    expect(response.body.error).toContain("prompt");
    expect(PrismService.soundEffect).not.toHaveBeenCalled();
  });

  it("rejects a duration outside 0.5–30 seconds", async () => {
    for (const durationSeconds of [0.2, 31, "long"]) {
      const response = await request(app)
        .post("/creative/sound-effect")
        .send({ prompt: "thunder", durationSeconds })
        .expect(400);
      expect(response.body.error).toContain("durationSeconds");
    }
    expect(PrismService.soundEffect).not.toHaveBeenCalled();
  });

  it("reports a Prism failure as a tool error", async () => {
    vi.mocked(PrismService.soundEffect).mockRejectedValue(
      new Error("Prism API error: 401 quota_exceeded"),
    );

    const response = await request(app)
      .post("/creative/sound-effect")
      .send({ prompt: "explosion" })
      .expect(500);

    expect(response.body.error).toContain("Sound effect failed");
    expect(response.body.error).toContain("quota_exceeded");
  });
});
