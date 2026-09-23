import { describe, it, expect } from "vitest";
import { declineOf } from "../ImageDecline.ts";
import PromptLocaleService from "../PromptLocaleService.ts";

// generate_image used to soften every miss three times and then tell the
// agent to "try a more specific prompt" — so a refused subject was redrawn
// up to five times. Prism now says why an image model drew nothing; only a
// content-policy block is worth softening, and every failure message tells
// the agent not to redraw the same request.

const image = { data: "aW1n", mimeType: "image/png" };

describe("declineOf", () => {
  it("is null when an image came back", () => {
    expect(declineOf({ images: [image] })).toBeNull();
  });

  it("softens a content-policy refusal", () => {
    expect(
      declineOf({ refusal: { category: "IMAGE_SAFETY", explanation: "Unable to show that." } }),
    ).toEqual({ category: "IMAGE_SAFETY", explanation: "Unable to show that.", softenable: true });
  });

  it("does not soften a decline rewording cannot change", () => {
    for (const category of ["NO_IMAGE", "IMAGE_RECITATION", "SPII", "IMAGE_OTHER"]) {
      expect(declineOf({ refusal: { category, explanation: null } })?.softenable).toBe(false);
    }
  });

  it("keeps the old softening for a Prism build that reports nothing", () => {
    expect(declineOf({})).toEqual({ category: "UNKNOWN", explanation: null, softenable: true });
    expect(declineOf({ safetyBlock: true })?.category).toBe("SAFETY");
  });

  it("uses the text an older Prism returned instead of an image as the explanation", () => {
    expect(declineOf({ text: " I can't draw real people. " })?.explanation).toBe(
      "I can't draw real people.",
    );
  });
});

describe("image failure messages", () => {
  const render = (key: string, reason: string, explanation = "") =>
    PromptLocaleService.get("en", `prompts.creative.image.${key}`, {
      attemptCount: "4",
      reason,
      explanation,
    });

  it("name the reason and tell the agent not to redraw the same request", () => {
    const refused = render("safety-block-error", "IMAGE_SAFETY");
    expect(refused).toContain("IMAGE_SAFETY");
    expect(refused).toContain("Do not call generate_image again");

    const declined = render("declined-error", "NO_IMAGE");
    expect(declined).toContain("NO_IMAGE");
    expect(declined).toContain("Do not call generate_image again");

    expect(render("no-image-error", "UNKNOWN")).not.toMatch(/more specific/i);
  });

  it("quote the image model's own explanation when there is one", () => {
    const explanation = PromptLocaleService.get("en", "prompts.creative.image.decline-explanation", {
      explanation: "Unable to show that.",
    });
    expect(render("declined-error", "NO_IMAGE", explanation)).toContain('"Unable to show that."');
    expect(render("declined-error", "NO_IMAGE")).not.toContain("{{");
  });
});
