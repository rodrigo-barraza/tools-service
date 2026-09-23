import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import { IDENTITY_HEADERS, MODEL_IDS } from "@rodrigo-barraza/utilities-library/taxonomy";
import PromptLocaleService from "../services/PromptLocaleService.ts";
// ─── Image Generation & Vision ──────────────────────────────

import { type Request, type Response, Router } from "express";
import PrismService from "../services/PrismService.ts";
import { generateAudioWav, INSTRUMENT_PRESETS, noteToFreq } from "../services/SoundSynthesizerService.ts";
import { resolveAudioInput, decodeAudioToPcm } from "../services/AudioInputService.ts";
import { isSamplePresetRef, resolveSamplePreset, listSamplePresets } from "../services/SampleLibraryService.ts";
import { validateSynthesizerInput } from "../services/SoundSynthesizerValidation.ts";
import { processAudio, getAvailablePresets } from "../services/AudioRemixService.ts";
import { validateAudioRemixInput } from "../services/AudioRemixValidation.ts";
import {
  createTrackerSession,
  getTrackerSession,
  addTrackerChannel,
  writeTrackerPattern,
  toSynthesizerConfig,
  deleteTrackerSession,
  getActiveSessionCount,
  getAuthoredDurationSeconds,
  type TrackerChannelSample,
} from "../services/AudioTrackerSessionManager.ts";
import {
  validateVectorAnimationInput,
  validateMergedAnimation,
  normalizeEasing,
  findKeyframeBeyondDuration,
  type VectorLayer as VectorLayerInput,
  type VectorSymbolInput,
} from "../services/VectorAnimationValidation.ts";
import { synthesizeSpeech, getSupportedVoices, isEspeakAvailable } from "../services/TextToSpeechService.ts";
import {
  removeChromakeyBackground,
  resolveInput as resolveImageInput,
  parseDetectionJson,
  annotateDetections,
  parseSegmentationJson,
  applySegmentationMasks,
  toVisionDataUri,
} from "../services/ImageService.ts";
import { PersistentStore } from "../models/EmbedAsset.ts";
import {
  isUnresolvedAttachedSentinel,
  buildAttachedSentinelError,
} from "../services/AttachedMediaSentinel.ts";
import { imageStore } from "./ComputeRoutes.ts";
import MinioService from "../services/MinioService.ts";
import logger from "../logger.ts";
import { extractCallerContext, errorMessage, buildDisplay, buildLocalUrl, buildEmbedHtml, escapeHtml, sanitizeCssColor, toEmbedScriptJson } from "../utilities.ts";
import {
  saveVectorAnimation,
  getVectorAnimation,
  saveVectorAnimationSession,
  getVectorAnimationSession,
  type VectorAnimationConfig,
  type VectorAnimationOptions,
} from "../models/VectorAnimation.ts";
import {
  renderAnimationFrames,
  buildFilmstripImage,
  encodeAnimationVideo,
} from "../services/VectorAnimationRenderService.ts";
import crypto from "node:crypto";
import CONFIG from "../config.ts";
import {
  buildEngineEmbedScript,
  buildPresetPath,
  PRESET_SHAPE_TYPES,
  type PresetShapeType,
  type VectorLayer,
  type Keyframe,
  type SymbolMap,
} from "../utilities/VectorAnimationEngine.ts";
import { lintAnimation } from "../services/VectorAnimationLint.ts";
import {
  declineOf,
  type ImageDecline,
  type ImageGenerationResult,
} from "../services/ImageDecline.ts";
import {
  queryEmojiCombination,
  queryEmojiCombinations,
  getEmojiKitchenHealth,
} from "../caches/EmojiKitchenCache.ts";

const router = Router();

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/**
 * Retrieve user's custom settings from the LLM Gateway, with fallbacks to defaults.
 */
async function getCreativeSettings() {
  try {
    const settings = await PrismService.getSettings();
    const creative = (settings?.creative ?? {}) as Record<string, string | undefined>;
    return {
      imageProvider: creative.imageProvider || "google",
      imageModel:
        creative.imageModel ||
        CONFIG.TOOLS_IMAGE_MODEL ||
        MODEL_IDS.geminiImagePro,
      visionProvider: creative.visionProvider || "google",
      visionModel:
        creative.visionModel || CONFIG.TOOLS_VISION_MODEL || MODEL_IDS.geminiFlashVision,
      textToSpeechProvider: creative.textToSpeechProvider || "elevenlabs",
      textToSpeechModel: creative.textToSpeechModel || "",
      speechToTextProvider: creative.speechToTextProvider || "openai",
      speechToTextModel: creative.speechToTextModel || "",
    };
  } catch (error: unknown) {
    logger.warn(
      `[CreativeRoutes] Failed to fetch settings from Prism, falling back to defaults: ${errorMessage(error)}`,
    );
    return {
      imageProvider: "google",
      imageModel: CONFIG.TOOLS_IMAGE_MODEL || MODEL_IDS.geminiImagePro,
      visionProvider: "google",
      visionModel: CONFIG.TOOLS_VISION_MODEL || MODEL_IDS.geminiFlashVision,
      textToSpeechProvider: "elevenlabs",
      textToSpeechModel: "",
      speechToTextProvider: "openai",
      speechToTextModel: "",
    };
  }
}

const MAX_SAFETY_RETRIES = 3;

// ────────────────────────────────────────────────────────────
// Audio Hosting — audio as first-class media
// ────────────────────────────────────────────────────────────
// Audio-producing tools keep their inline base64 audio:{data,mimeType}
// envelope (downstream consumers like lupos-bot rely on it) and ALSO
// upload the clip to MinIO, mirroring the image/video asset pattern, so
// clients can render a native player via display{kind:"audio",url} plus
// a downloadUrl. Hosting is strictly best-effort: when the upload fails
// the tool still succeeds with the base64-only response.

async function buildAudioHosting(
  audioBase64: string,
  mimeType: string,
  title?: string,
): Promise<{ downloadUrl: string; display: ReturnType<typeof buildDisplay> } | Record<string, never>> {
  try {
    const url = await MinioService.uploadToolAsset(
      Buffer.from(audioBase64, "base64"),
      mimeType,
    );
    if (!url) return {};
    return {
      downloadUrl: url,
      display: buildDisplay("audio", url, title ? { title } : {}),
    };
  } catch (error: unknown) {
    logger.warn(
      `[CreativeRoutes] Audio hosting upload failed (returning base64 only): ${errorMessage(error)}`,
    );
    return {};
  }
}

// ────────────────────────────────────────────────────────────
// Prompt Softening — graceful degradation for content safety
// ────────────────────────────────────────────────────────────
// Progressive substitutions applied cumulatively on each retry.
// Tier 2 includes tier 1 changes, tier 3 includes both, etc.
// The visual intent is preserved while problematic descriptors
// are replaced with policy-compliant creative alternatives.
// ────────────────────────────────────────────────────────────

const SAFETY_SOFTENING_TIERS: [RegExp, string][][] = [
  // ── Tier 1: Direct substitutions (nudity → clothing, violence → calm) ──
  [
    [/\bnaked\b/gi, "wearing flowing silk robes"],
    [/\bnude\b/gi, "draped in elegant fabric"],
    [/\bnudity\b/gi, "draped in flowing garments"],
    [/\btopless\b/gi, "in a strapless gown"],
    [/\bshirtless\b/gi, "in an open-collar shirt"],
    [/\bbare[\s-]?chest(ed)?\b/gi, "in a loosely unbuttoned shirt"],
    [/\bundress(ed|ing)?\b/gi, "in minimal elegant attire"],
    [/\bstrip(ping|ped)?\b/gi, "adjusting flowing robes"],
    [
      /\bexposed\s+(skin|body|flesh)\b/gi,
      "visible silhouette through sheer fabric",
    ],
    [/\bseductive\b/gi, "alluring"],
    [/\bsexual(ly)?\b/gi, "romantically"],
    [/\bsensual\b/gi, "graceful"],
    [/\berotic\b/gi, "romantic"],
    [/\bprovocative\b/gi, "striking"],
    [/\bintimate\b/gi, "tender"],
    [/\blingerie\b/gi, "elegant nightwear"],
    [/\bunderwear\b/gi, "loungewear"],
    [/\bbikini\b/gi, "summer outfit"],
    [/\bskimpy\b/gi, "lightweight"],
    [/\bskin[\s-]?tight\b/gi, "form-fitting"],
    [/\bcleavage\b/gi, "neckline"],
    [/\bblood(y|ied)?\b/gi, "red-stained"],
    [/\bgore\b/gi, "aftermath"],
    [/\bviolent(ly)?\b/gi, "intense"],
    [/\bviolence\b/gi, "conflict"],
    [/\bkill(ing|ed|s)?\b/gi, "defeating"],
    [/\bmurder(ed|ing|s|ous)?\b/gi, "confronting"],
    [/\bdead\s+body\b/gi, "fallen figure"],
    [/\bcorpse\b/gi, "fallen figure"],
    [/\bweapon\b/gi, "tool"],
    [/\bgun\b/gi, "device"],
    [/\bdrunk(en)?\b/gi, "carefree"],
    [/\bsmoking\b/gi, "holding an ornate pipe"],
    [/\bdrug(s|ged)?\b/gi, "potion"],
  ],
  // ── Tier 2: Broader softening + artistic framing ──
  [
    [/\bbody\b/gi, "figure"],
    [/\bflesh\b/gi, "form"],
    [/\bskin\b/gi, "complexion"],
    [/\bcurves\b/gi, "silhouette"],
    [/\bcurvy\b/gi, "statuesque"],
    [/\btight\b/gi, "fitted"],
    [/\bsweat(y|ing)?\b/gi, "glistening"],
    [/\bwet\b/gi, "rain-kissed"],
    [/\bfight(ing|s)?\b/gi, "sparring"],
    [/\bstab(bing|bed)?\b/gi, "striking"],
    [/\battack(ing|ed|s)?\b/gi, "charging at"],
    [/\bdestroy(ing|ed|s)?\b/gi, "transforming"],
    [/\bexplod(e|ing|ed|es)\b/gi, "erupting with energy"],
    [/\bfire\b/gi, "golden light"],
    [/\bburning\b/gi, "glowing warmly"],
  ],
  // ── Tier 3: Nuclear option — wrap in fine-art framing ──
  [
    [/^/i, "A tasteful Renaissance-style oil painting depicting: "],
    [/\b(sexy|hot)\b/gi, "beautiful"],
    [/\b(ass|butt|buttocks)\b/gi, "figure from behind"],
    [/\bbreasts?\b/gi, "torso"],
    [/\bthigh(s)?\b/gi, "lower silhouette"],
    [/\bwaist\b/gi, "midsection"],
    [/\bhips?\b/gi, "form"],
    [/\bbed(room)?\b/gi, "chamber"],
    [/\bshower\b/gi, "waterfall scene"],
    [/\bbath(ing|e)?\b/gi, "near a serene pool"],
  ],
];

/**
 * Apply cumulative softening tiers to a prompt string.


 */
function softenPrompt(prompt: string, tier: number) {
  let softened = prompt;
  for (
    let tierIndex = 0;
    tierIndex <= tier && tierIndex < SAFETY_SOFTENING_TIERS.length;
    tierIndex++
  ) {
    for (const [pattern, replacement] of SAFETY_SOFTENING_TIERS[tierIndex]) {
      softened = softened.replace(pattern, replacement);
    }
  }
  return softened;
}

// ────────────────────────────────────────────────────────────
// Vision dedup cache — prevents duplicate describe calls
// within the same request context.
// ────────────────────────────────────────────────────────────

const visionCache = new Map();
const VISION_CACHE_TTL_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────────
// POST /creative/generate-image
// ────────────────────────────────────────────────────────────

router.post(
  "/generate-image",
  asyncHandler(async (req: Request, res: Response) => {
    const { prompt, referenceImages, referenceLabels, transparentBackground, aspectRatio, size } = req.body;

    if (!prompt) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: prompt" });
    }

    const VALID_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];
    if (aspectRatio && !VALID_ASPECT_RATIOS.includes(aspectRatio)) {
      return res.status(400).json({
        error: `Invalid aspectRatio '${aspectRatio}'. Valid: ${VALID_ASPECT_RATIOS.join(", ")}`,
      });
    }
    const VALID_SIZES = ["1K", "2K", "4K"];
    const imageSize = size ? String(size).toUpperCase() : undefined;
    if (imageSize && !VALID_SIZES.includes(imageSize)) {
      return res.status(400).json({
        error: `Invalid size '${size}'. Valid: ${VALID_SIZES.join(", ")}`,
      });
    }

    // Extract caller context from headers for Prism attribution
    const {
      project: callerProject,
      username: callerUsername,
      agent: callerAgent,
      traceId: callerTraceId,
    } = extractCallerContext(req);

    try {
      const creativeSettings = await getCreativeSettings();
      let currentPrompt = prompt;
      let result: ImageGenerationResult | undefined;
      let decline: ImageDecline | null = null;
      let safetyRetries = 0;

      // The model can't output alpha — for cut-outs we ask for a chromakey
      // green background and key it out after generation. Appended at
      // message-build time so safety softening still sees the raw prompt.
      const greenscreenDirective = transparentBackground
        ? PromptLocaleService.get("en", "prompts.creative.image.greenscreen-directive")
        : null;

      // referenceImages entries may be bare URL strings or {url, label}
      // objects (the agent-facing schema); the orchestrator normally
      // resolves them to an aligned string[] + referenceLabels, but
      // normalize here too so the route stands alone for direct callers.
      // An explicit referenceLabels[i] wins over an entry's own label.
      const rawLabels: unknown[] = Array.isArray(referenceLabels)
        ? referenceLabels
        : [];
      const referenceUrls: string[] = [];
      const labels: string[] = [];
      if (Array.isArray(referenceImages)) {
        referenceImages.forEach((entry: unknown, index: number) => {
          let url: string | null = null;
          let entryLabel = "";
          if (typeof entry === "string") {
            url = entry;
          } else if (entry && typeof entry === "object") {
            const candidate = entry as { url?: unknown; label?: unknown };
            if (typeof candidate.url === "string") url = candidate.url;
            if (typeof candidate.label === "string")
              entryLabel = candidate.label.trim();
          }
          if (!url) return;
          const explicitLabel = rawLabels[index];
          referenceUrls.push(url);
          labels.push(
            typeof explicitLabel === "string" && explicitLabel.trim()
              ? explicitLabel.trim()
              : entryLabel,
          );
        });
      }

      // Ordinal manifest binding each reference image to its label (who or
      // what it is). The images arrive as anonymous inline parts in attach
      // order — without this the model binds prompt names to faces by
      // guesswork. Prepended at message-build time so safety softening
      // still sees the raw prompt.
      const referenceManifest =
        referenceUrls.length > 0 && labels.some((label) => label)
          ? [
              PromptLocaleService.get(
                "en",
                "prompts.creative.image.reference-manifest-header",
              ),
              ...referenceUrls.map(
                (_reference, index) =>
                  `${index + 1}. ${
                    labels[index] ||
                    PromptLocaleService.get(
                      "en",
                      "prompts.creative.image.reference-manifest-unlabeled",
                    )
                  }`,
              ),
            ].join("\n")
          : null;

      for (let attempt = 0; attempt <= MAX_SAFETY_RETRIES; attempt++) {
        const promptWithDirectives = `${
          referenceManifest ? `${referenceManifest}\n\n` : ""
        }${currentPrompt}${greenscreenDirective ? `\n\n${greenscreenDirective}` : ""}`;
        const messages = [
          {
            role: "user",
            content: promptWithDirectives,
            ...(referenceUrls.length > 0 && { images: referenceUrls }),
          },
        ];

        // When reference images are present, instruct the image model to
        // preserve and edit them rather than re-imagining from scratch.
        const systemPrompt =
          referenceUrls.length > 0
            ? PromptLocaleService.get("en", "prompts.creative.image.editing-system-prompt")
            : undefined;

        try {
          result = await PrismService.chat({
            provider: creativeSettings.imageProvider,
            model: creativeSettings.imageModel,
            messages,
            forceImageGeneration: true,
            ...(aspectRatio && { aspectRatio }),
            ...(imageSize && { imageSize }),
            project: callerProject,
            username: callerUsername,
            agent: callerAgent,
            traceId: callerTraceId,
            skipConversation: true,
            ...(systemPrompt && { systemPrompt }),
          });
        } catch (error: unknown) {
          logger.error(
            `[CreativeRoutes] Prism chat failed: ${errorMessage(error)}`,
          );
          return res.status(502).json({
            error: `Image generation failed: ${errorMessage(error)}`,
          });
        }

        // Success — we got an image
        decline = declineOf(result);
        if (!decline) {
          break;
        }

        // A decline softening cannot change (a likeness, personal info, the
        // model choosing not to draw) ends the attempt now.
        if (!decline.softenable) {
          logger.warn(
            `[CreativeRoutes] generate-image: declined (${decline.category}) — not a content-policy block, not retrying`,
          );
          break;
        }

        // Content-policy block — can we retry with a softer prompt?
        if (attempt < MAX_SAFETY_RETRIES) {
          safetyRetries++;
          const previousPrompt = currentPrompt;
          currentPrompt = softenPrompt(prompt, attempt);

          // If softening didn't change anything, no point retrying
          if (currentPrompt === previousPrompt) {
            logger.warn(
              `[CreativeRoutes] generate-image: safety softening had no effect at tier ${attempt + 1}, stopping retries`,
            );
            break;
          }

          logger.info(
            `[CreativeRoutes] generate-image: safety block on attempt ${attempt + 1}, ` +
              `retrying with softened prompt (tier ${attempt + 1}): "${currentPrompt.slice(0, 100)}…"`,
          );
        }
      }

      // No image. The message names the reason and tells the agent not to
      // redraw the same request — it used to invite exactly that.
      if (!result || decline || !result.images?.length) {
        const category = decline?.category ?? "UNKNOWN";
        const explanation = decline?.explanation
          ? PromptLocaleService.get("en", "prompts.creative.image.decline-explanation", {
              explanation: decline.explanation.slice(0, 300),
            })
          : "";
        const errorKey =
          category === "UNKNOWN"
            ? "prompts.creative.image.no-image-error"
            : decline?.softenable
              ? "prompts.creative.image.safety-block-error"
              : "prompts.creative.image.declined-error";
        return res.status(422).json({
          success: false,
          error: PromptLocaleService.get("en", errorKey, {
            attemptCount: String(safetyRetries + 1),
            reason: category,
            explanation,
          }),
          refusal: { category, explanation: decline?.explanation ?? null },
        });
      }

      const image = result.images[0];
      let imageData = image.data;
      let imageMimeType = image.mimeType || "image/png";
      let transparencyApplied = false;

      if (transparentBackground) {
        try {
          const keyResult = await removeChromakeyBackground(
            Buffer.from(image.data, "base64"),
          );
          if (keyResult.keyed) {
            imageData = keyResult.buffer.toString("base64");
            imageMimeType = "image/png";
            transparencyApplied = true;
          } else {
            logger.warn(
              `[CreativeRoutes] generate-image: transparent background requested but only ` +
                `${(keyResult.backgroundFraction * 100).toFixed(1)}% chromakey coverage — returning opaque image`,
            );
          }
        } catch (error: unknown) {
          logger.warn(
            `[CreativeRoutes] generate-image: chromakey removal failed, returning opaque image: ${errorMessage(error)}`,
          );
        }
      }

      // Build the result message — note if prompt was softened
      let resultMessage =
        safetyRetries > 0
          ? PromptLocaleService.get("en", "prompts.creative.image.result-softened")
          : PromptLocaleService.get("en", "prompts.creative.image.result-success");
      if (transparentBackground) {
        resultMessage += ` ${PromptLocaleService.get(
          "en",
          transparencyApplied
            ? "prompts.creative.image.result-transparent"
            : "prompts.creative.image.transparent-failed",
        )}`;
      }

      res.json({
        success: true,
        message: resultMessage,
        description: result.text || null,
        image: {
          data: imageData,
          mimeType: imageMimeType,
        },
        ...(transparentBackground && { transparencyApplied }),
        ...(safetyRetries > 0 && {
          safetyRetries,
          softenedPrompt: currentPrompt.slice(0, 200),
        }),
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] generate-image failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Image generation failed: ${errorMessage(error)}` });
    }
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/detect-objects
// Gemini vision object detection: normalized box_2d → pixel boxes,
// optionally rasterized as a labeled overlay.
// ────────────────────────────────────────────────────────────

const detectionStore = new PersistentStore<{ buffer: Buffer; mimeType: string }>("detection");
const MAX_DETECTION_OBJECTS = 50;

router.post(
  "/detect-objects",
  asyncHandler(async (req: Request, res: Response) => {
    const { image, instruction, annotate = true, maxObjects } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "Missing required parameter: image (URL, base64 data URI, or imageId)",
      });
    }

    // Shared resolver: URL, data URI, ephemeral imageId, workspace path —
    // and the standard unresolved-'attached' sentinel error.
    let inputBuffer: Buffer;
    try {
      inputBuffer = await resolveImageInput(image, imageStore);
    } catch (error: unknown) {
      return res.status(400).json({ error: errorMessage(error) });
    }

    const objectLimit = Math.min(
      Math.max(Number(maxObjects) || 20, 1),
      MAX_DETECTION_OBJECTS,
    );
    const target =
      typeof instruction === "string" && instruction.trim()
        ? instruction.trim()
        : PromptLocaleService.get("en", "prompts.creative.detect.default-target");

    const {
      project: callerProject,
      username: callerUsername,
      agent: callerAgent,
      traceId: callerTraceId,
    } = extractCallerContext(req);

    try {
      const creativeSettings = await getCreativeSettings();
      const detectionPrompt = PromptLocaleService.get(
        "en",
        "prompts.creative.detect.instruction",
        { target, max: String(objectLimit) },
      );

      const visionImage = await toVisionDataUri(inputBuffer);

      const result = await PrismService.chat({
        provider: creativeSettings.visionProvider,
        model: creativeSettings.visionModel,
        messages: [{ role: "user", content: detectionPrompt, images: [visionImage] }],
        responseMimeType: "application/json",
        project: callerProject,
        username: callerUsername,
        agent: callerAgent,
        traceId: callerTraceId,
        skipConversation: true,
      });

      const detections = parseDetectionJson(result.text, objectLimit);

      if (detections.length === 0) {
        return res.json({
          success: true,
          count: 0,
          objects: [],
          message: PromptLocaleService.get("en", "prompts.creative.detect.none-found", {
            target,
          }),
        });
      }

      const { width, height, objects, annotatedPng } = await annotateDetections(
        inputBuffer,
        detections,
        { annotate: annotate !== false },
      );

      let imageUrl: string | null = null;
      if (annotatedPng) {
        const minioUrl = await MinioService.uploadToolAsset(annotatedPng, "image/png");
        const id = detectionStore.set({ buffer: annotatedPng, mimeType: "image/png" });
        imageUrl = minioUrl || buildLocalUrl("creative/detection/render", { id });
      }

      res.json({
        success: true,
        count: objects.length,
        imageWidth: width,
        imageHeight: height,
        objects,
        ...(imageUrl && {
          imageUrl,
          display: buildDisplay("image", imageUrl, { title: "Detected objects" }),
        }),
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] detect-objects failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Object detection failed: ${errorMessage(error)}` });
    }
  }),
);

router.get(
  "/detection/render",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.query as Record<string, string>;
    if (!id) return res.status(400).send("Missing 'id' parameter");
    const entry = await detectionStore.getWithFallback(id);
    if (!entry) {
      return res.status(404).send("Image not found or expired");
    }
    res.setHeader("Content-Type", entry.mimeType || "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(entry.buffer));
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/remove-background
// Pixel-faithful cut-out: Gemini segmentation masks applied to the
// ORIGINAL pixels — nothing is re-drawn. (Generative cut-outs of new
// images live in generate-image's transparentBackground flag.)
// ────────────────────────────────────────────────────────────

const cutoutStore = new PersistentStore<{ buffer: Buffer; mimeType: string }>("cutout");
const MAX_SEGMENTS = 10;

router.post(
  "/remove-background",
  asyncHandler(async (req: Request, res: Response) => {
    const { image, subject } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "Missing required parameter: image (URL, base64 data URI, or imageId)",
      });
    }

    // Shared resolver: URL, data URI, ephemeral imageId, workspace path —
    // and the standard unresolved-'attached' sentinel error.
    let inputBuffer: Buffer;
    try {
      inputBuffer = await resolveImageInput(image, imageStore);
    } catch (error: unknown) {
      return res.status(400).json({ error: errorMessage(error) });
    }

    const target =
      typeof subject === "string" && subject.trim()
        ? subject.trim()
        : PromptLocaleService.get("en", "prompts.creative.segment.default-subject");

    const {
      project: callerProject,
      username: callerUsername,
      agent: callerAgent,
      traceId: callerTraceId,
    } = extractCallerContext(req);

    try {
      const creativeSettings = await getCreativeSettings();
      const visionImage = await toVisionDataUri(inputBuffer);

      const segmentationPrompt = PromptLocaleService.get(
        "en",
        "prompts.creative.segment.instruction",
        { subject: target },
      );

      // Docs recommend minimal thinking for segmentation accuracy
      const result = await PrismService.chat({
        provider: creativeSettings.visionProvider,
        model: creativeSettings.visionModel,
        messages: [
          { role: "user", content: segmentationPrompt, images: [visionImage] },
        ],
        responseMimeType: "application/json",
        thinkingEnabled: false,
        project: callerProject,
        username: callerUsername,
        agent: callerAgent,
        traceId: callerTraceId,
        skipConversation: true,
      });

      const segments = parseSegmentationJson(result.text, MAX_SEGMENTS);

      if (segments.length === 0) {
        return res.status(422).json({
          success: false,
          error: PromptLocaleService.get("en", "prompts.creative.segment.none-found", {
            subject: target,
          }),
        });
      }

      const cutout = await applySegmentationMasks(inputBuffer, segments);

      const minioUrl = await MinioService.uploadToolAsset(cutout.buffer, "image/png");
      const id = cutoutStore.set({ buffer: cutout.buffer, mimeType: "image/png" });
      const imageUrl = minioUrl || buildLocalUrl("creative/cutout/render", { id });

      res.json({
        success: true,
        message: PromptLocaleService.get("en", "prompts.creative.segment.result-success", {
          labels: cutout.labels.join(", "),
        }),
        subjects: cutout.labels,
        coverage: Number(cutout.coverage.toFixed(3)),
        imageWidth: cutout.width,
        imageHeight: cutout.height,
        imageUrl,
        display: buildDisplay("image", imageUrl, { title: "Background removed" }),
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] remove-background failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Background removal failed: ${errorMessage(error)}` });
    }
  }),
);

router.get(
  "/cutout/render",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.query as Record<string, string>;
    if (!id) return res.status(400).send("Missing 'id' parameter");
    const entry = await cutoutStore.getWithFallback(id);
    if (!entry) {
      return res.status(404).send("Image not found or expired");
    }
    res.setHeader("Content-Type", entry.mimeType || "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(entry.buffer));
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/describe-image
// ────────────────────────────────────────────────────────────

router.post(
  "/describe-image",
  asyncHandler(async (req: Request, res: Response) => {
    const { imageUrls, context = "general" } = req.body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        error:
          "Missing required parameter: imageUrls (array of image URLs, data URIs, or imageIds)",
      });
    }
    if (imageUrls.some((entry) => typeof entry !== "string" || !entry.trim())) {
      return res.status(400).json({
        error:
          "Every imageUrls entry must be a non-empty string (URL, data URI, or imageId)",
      });
    }
    // Unresolved harness sentinel — no attached image existed to substitute.
    if (imageUrls.some((entry) => isUnresolvedAttachedSentinel(entry))) {
      return res.status(400).json({
        error: buildAttachedSentinelError(
          "image",
          "an explicit URL, data URI, or imageId",
        ),
      });
    }

    // Extract caller context from headers for Prism attribution
    const {
      project: callerProject,
      username: callerUsername,
      agent: callerAgent,
      traceId: callerTraceId,
    } = extractCallerContext(req);

    // Tailor the prompt based on image context
    const prompts: Record<string, string> = {
      avatar: PromptLocaleService.get("en", "prompts.creative.describe.avatar"),
      banner: PromptLocaleService.get("en", "prompts.creative.describe.banner"),
      photo: PromptLocaleService.get("en", "prompts.creative.describe.photo"),
      general: PromptLocaleService.get("en", "prompts.creative.describe.general"),
    };
    const visionPrompt = prompts[context] || prompts.general;

    try {
      const creativeSettings = await getCreativeSettings();
      const descriptions: unknown[] = [];

      // Per-request dedup cache keyed by X-Request-Id header
      const requestId = req.headers[IDENTITY_HEADERS.requestId] || "default";
      if (!visionCache.has(requestId)) {
        visionCache.set(requestId, new Map());
        setTimeout(() => visionCache.delete(requestId), VISION_CACHE_TTL_MS);
      }
      const urlCache = visionCache.get(requestId);

      // Deduplicate entries within this call
      const uniqueUrls = [...new Set(imageUrls as string[])];

      // Echo data URIs back as a short label instead of megabytes of base64
      const sourceLabel = (entry: string) =>
        entry.startsWith("data:")
          ? `${entry.slice(0, entry.indexOf(",") + 1)}… (${entry.length} chars)`
          : entry;

      for (const url of uniqueUrls) {
        // Singleflight: if a request for this entry is already in-flight,
        // await it instead of firing a duplicate.
        if (urlCache.has(url)) {
          const cached = await urlCache.get(url);
          descriptions.push({ url: sourceLabel(url), description: cached });
          logger.info(
            `[CreativeRoutes] describe-image: cache hit for ${url.slice(0, 60)}…`,
          );
          continue;
        }

        // Store the promise IMMEDIATELY so parallel calls can await it
        const descriptionPromise = (async () => {
          try {
            // Shared resolver: URL, data URI, ephemeral imageId, workspace
            // path — all normalized to a bounded-size vision data URI.
            const inputBuffer = await resolveImageInput(url, imageStore);
            const visionImage = await toVisionDataUri(inputBuffer);

            const result = await PrismService.chat({
              provider: creativeSettings.visionProvider,
              model: creativeSettings.visionModel,
              messages: [
                { role: "user", content: visionPrompt, images: [visionImage] },
              ],
              project: callerProject,
              username: callerUsername,
              agent: callerAgent,
              traceId: callerTraceId,
              skipConversation: true,
            });

            return result.text || "Unable to describe this image.";
          } catch (error: unknown) {
            logger.error(
              `[CreativeRoutes] describe-image vision call failed: ${errorMessage(error)}`,
            );
            return `Failed to describe image: ${errorMessage(error)}`;
          }
        })();

        urlCache.set(url, descriptionPromise);

        const text = await descriptionPromise;
        descriptions.push({ url: sourceLabel(url), description: text });
      }

      logger.info(
        `[CreativeRoutes] describe-image: described ${descriptions.length} image(s), context=${context}`,
      );

      res.json({
        success: true,
        descriptions,
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] describe-image failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Image description failed: ${errorMessage(error)}` });
    }
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/text-to-speech
// ────────────────────────────────────────────────────────────

router.post(
  "/text-to-speech",
  asyncHandler(async (req: Request, res: Response) => {
    const { text, voice, provider, model } = req.body;

    if (!text) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: text" });
    }

    const { project: callerProject, username: callerUsername } =
      extractCallerContext(req);

    try {
      const creativeSettings = await getCreativeSettings();
      const resolvedProvider =
        provider || creativeSettings.textToSpeechProvider;
      const resolvedModel =
        model || creativeSettings.textToSpeechModel || undefined;

      const result = await PrismService.textToSpeech({
        text,
        voice,
        provider: resolvedProvider,
        model: resolvedModel,
        project: callerProject,
        username: callerUsername,
      });

      res.json({
        success: true,
        message: PromptLocaleService.get("en", "prompts.creative.audio.result-success"),
        audio: {
          data: result.audioBase64,
          mimeType: result.contentType,
        },
        textLength: text.length,
        ...(await buildAudioHosting(result.audioBase64, result.contentType, "Text-to-speech")),
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] text-to-speech failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Text-to-speech failed: ${errorMessage(error)}` });
    }
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/local-text-to-speech
// Local espeak-ng based TTS — no AI models, zero cost
// ────────────────────────────────────────────────────────────

router.post(
  "/local-text-to-speech",
  asyncHandler(async (req: Request, res: Response) => {
    const { text, voice, speed, pitch, volume, wordGap } = req.body;

    if (!text) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: text" });
    }

    if (voice) {
      const supportedVoicesList = getSupportedVoices();
      if (!supportedVoicesList[voice]) {
        return res.status(400).json({
          error: `Invalid voice '${voice}'. Supported voices: ${Object.keys(supportedVoicesList).join(", ")}`,
        });
      }
    }

    try {
      const result = await synthesizeSpeech({
        text,
        voice,
        speed: speed != null ? Number(speed) : undefined,
        pitch: pitch != null ? Number(pitch) : undefined,
        volume: volume != null ? Number(volume) : undefined,
        wordGap: wordGap != null ? Number(wordGap) : undefined,
      });

      res.json({
        success: true,
        message: PromptLocaleService.get("en", "prompts.creative.audio.result-local-tts"),
        audio: {
          data: result.audioBase64,
          mimeType: result.mimeType,
        },
        voice: result.voice,
        textLength: result.textLength,
        durationEstimate: result.durationEstimateSeconds,
        ...(await buildAudioHosting(result.audioBase64, result.mimeType, "Text-to-speech (local)")),
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] local-text-to-speech failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Local text-to-speech failed: ${errorMessage(error)}` });
    }
  }),
);

router.get(
  "/local-text-to-speech/voices",
  asyncHandler(async (_req: Request, res: Response) => {
    const isAvailable = await isEspeakAvailable();
    res.json({
      success: true,
      available: isAvailable,
      voices: getSupportedVoices(),
    });
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/speech-to-text
// ────────────────────────────────────────────────────────────

router.post(
  "/speech-to-text",
  asyncHandler(async (req: Request, res: Response) => {
    const { audioUrl, audio, provider, model, language } = req.body;

    // Unresolved harness sentinel — no attached audio existed to substitute.
    if (isUnresolvedAttachedSentinel(audioUrl) || isUnresolvedAttachedSentinel(audio)) {
      return res.status(400).json({
        error: buildAttachedSentinelError("audio", "an explicit URL or data URI"),
      });
    }

    // Accept either a URL (we fetch it) or raw base64 audio
    let audioData = audio;
    if (!audioData && audioUrl) {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) {
          return res.status(400).json({
            error: `Failed to fetch audio from URL: ${response.status}`,
          });
        }
        const buffer = await response.arrayBuffer();
        const mimeType = response.headers.get("content-type") || "audio/mpeg";
        audioData = `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
      } catch (error: unknown) {
        return res
          .status(400)
          .json({ error: `Failed to fetch audio URL: ${errorMessage(error)}` });
      }
    }

    if (!audioData) {
      return res.status(400).json({
        error:
          "Missing required parameter: 'audio' (base64) or 'audioUrl' (URL to audio file)",
      });
    }

    const { project: callerProject, username: callerUsername } =
      extractCallerContext(req);

    try {
      const creativeSettings = await getCreativeSettings();
      const resolvedProvider =
        provider || creativeSettings.speechToTextProvider;
      const resolvedModel =
        model || creativeSettings.speechToTextModel || undefined;

      const result = await PrismService.speechToText({
        audio: audioData,
        provider: resolvedProvider,
        model: resolvedModel,
        language,
        project: callerProject,
        username: callerUsername,
      });

      res.json({
        success: true,
        text: result.text,
        usage: result.usage || {},
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] speech-to-text failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Speech-to-text failed: ${errorMessage(error)}` });
    }
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/generate-audio
// ────────────────────────────────────────────────────────────

// Sampler channels hold decoded PCM in session memory (mono float32 at the
// session rate), so per-sample length is bounded: 15s @ 48kHz ≈ 2.8 MB.
const MAX_SAMPLE_SECONDS = 15;

router.post(
  "/generate-audio",
  asyncHandler(async (req: Request, res: Response) => {
    const { action } = req.body;

    // ── Tracker Sequencer Workflow ─────────────────────────────
    // generate_audio is tracker-only: init → add_channel →
    // write_pattern → render. Each action is a small incremental
    // step, and every step auto-renders a live audio preview of
    // the content written so far.

    const VALID_ACTIONS = ["init", "add_channel", "write_pattern", "render"];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        error:
          `Missing or invalid 'action' (got: ${JSON.stringify(action ?? null)}). ` +
          `generate_audio uses the tracker workflow: 1) action "init" creates a session ` +
          `(tempo, timeSignature, linesPerBeat, duration), 2) "add_channel" once per ` +
          `instrument, 3) "write_pattern" writes note rows to a channel, 4) "render" ` +
          `produces the final audio. Valid actions: ${VALID_ACTIONS.join(", ")}.`,
      });
    }

    // Shared helper: resolve and validate the sessionId parameter.
    const requireSession = (
      sessionId: unknown,
    ):
      | { session: NonNullable<ReturnType<typeof getTrackerSession>> }
      | { errorStatus: number; error: string } => {
      if (!sessionId || sessionId === "null" || sessionId === "undefined") {
        return {
          errorStatus: 400,
          error:
            `Missing or invalid sessionId (got: ${JSON.stringify(sessionId ?? null)}). ` +
            `Pass the exact sessionId returned by action: "init". If you no longer ` +
            `have it, call action: "init" again to start a new session.`,
        };
      }
      const session = getTrackerSession(String(sessionId));
      if (!session) {
        return {
          errorStatus: 400,
          error:
            `Session '${sessionId}' not found or expired (sessions expire after 30 ` +
            `minutes of inactivity). Call action: "init" again and rebuild the ` +
            `channels and patterns with the new sessionId.`,
        };
      }
      return { session };
    };

    // Shared helper: attempt to render a preview of the content written so
    // far. Previews are NOT looped or padded to the target duration — they
    // play exactly what has been authored. Returns null if nothing is
    // renderable yet.
    const tryRenderPreview = async (sessionId: string): Promise<{
      audio: { data: string; mimeType: string };
      duration: number;
      sampleCount: number;
      downloadUrl?: string;
      display?: ReturnType<typeof buildDisplay>;
    } | null> => {
      const conversionResult = toSynthesizerConfig(sessionId, { forPreview: true });
      if (!conversionResult.config) return null;
      const validationError = validateSynthesizerInput(conversionResult.config);
      if (validationError) return null;
      try {
        const renderResult = generateAudioWav(conversionResult.config);
        const sampleRate = conversionResult.config.sampleRate ?? 44100;
        return {
          audio: { data: renderResult.audioBase64, mimeType: "audio/wav" },
          duration: renderResult.sampleCount / sampleRate,
          sampleCount: renderResult.sampleCount,
          ...(await buildAudioHosting(renderResult.audioBase64, "audio/wav", "Tracker preview")),
        };
      } catch {
        return null;
      }
    };

    // Duration progress feedback based on AUTHORED pattern length (longest
    // channel), never on a rendered preview — auto-repeat looping would
    // inflate that and tell the model it's done when it isn't.
    const buildDurationProgress = (
      session: NonNullable<ReturnType<typeof getTrackerSession>>,
    ): Record<string, number> => {
      const authored = Math.round(getAuthoredDurationSeconds(session) * 100) / 100;
      if (!session.duration) return { authoredDuration: authored };
      return {
        targetDuration: session.duration,
        authoredDuration: authored,
        remainingDuration: Math.round(Math.max(0, session.duration - authored) * 100) / 100,
      };
    };

    // Human-readable progress sentence appended to action messages.
    const describeDurationProgress = (
      session: NonNullable<ReturnType<typeof getTrackerSession>>,
    ): string => {
      if (!session.duration) return "";
      const authored = getAuthoredDurationSeconds(session);
      const remaining = Math.max(0, session.duration - authored);
      if (remaining <= 0) {
        return ` Authored content covers the ${session.duration}s target.`;
      }
      return (
        ` Authored ${authored.toFixed(2)}s of the ${session.duration}s target ` +
        `(${remaining.toFixed(2)}s remaining — shorter patterns auto-loop at ` +
        `render to fill the target; write more rows if looping is not wanted).`
      );
    };

    if (action === "init") {
      const { tempo, timeSignature, linesPerBeat, sampleRate, swing, humanize, duration } = req.body;
      const session = createTrackerSession({
        tempo: tempo != null ? Number(tempo) : undefined,
        timeSignature,
        linesPerBeat: linesPerBeat != null ? Number(linesPerBeat) : undefined,
        sampleRate: sampleRate != null ? Number(sampleRate) : undefined,
        swing: swing != null ? Number(swing) : undefined,
        humanize: humanize != null ? Number(humanize) : undefined,
        duration: duration != null ? Number(duration) : undefined,
      });
      const rowMilliseconds = (60 / session.tempo / session.linesPerBeat) * 1000;
      const durationMessage = session.duration
        ? ` Target duration: ${session.duration}s (the final render will be exactly this long — shorter patterns auto-loop, longer ones are trimmed).`
        : "";
      return res.json({
        success: true,
        message:
          `Tracker session created. Tempo: ${session.tempo} BPM, ` +
          `Time Signature: ${session.timeSignature.join("/")}, ` +
          `Lines Per Beat: ${session.linesPerBeat} (each row = ${rowMilliseconds.toFixed(1)}ms).${durationMessage} ` +
          `Now add channels with action: "add_channel" (pass this sessionId).`,
        sessionId: session.sessionId,
        tempo: session.tempo,
        timeSignature: session.timeSignature,
        linesPerBeat: session.linesPerBeat,
        sampleRate: session.sampleRate,
        targetDuration: session.duration,
        activeSessions: getActiveSessionCount(),
      });
    }

    if (action === "add_channel") {
      const {
        sessionId, channelId, instrument, waveform, volume, effects,
        nodes, nodeChain, rows, sampleSource, sampleRootNote, sampleLoop,
      } = req.body;
      const sessionResult = requireSession(sessionId);
      if ("error" in sessionResult) {
        return res.status(sessionResult.errorStatus).json({ error: sessionResult.error });
      }
      const session = sessionResult.session;
      if (!channelId) {
        return res.status(400).json({
          error: "Missing required parameter: channelId (a descriptive name like 'lead', 'bass', 'drums').",
        });
      }
      if (instrument && !Object.hasOwn(INSTRUMENT_PRESETS, instrument)) {
        return res.status(400).json({
          error:
            `Invalid instrument '${instrument}'. Valid: ${Object.keys(INSTRUMENT_PRESETS).join(", ")}. ` +
            `For drum beats, omit the instrument entirely and write KICK/SNARE/HAT ` +
            `rows — drum synthesis is automatic. For NATURAL sampled instruments, use ` +
            `sampleSource: "preset:<name>" instead (${listSamplePresets().map((name) => `preset:${name}`).join(", ")}).`,
        });
      }

      let sample: TrackerChannelSample | undefined;
      if (sampleSource != null) {
        if (typeof sampleSource !== "string" || sampleSource.trim() === "") {
          return res.status(400).json({
            error:
              "Invalid sampleSource: pass 'attached' (conversation audio), an audio URL, " +
              "or a data URI. Omit it entirely for a synthesized channel.",
          });
        }
        if (instrument || waveform || nodes || nodeChain) {
          return res.status(400).json({
            error:
              "sampleSource makes this a sampler channel — it cannot be combined with " +
              "instrument, waveform, or custom nodes/nodeChain. Effects and volume still apply.",
          });
        }
        if (sampleRootNote != null && !(noteToFreq(sampleRootNote) > 0)) {
          return res.status(400).json({
            error:
              `Invalid sampleRootNote '${sampleRootNote}'. Use a pitch name like 'C4' or 'A#3' — ` +
              `the pitch the recording is assumed to be at, so pattern notes repitch relative to it.`,
          });
        }
        try {
          if (isSamplePresetRef(sampleSource)) {
            // Built-in library one-shot — pre-rendered, cached, with its own
            // natural root note (overridable).
            const presetSample = await resolveSamplePreset(
              sampleSource,
              session.sampleRate,
            );
            sample = {
              ...presetSample,
              rootNote: sampleRootNote ?? presetSample.rootNote,
              loop: sampleLoop === true,
            };
          } else {
            const encodedAudio = await resolveAudioInput(sampleSource);
            const decoded = await decodeAudioToPcm(encodedAudio, {
              sampleRate: session.sampleRate,
              maxDurationSeconds: MAX_SAMPLE_SECONDS,
            });
            sample = {
              pcm: decoded.pcm,
              sourceSampleRate: decoded.sampleRate,
              rootNote: sampleRootNote ?? "C4",
              loop: sampleLoop === true,
              durationSeconds: decoded.durationSeconds,
              sourceLabel: sampleSource.startsWith("data:")
                ? "attached audio"
                : sampleSource.slice(0, 80),
            };
          }
        } catch (error: unknown) {
          return res.status(400).json({
            error: `Could not load sample for channel '${channelId}': ${errorMessage(error)}`,
          });
        }
      }

      const result = addTrackerChannel(session.sessionId, {
        channelId,
        instrument,
        waveform,
        volume: volume != null ? Number(volume) : undefined,
        effects,
        nodes,
        nodeChain,
        sample,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Optional inline pattern: writing rows together with the channel
      // saves an extra round trip for the common one-pattern-per-channel case.
      let writtenRows = 0;
      let previewNotation: string | undefined;
      if (rows != null) {
        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(400).json({
            error:
              `Channel '${channelId}' was created, but 'rows' must be a non-empty ` +
              `array of {note, duration, velocity?} to write a pattern inline. ` +
              `Write it with action: "write_pattern".`,
          });
        }
        const writeResult = writeTrackerPattern({
          sessionId: session.sessionId,
          channelId,
          rows,
        });
        if (!writeResult.success) {
          return res.status(400).json({
            error:
              `Channel '${channelId}' was created, but writing its pattern failed: ` +
              `${writeResult.error} Fix the rows and use action: "write_pattern".`,
          });
        }
        writtenRows = writeResult.totalRows ?? 0;
        previewNotation = writeResult.previewNotation;
      }

      const preview = await tryRenderPreview(session.sessionId);
      return res.json({
        success: true,
        message:
          `Channel '${channelId}' added` +
          (instrument ? ` with instrument preset '${instrument}'` : "") +
          (sample
            ? ` as a SAMPLER channel (${sample.durationSeconds.toFixed(2)}s sample, root note ${sample.rootNote}` +
              `${sample.loop ? ", looped" : ""})`
            : "") +
          (writtenRows > 0 ? ` and ${writtenRows} pattern row(s) written` : "") +
          `. ${result.channelCount} channel(s) in session.` +
          (sample
            ? ` Pattern notes repitch the sample relative to ${sample.rootNote}; ` +
              `KICK/SNARE/HAT rows play it at natural pitch.`
            : "") +
          describeDurationProgress(session) +
          (writtenRows > 0
            ? ` Add more channels, write more rows, or call action: "render".`
            : sample
              ? ` IMPORTANT: this sampler channel is SILENT until pattern rows trigger it — ` +
                `the render will NOT contain the sample yet. Write rows with action: ` +
                `"write_pattern" (e.g. {note: "${sample.rootNote}", duration: 8} at each point ` +
                `the sample should play), then action: "render" for the final mix.`
              : ` Now write its pattern with action: "write_pattern".`),
        sessionId: session.sessionId,
        channelId,
        channelCount: result.channelCount,
        allChannels: session.channels.map((channel) => channel.channelId),
        ...(previewNotation && { totalRows: writtenRows, previewNotation }),
        ...(preview ?? {}),
        ...buildDurationProgress(session),
      });
    }

    if (action === "write_pattern") {
      const { sessionId, channelId, rows, startRow, append } = req.body;
      const sessionResult = requireSession(sessionId);
      if ("error" in sessionResult) {
        return res.status(sessionResult.errorStatus).json({ error: sessionResult.error });
      }
      const session = sessionResult.session;
      if (!channelId) {
        return res.status(400).json({ error: "Missing required parameter: channelId." });
      }
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          error: "Missing required parameter: rows (non-empty array of {note, duration, velocity?}).",
        });
      }
      const writeResult = writeTrackerPattern({
        sessionId: session.sessionId,
        channelId,
        rows,
        startRow: startRow != null ? Number(startRow) : undefined,
        append,
      });
      if (!writeResult.success) {
        return res.status(400).json({ error: writeResult.error });
      }
      const preview = await tryRenderPreview(session.sessionId);
      return res.json({
        success: true,
        message:
          `Wrote ${rows.length} row(s) to channel '${channelId}'. ` +
          `Total rows: ${writeResult.totalRows}.` +
          describeDurationProgress(session) +
          ` Add more patterns or call action: "render" for the final output.`,
        sessionId: session.sessionId,
        channelId,
        totalRows: writeResult.totalRows,
        previewNotation: writeResult.previewNotation,
        ...(preview ?? {}),
        ...buildDurationProgress(session),
      });
    }

    if (action === "render") {
      const { sessionId, clearSession } = req.body;
      const sessionResult = requireSession(sessionId);
      if ("error" in sessionResult) {
        return res.status(sessionResult.errorStatus).json({ error: sessionResult.error });
      }
      const session = sessionResult.session;
      const conversionResult = toSynthesizerConfig(session.sessionId);
      if (!conversionResult.config) {
        return res.status(400).json({ error: conversionResult.error });
      }
      const synthesizerConfig = conversionResult.config;
      const validationError = validateSynthesizerInput(synthesizerConfig);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      try {
        const boundedSampleRate = synthesizerConfig.sampleRate ?? 44100;
        const result = generateAudioWav(synthesizerConfig);
        const actualDuration = result.sampleCount / boundedSampleRate;
        const authoredDuration = getAuthoredDurationSeconds(session);
        const channelSummary = session.channels
          .map((channel) => `${channel.channelId} (${channel.pattern.length} rows)`)
          .join(", ");
        let durationNote = "";
        if (session.duration && authoredDuration < session.duration - 0.05) {
          durationNote =
            ` Only ${authoredDuration.toFixed(2)}s of pattern content was written, ` +
            `so it was looped to fill the ${session.duration}s target.`;
        }
        if (clearSession) {
          deleteTrackerSession(session.sessionId);
        }
        return res.json({
          success: true,
          message:
            `Successfully rendered tracker composition (${actualDuration.toFixed(2)}s, ` +
            `${boundedSampleRate}Hz). Channels: ${channelSummary}.${durationNote}` +
            (clearSession ? " Session cleared." : " Session preserved for further editing."),
          sessionId: session.sessionId,
          audio: {
            data: result.audioBase64,
            mimeType: "audio/wav",
          },
          duration: actualDuration,
          targetDuration: session.duration,
          authoredDuration: Math.round(authoredDuration * 100) / 100,
          sampleCount: result.sampleCount,
          sessionCleared: !!clearSession,
          ...(await buildAudioHosting(result.audioBase64, "audio/wav", "Tracker composition")),
        });
      } catch (error: unknown) {
        logger.error(
          `[CreativeRoutes] generate-audio render failed: ${errorMessage(error)}`,
        );
        return res
          .status(500)
          .json({ error: `Audio tracker render failed: ${errorMessage(error)}` });
      }
    }

    // Unreachable — the action guard above returns for unknown actions.
    return res.status(400).json({
      error: `Unhandled action '${action}'. Valid actions: ${VALID_ACTIONS.join(", ")}.`,
    });
  }),
);

// ────────────────────────────────────────────────────────────
// POST /creative/remix-audio
// ────────────────────────────────────────────────────────────

router.post(
  "/remix-audio",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      input,
      operations = [],
      preset,
      outputFormat = "wav",
      sampleRate,
      overlays,
      concatenate,
      mixDuration,
    } = req.body;

    const validationError = validateAudioRemixInput({
      input,
      operations,
      preset,
      outputFormat,
      sampleRate,
      overlays,
      concatenate,
      mixDuration,
    });

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    try {
      const result = await processAudio({
        input,
        operations,
        preset,
        outputFormat,
        sampleRate: sampleRate ? Number(sampleRate) : undefined,
        overlays,
        concatenate,
        mixDuration,
      });

      const audioBase64 = result.buffer.toString("base64");

      const presetLabel = preset ? ` (preset: '${preset}')` : "";
      const operationSummary = result.appliedOperations.join(" → ");

      res.json({
        success: true,
        message:
          `Successfully remixed audio${presetLabel}. ` +
          `Pipeline: ${operationSummary}. ` +
          `Output: ${result.durationSeconds.toFixed(2)}s ${outputFormat.toUpperCase()}.`,
        audio: {
          data: audioBase64,
          mimeType: result.mimeType,
        },
        duration: result.durationSeconds,
        appliedOperations: result.appliedOperations,
        ...(preset && { preset }),
        availablePresets: getAvailablePresets(),
        ...(await buildAudioHosting(audioBase64, result.mimeType, "Remixed audio")),
      });
    } catch (error: unknown) {
      logger.error(
        `[CreativeRoutes] remix-audio failed: ${errorMessage(error)}`,
      );
      res
        .status(500)
        .json({ error: `Audio remix failed: ${errorMessage(error)}` });
    }
  }),
);

// ────────────────────────────────────────────────────────────
// Emoji Kitchen Domain
// ────────────────────────────────────────────────────────────

/**
 * GET /creative/emoji-kitchen/combine
 * Combines two emojis and returns the static PNG URL and metadata.
 */
router.get(
  "/emoji-kitchen/combine",
  asyncHandler(async (req: Request, res: Response) => {
    const { left, right } = req.query;

    if (!left || !right) {
      return res
        .status(400)
        .json({ error: "Missing required query parameters: left and right" });
    }

    const combination = queryEmojiCombination(left as string, right as string);
    if (!combination) {
      return res.status(404).json({
        error: `No Emoji Kitchen combination found for "${left}" and "${right}"`,
        left,
        right,
      });
    }

    res.json({
      success: true,
      ...combination,
      display: buildDisplay("image", combination.gStaticUrl, {
        title: combination.alt,
      }),
    });
  }),
);

/**
 * GET /creative/emoji-kitchen/combinations
 * Lists all possible GBoard combinations for a single emoji.
 */
router.get(
  "/emoji-kitchen/combinations",
  asyncHandler(async (req: Request, res: Response) => {
    const { emoji, limit } = req.query;

    if (!emoji) {
      return res
        .status(400)
        .json({ error: "Missing required query parameter: emoji" });
    }

    const maxLimit = limit
      ? Math.min(Math.max(parseInt(limit as string, 10), 1), 500)
      : 50;
    const options = queryEmojiCombinations(emoji as string, maxLimit);

    res.json({
      success: true,
      emoji,
      count: options.length,
      combinations: options,
    });
  }),
);

/**
 * GET /creative/emoji-kitchen/metadata
 * Retrieve cache/health overview of the Emoji Kitchen metadata collector.
 */
router.get(
  "/emoji-kitchen/metadata",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(getEmojiKitchenHealth());
  }),
);

// ────────────────────────────────────────────────────────────
// Vector Animation Domain
// ────────────────────────────────────────────────────────────

const vectorAnimationSessions = new Map();
const VECTOR_ANIMATION_SESSION_TTL_MS = 30 * 60_000; // 30 min

function cleanupVectorAnimationSessions() {
  const now = Date.now();
  for (const [id, session] of vectorAnimationSessions) {
    if (now - session.updatedAt > VECTOR_ANIMATION_SESSION_TTL_MS)
      vectorAnimationSessions.delete(id);
  }
}

/**
 * Normalize incoming layers to the shapes the engine expects: numeric
 * keyframe times (the merge logic compares them with ===), canonical easing
 * names (models send camelCase variants), and object-form motion paths
 * (models send bare SVG path strings). Merge-control markers (action,
 * deleted, replaceKeyframes) are preserved for the session-merge logic.
 */
function normalizeVectorLayers(layers: VectorLayerInput[]): VectorLayerInput[] {
  return layers.map((layer) => {
    const normalized: VectorLayerInput = { ...layer };
    // Shorthand: a layer with a symbol reference is an instance layer.
    if (layer.symbol && !layer.shapeType) normalized.shapeType = "instance";
    // Preset shapes bake to path layers so masking/morphing work unchanged.
    if (layer.shapeType && (PRESET_SHAPE_TYPES as readonly string[]).includes(layer.shapeType)) {
      normalized.shapeData = {
        ...layer.shapeData,
        preset: layer.shapeType,
        path: buildPresetPath(
          layer.shapeType as PresetShapeType,
          (layer.shapeData || {}) as Parameters<typeof buildPresetPath>[1],
        ),
      };
      normalized.shapeType = "path";
    }
    if (Array.isArray(layer.keyframes)) {
      normalized.keyframes = layer.keyframes
        .map((keyframe) => {
          const normalizedKeyframe = { ...keyframe, time: Number(keyframe.time) };
          if (typeof keyframe.easing === "string") {
            normalizedKeyframe.easing = normalizeEasing(keyframe.easing) ?? keyframe.easing;
          }
          if (typeof keyframe.motionPath === "string") {
            normalizedKeyframe.motionPath = { path: keyframe.motionPath };
          }
          return normalizedKeyframe;
        })
        .sort((keyframeA, keyframeB) => Number(keyframeA.time) - Number(keyframeB.time));
    }
    return normalized;
  });
}

/** Strip merge-control markers so they are never stored as renderable data. */
function stripLayerMarkers(layer: VectorLayerInput): VectorLayer {
  const { action: _action, deleted: _deleted, replaceKeyframes: _replaceKeyframes, ...rest } = layer;
  return rest as unknown as VectorLayer;
}

/** Drop delete-marked layers and strip markers — for new-session storage. */
function toRenderableLayers(layers: VectorLayerInput[]): VectorLayer[] {
  return layers
    .filter((layer) => layer.action !== "delete" && layer.deleted !== true)
    .map(stripLayerMarkers);
}

/**
 * Non-structural layer fields the session merge copies verbatim when
 * present; an explicit null clears the field (e.g. parent: null unparents).
 */
const MERGEABLE_LAYER_FIELDS = [
  "opacity",
  "fillColor",
  "strokeColor",
  "strokeWidth",
  "imageUrl",
  "parent",
  "zIndex",
  "isMask",
  "maskedBy",
  "symbol",
  "timeScale",
  "timeOffset",
  "symbolLoop",
  "blur",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
] as const;

/**
 * Split an incoming symbols map into normalized upserts and removals.
 * Symbols replace whole per name (their layer lists are small and
 * self-contained; per-layer merging inside symbols isn't supported).
 */
function normalizeSymbolsInput(
  symbolsInput: Record<string, VectorSymbolInput | null> | undefined,
): { set: SymbolMap; remove: string[] } {
  const set: SymbolMap = {};
  const remove: string[] = [];
  for (const [symbolName, definition] of Object.entries(symbolsInput || {})) {
    if (definition === null || definition.action === "delete") {
      remove.push(symbolName);
      continue;
    }
    if (definition && typeof definition === "object" && Array.isArray(definition.layers)) {
      set[symbolName] = {
        layers: toRenderableLayers(normalizeVectorLayers(definition.layers)),
        ...(definition.duration != null ? { duration: Number(definition.duration) } : {}),
      };
    }
  }
  return { set, remove };
}

export function buildVectorAnimationEmbedHtml(
  animation: VectorAnimationConfig,
  options: VectorAnimationOptions = {},
  mode: { headless?: boolean } = {},
) {
  const {
    loop = true,
    autoplay = true,
  } = options;
  const headless = mode.headless === true;
  const width = Number(animation.width) || 800;
  const height = Number(animation.height) || 600;
  const background = sanitizeCssColor(animation.background, "#ffffff");
  const duration = Number(animation.duration) || 5;
  const titleHtml = options.title
    ? `<div id="animation-title">${escapeHtml(options.title)}</div>`
    : "";

  const animationJson = toEmbedScriptJson(animation);

  const engineScripts = buildEngineEmbedScript();

  return buildEmbedHtml({
    styles: `
      html, body {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        /* Neutral editor grey around the canvas (Flash/3D-viewport
           convention, matches the daylight embed palette) — the canvas
           keeps the animation's own background color. */
        background: #4c4c4c !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #player-container {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        overflow: hidden;
        /* Reserve the title zone (top) and floating-controls zone (bottom)
           so the centered canvas never slides underneath them. */
        box-sizing: border-box;
        padding: ${headless ? "16px" : options.title ? "56px" : "16px"} 16px ${headless ? "16px" : "78px"};
      }
      canvas {
        background: ${background};
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        border-radius: 12px;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      #controls {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        width: 90%;
        max-width: 600px;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 30px;
        padding: 8px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
        z-index: 10;
        transition: opacity 0.3s;
      }
      #controls.hidden {
        opacity: 0.1;
      }
      #controls:hover {
        opacity: 1;
      }
      button {
        background: none;
        border: none;
        color: #f8fafc;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        transition: background 0.2s, transform 0.1s;
      }
      button:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: scale(1.05);
      }
      button:active {
        transform: scale(0.95);
      }
      button svg {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }
      #timeline-slider {
        flex-grow: 1;
        -webkit-appearance: none;
        appearance: none;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.2);
        outline: none;
        cursor: pointer;
      }
      #timeline-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 10px #38bdf8;
        cursor: pointer;
        transition: transform 0.1s;
      }
      #timeline-slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
      }
      #time-display {
        color: #94a3b8;
        font-size: 11px;
        font-family: monospace;
        min-width: 148px;
        text-align: right;
      }
      #loop-btn.active {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.15);
      }
      #animation-title {
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        color: #f8fafc;
        font-size: 14px;
        font-weight: 600;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        padding: 6px 16px;
        z-index: 10;
      }
    `,
    bodyContent: `
      <div id="player-container">
        ${titleHtml}
        <canvas id="animation-canvas" width="${width}" height="${height}"></canvas>
        <div id="controls">
          <button id="play-pause-btn" title="Play/Pause">
            <svg id="play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg id="pause-icon" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <input type="range" id="timeline-slider" min="0" max="1000" value="0">
          <button id="loop-btn" class="${loop ? "active" : ""}" title="Toggle Loop">
            <svg viewBox="0 0 24 24"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>
          </button>
          <div id="time-display">f1/${Math.max(1, Math.round(duration * (Number(animation.fps) || 24)))} · 0.00 / ${duration.toFixed(2)}s</div>
        </div>
      </div>
    `,
    scripts: `
      <script>
      (function() {
        const animation = ${animationJson};
        const canvas = document.getElementById("animation-canvas");
        const ctx = canvas.getContext("2d");
        const playPauseButton = document.getElementById("play-pause-btn");
        const playIcon = document.getElementById("play-icon");
        const pauseIcon = document.getElementById("pause-icon");
        const loopButton = document.getElementById("loop-btn");
        const timelineSlider = document.getElementById("timeline-slider");
        const timeDisplay = document.getElementById("time-display");
        const controls = document.getElementById("controls");

        let duration = Number(animation.duration) || 5;
        const fps = Number(animation.fps) || 24;
        let isPlaying = ${autoplay && !headless};
        let isLooping = ${loop};
        let currentTime = 0;
        let lastFrameTime = performance.now();

        // Quantize render time to the authored fps so the advertised fps
        // parameter has a real effect (the loop itself is wall-clock rAF).
        function quantizeTime(t) {
          return Math.min(duration, Math.floor(t * fps) / fps);
        }

        ${engineScripts}

        const imageCache = new Map();
        function getLoadedImage(url) {
          if (!url) return null;
          if (imageCache.has(url)) {
            const cached = imageCache.get(url);
            if (cached.complete && cached.naturalWidth !== 0) {
              return cached;
            }
            return null;
          }
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {};
          img.src = url;
          imageCache.set(url, img);
          return null;
        }

        // ── Display-list render: parent/child tree, zIndex order, symbol
        // instances with their own timelines, mask clipping ──
        const treeIndex = buildTreeIndex(animation.layers || []);
        const symbols = animation.symbols || {};
        const symbolIndices = {};
        for (const symbolName in symbols) {
          symbolIndices[symbolName] = buildTreeIndex((symbols[symbolName] && symbols[symbolName].layers) || []);
        }

        function renderFrame(t) {
          // Paint the stage color into the bitmap (not just CSS) so
          // snapshots, filmstrips, and video exports keep the background.
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = ${JSON.stringify(background)};
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          drawLayerList(treeIndex, t, 1, 0);
        }

        function drawLayerList(index, t, inheritedAlpha, depth) {
          const baseTransform = ctx.getTransform();
          for (const layer of index.roots) {
            drawLayerNode(layer, index, t, inheritedAlpha, depth, baseTransform);
          }
        }

        // Compose a layer's ancestor-chain matrix within its scope — used to
        // express mask clip paths in the scope's base coordinate space.
        function getScopeMatrix(layerId, index, t) {
          const chain = [];
          const seen = {};
          let current = index.byId[layerId];
          while (current && !seen[current.id]) {
            seen[current.id] = true;
            chain.unshift(current);
            current = current.parent ? index.byId[current.parent] : null;
          }
          let matrix = new DOMMatrix();
          for (const chainLayer of chain) {
            const chainProps = resolveAnimatedProperties(chainLayer, t);
            matrix = matrix
              .translate(chainProps.x || 0, chainProps.y || 0)
              .rotate(chainProps.rotation || 0)
              .scale(chainProps.scaleX ?? 1, chainProps.scaleY ?? 1);
          }
          return matrix;
        }

        function buildLocalShapePath(layer, props) {
          const shapeData = layer.shapeData || {};
          const type = layer.shapeType;
          const path = new Path2D();
          if (type === "rectangle") {
            const width = props.width ?? shapeData.width ?? 100;
            const height = props.height ?? shapeData.height ?? 100;
            path.rect(-width / 2, -height / 2, width, height);
            return path;
          }
          if (type === "circle") {
            const radius = props.radius ?? shapeData.radius ?? 50;
            path.arc(0, 0, radius, 0, Math.PI * 2);
            return path;
          }
          if (type === "ellipse") {
            const rx = props.rx ?? shapeData.rx ?? 50;
            const ry = props.ry ?? shapeData.ry ?? 30;
            path.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            return path;
          }
          if (type === "polygon") {
            const points = props.points || shapeData.points || [];
            if (points.length === 0) return null;
            path.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1]);
            path.closePath();
            return path;
          }
          if (type === "path") {
            const pathStr = props.path || shapeData.path || "";
            return pathStr ? new Path2D(pathStr) : null;
          }
          return null;
        }

        function applyMaskClip(layer, index, t, baseTransform) {
          const maskLayer = index.byId[layer.maskedBy];
          if (!maskLayer) return;
          const maskProps = resolveAnimatedProperties(maskLayer, t);
          const localPath = buildLocalShapePath(maskLayer, maskProps);
          if (!localPath) return;
          const worldPath = new Path2D();
          worldPath.addPath(localPath, getScopeMatrix(maskLayer.id, index, t));
          const savedTransform = ctx.getTransform();
          ctx.setTransform(baseTransform);
          ctx.clip(worldPath);
          ctx.setTransform(savedTransform);
        }

        function drawLayerNode(layer, index, t, inheritedAlpha, depth, baseTransform) {
          if (layer.isMask) return;
          const props = resolveAnimatedProperties(layer, t);
          ctx.save();
          if (layer.maskedBy) applyMaskClip(layer, index, t, baseTransform);
          ctx.translate(props.x || 0, props.y || 0);
          ctx.rotate((props.rotation || 0) * Math.PI / 180);
          ctx.scale(props.scaleX ?? 1, props.scaleY ?? 1);

          const hasKeyframes = Array.isArray(layer.keyframes) && layer.keyframes.length > 0;
          const nodeAlpha = inheritedAlpha * (props.opacity ?? 1) * (hasKeyframes ? (layer.opacity ?? 1) : 1);

          if (layer.shapeType === "instance") {
            const symbolDefinition = symbols[layer.symbol];
            const symbolIndex = symbolIndices[layer.symbol];
            if (symbolDefinition && symbolIndex && depth < 8) {
              const localTime = getInstanceLocalTime(layer, t, getSymbolDuration(symbolDefinition, duration));
              drawLayerList(symbolIndex, localTime, nodeAlpha, depth + 1);
            }
          } else if (layer.shapeType !== "group") {
            drawShape(layer, props, nodeAlpha);
          }

          const children = index.childrenOf[layer.id];
          if (children) {
            for (const child of children) {
              drawLayerNode(child, index, t, nodeAlpha, depth, baseTransform);
            }
          }
          ctx.restore();
        }

        function resolveStyle(ctx, value) {
          if (!value || typeof value === "string") return value || "transparent";
          if (typeof value === "object") {
            if (value.type === "linear") {
              const grad = ctx.createLinearGradient(value.x1 || 0, value.y1 || 0, value.x2 || 0, value.y2 || 0);
              if (Array.isArray(value.stops)) {
                for (const stop of value.stops) {
                  grad.addColorStop(stop.offset ?? 0, stop.color || "transparent");
                }
              }
              return grad;
            }
            if (value.type === "radial") {
              const grad = ctx.createRadialGradient(
                value.x0 || 0, value.y0 || 0, value.r0 || 0,
                value.x1 || 0, value.y1 || 0, value.r1 || 0
              );
              if (Array.isArray(value.stops)) {
                for (const stop of value.stops) {
                  grad.addColorStop(stop.offset ?? 0, stop.color || "transparent");
                }
              }
              return grad;
            }
          }
          return "transparent";
        }

        function drawShape(layer, props, alpha) {
          ctx.save();
          ctx.globalAlpha = alpha;

          // Filters apply to this layer's own geometry only — child layers
          // draw in their own drawShape scope.
          const blurAmount = props.blur ?? layer.blur;
          if (typeof blurAmount === "number" && blurAmount > 0) {
            ctx.filter = "blur(" + blurAmount + "px)";
          }
          const shadowColor = props.shadowColor ?? layer.shadowColor;
          if (shadowColor && shadowColor !== "transparent") {
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = props.shadowBlur ?? layer.shadowBlur ?? 8;
            ctx.shadowOffsetX = props.shadowOffsetX ?? layer.shadowOffsetX ?? 0;
            ctx.shadowOffsetY = props.shadowOffsetY ?? layer.shadowOffsetY ?? 0;
          }

          const fillValue = props.fillColor || layer.fillColor;
          const strokeValue = props.strokeColor || layer.strokeColor;
          const hasFill = !!fillValue && fillValue !== "transparent";
          const hasStroke = !!strokeValue && strokeValue !== "transparent";
          ctx.fillStyle = resolveStyle(ctx, fillValue);
          ctx.strokeStyle = resolveStyle(ctx, strokeValue);
          ctx.lineWidth = props.strokeWidth ?? layer.strokeWidth ?? 1;

          ctx.beginPath();
          const type = layer.shapeType;
          const shapeData = layer.shapeData || {};

          if (type === "rectangle") {
            const width = props.width ?? shapeData.width ?? 100;
            const height = props.height ?? shapeData.height ?? 100;
            const rx = props.rx ?? shapeData.rx ?? 0;
            const ry = props.ry ?? shapeData.ry ?? 0;
            if (rx > 0 || ry > 0) {
              ctx.roundRect(-width/2, -height/2, width, height, [rx, ry]);
            } else {
              ctx.rect(-width/2, -height/2, width, height);
            }
          } else if (type === "circle") {
            const radius = props.radius ?? shapeData.radius ?? 50;
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
          } else if (type === "ellipse") {
            const rx = props.rx ?? shapeData.rx ?? 50;
            const ry = props.ry ?? shapeData.ry ?? 30;
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          } else if (type === "line") {
            const x1 = shapeData.x1 ?? 0;
            const y1 = shapeData.y1 ?? 0;
            const x2 = shapeData.x2 ?? 100;
            const y2 = shapeData.y2 ?? 100;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
          } else if (type === "polygon") {
            const points = props.points || shapeData.points || [];
            if (points.length > 0) {
              ctx.moveTo(points[0][0], points[0][1]);
              for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i][0], points[i][1]);
              }
              ctx.closePath();
            }
          } else if (type === "path") {
            const pathStr = props.path || shapeData.path || "";
            if (pathStr) {
              const path2d = new Path2D(pathStr);
              const imageUrl = props.imageUrl || layer.imageUrl;
              const imageElement = getLoadedImage(imageUrl);
              if (imageElement) {
                ctx.save();
                ctx.clip(path2d);
                ctx.drawImage(imageElement, -canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2);
                ctx.restore();
              } else if (hasFill) {
                ctx.fill(path2d);
              }
              if (hasStroke) ctx.stroke(path2d);
              ctx.restore();
              return;
            }
          } else if (type === "text") {
            const textVal = props.text ?? shapeData.text ?? "";
            const fontSize = props.fontSize ?? shapeData.fontSize ?? 20;
            const fontFamily = shapeData.fontFamily || "system-ui, sans-serif";
            ctx.font = fontSize + "px " + fontFamily;
            ctx.textAlign = shapeData.textAlign || "center";
            ctx.textBaseline = shapeData.textBaseline || "middle";
            if (hasFill) ctx.fillText(textVal, 0, 0);
            if (hasStroke) ctx.strokeText(textVal, 0, 0);
          }

          const imageUrl = props.imageUrl || layer.imageUrl;
          const imageElement = getLoadedImage(imageUrl);

          if (imageElement && type !== "line" && type !== "text" && type !== "path") {
            ctx.save();
            ctx.clip();
            let xValue = -50, yValue = -50, widthValue = 100, heightValue = 100;
            if (type === "rectangle") {
              const rectWidth = props.width ?? shapeData.width ?? 100;
              const rectHeight = props.height ?? shapeData.height ?? 100;
              xValue = -rectWidth / 2;
              yValue = -rectHeight / 2;
              widthValue = rectWidth;
              heightValue = rectHeight;
            } else if (type === "circle") {
              const circleRadius = props.radius ?? shapeData.radius ?? 50;
              xValue = -circleRadius;
              yValue = -circleRadius;
              widthValue = circleRadius * 2;
              heightValue = circleRadius * 2;
            } else if (type === "ellipse") {
              const ellipseRadiusX = props.rx ?? shapeData.rx ?? 50;
              const ellipseRadiusY = props.ry ?? shapeData.ry ?? 30;
              xValue = -ellipseRadiusX;
              yValue = -ellipseRadiusY;
              widthValue = ellipseRadiusX * 2;
              heightValue = ellipseRadiusY * 2;
            } else if (type === "polygon") {
              const polygonPoints = props.points || shapeData.points || [];
              if (polygonPoints.length > 0) {
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const point of polygonPoints) {
                  if (point[0] < minX) minX = point[0];
                  if (point[0] > maxX) maxX = point[0];
                  if (point[1] < minY) minY = point[1];
                  if (point[1] > maxY) maxY = point[1];
                }
                xValue = minX;
                yValue = minY;
                widthValue = maxX - minX;
                heightValue = maxY - minY;
              }
            }
            ctx.drawImage(imageElement, xValue, yValue, widthValue, heightValue);
            ctx.restore();
          } else if (hasFill && type !== "line" && type !== "path") {
            ctx.fill();
          }

          if (hasStroke && type !== "path") {
            ctx.stroke();
          }

          ctx.restore();
        }

        function updateUI() {
          timelineSlider.value = Math.round((currentTime / duration) * 1000);
          // Flash-style readout: current frame alongside the timecode.
          const totalFrames = Math.max(1, Math.round(duration * fps));
          const currentFrame = Math.min(totalFrames, Math.floor(currentTime * fps) + 1);
          timeDisplay.textContent =
            "f" + currentFrame + "/" + totalFrames + " · " +
            currentTime.toFixed(2) + " / " + duration.toFixed(2) + "s";
          if (isPlaying) {
            playIcon.style.display = "none";
            pauseIcon.style.display = "block";
          } else {
            playIcon.style.display = "block";
            pauseIcon.style.display = "none";
          }
        }

        function loop(timestamp) {
          const delta = (timestamp - lastFrameTime) / 1000;
          lastFrameTime = timestamp;

          if (isPlaying) {
            currentTime += delta;
            if (currentTime >= duration) {
              if (isLooping) {
                currentTime = 0;
              } else {
                currentTime = duration;
                isPlaying = false;
              }
            }
            updateUI();
          }

          renderFrame(quantizeTime(currentTime));
          requestAnimationFrame(loop);
        }

        playPauseButton.addEventListener("click", () => {
          isPlaying = !isPlaying;
          if (isPlaying && currentTime >= duration) {
            currentTime = 0;
          }
          lastFrameTime = performance.now();
          updateUI();
        });

        loopButton.addEventListener("click", () => {
          isLooping = !isLooping;
          loopButton.classList.toggle("active", isLooping);
        });

        timelineSlider.addEventListener("input", (event) => {
          isPlaying = false;
          currentTime = (parseInt(event.target.value) / 1000) * duration;
          updateUI();
          renderFrame(quantizeTime(currentTime));
        });

        let controlsTimeout;
        function resetControlsTimer() {
          controls.classList.remove("hidden");
          clearTimeout(controlsTimeout);
          controlsTimeout = setTimeout(() => {
            if (isPlaying) controls.classList.add("hidden");
          }, 3000);
        }
        document.addEventListener("mousemove", resetControlsTimer);
        document.addEventListener("click", resetControlsTimer);

        // ── Headless/snapshot hooks: deterministic frame rendering for the
        // server-side snapshot filmstrip and video export pipelines ──
        function collectImageUrls() {
          const urls = [];
          const addFromLayers = (layers) => {
            for (const layer of layers || []) {
              if (typeof layer.imageUrl === "string" && /^(https?:|data:)/.test(layer.imageUrl)) urls.push(layer.imageUrl);
              for (const keyframe of layer.keyframes || []) {
                const kfUrl = keyframe.properties && keyframe.properties.imageUrl;
                if (typeof kfUrl === "string" && /^(https?:|data:)/.test(kfUrl)) urls.push(kfUrl);
              }
            }
          };
          addFromLayers(animation.layers);
          for (const symbolName in symbols) addFromLayers(symbols[symbolName].layers);
          return urls;
        }

        window.__vaReady = Promise.all(
          collectImageUrls().map((url) => new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => { imageCache.set(url, img); resolve(true); };
            img.onerror = () => resolve(false);
            img.src = url;
            setTimeout(() => resolve(false), 4000);
          })),
        ).then(() => true);

        window.__vaRenderAt = function(t) {
          renderFrame(Math.max(0, Math.min(duration, t)));
          return canvas.toDataURL("image/png");
        };

        // Debug snapshot: coordinate grid + world-space bounding boxes with
        // layer ids, so an agent can see WHERE its layers are, not just how
        // the frame looks.
        function estimateLocalBox(layer, props) {
          const shapeData = layer.shapeData || {};
          const type = layer.shapeType;
          if (type === "rectangle") {
            const w = props.width ?? shapeData.width ?? 100;
            const h = props.height ?? shapeData.height ?? 100;
            return { minX: -w/2, minY: -h/2, maxX: w/2, maxY: h/2 };
          }
          if (type === "circle") {
            const r = props.radius ?? shapeData.radius ?? 50;
            return { minX: -r, minY: -r, maxX: r, maxY: r };
          }
          if (type === "ellipse") {
            const rx = props.rx ?? shapeData.rx ?? 50;
            const ry = props.ry ?? shapeData.ry ?? 30;
            return { minX: -rx, minY: -ry, maxX: rx, maxY: ry };
          }
          if (type === "polygon" || type === "path" || type === "line") {
            let coords = [];
            if (type === "polygon") {
              coords = (props.points || shapeData.points || []).flat();
            } else if (type === "line") {
              coords = [shapeData.x1 ?? 0, shapeData.y1 ?? 0, shapeData.x2 ?? 100, shapeData.y2 ?? 100];
            } else {
              coords = (String(props.path || shapeData.path || "").match(/-?\\d*\\.?\\d+/g) || []).map(Number);
            }
            if (coords.length < 4) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i + 1 < coords.length; i += 2) {
              minX = Math.min(minX, coords[i]); maxX = Math.max(maxX, coords[i]);
              minY = Math.min(minY, coords[i+1]); maxY = Math.max(maxY, coords[i+1]);
            }
            return { minX, minY, maxX, maxY };
          }
          if (type === "text") {
            const textVal = String(props.text ?? shapeData.text ?? "");
            const fontSize = props.fontSize ?? shapeData.fontSize ?? 20;
            const w = Math.max(fontSize, textVal.length * fontSize * 0.6);
            return { minX: -w/2, minY: -fontSize/2, maxX: w/2, maxY: fontSize/2 };
          }
          return null;
        }

        function drawDebugOverlay(t) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          // Grid: light lines every 50px, labels every 100px.
          ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
          ctx.lineWidth = 1;
          ctx.font = "10px monospace";
          for (let x = 0; x <= canvas.width; x += 50) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
            if (x % 100 === 0) { ctx.fillStyle = "rgba(226, 232, 240, 0.7)"; ctx.fillText(String(x), x + 2, 10); }
          }
          for (let y = 0; y <= canvas.height; y += 50) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
            if (y % 100 === 0 && y > 0) { ctx.fillStyle = "rgba(226, 232, 240, 0.7)"; ctx.fillText(String(y), 2, y - 2); }
          }

          // Layer boxes/markers in world space (top-level scope only).
          for (const id in treeIndex.byId) {
            const layer = treeIndex.byId[id];
            const props = resolveAnimatedProperties(layer, t);
            const matrix = getScopeMatrix(layer.id, treeIndex, t);
            const isMarkerOnly = layer.shapeType === "group" || layer.shapeType === "instance";
            const color = layer.isMask ? "#a78bfa" : isMarkerOnly ? "#34d399" : "#f43f5e";
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.setLineDash(layer.isMask ? [4, 4] : []);
            ctx.lineWidth = 1;

            let labelX, labelY;
            const box = isMarkerOnly ? null : estimateLocalBox(layer, props);
            if (box) {
              const corners = [
                matrix.transformPoint(new DOMPoint(box.minX, box.minY)),
                matrix.transformPoint(new DOMPoint(box.maxX, box.minY)),
                matrix.transformPoint(new DOMPoint(box.maxX, box.maxY)),
                matrix.transformPoint(new DOMPoint(box.minX, box.maxY)),
              ];
              ctx.beginPath();
              ctx.moveTo(corners[0].x, corners[0].y);
              for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
              ctx.closePath();
              ctx.stroke();
              labelX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
              labelY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
            } else {
              const origin = matrix.transformPoint(new DOMPoint(0, 0));
              ctx.beginPath();
              ctx.moveTo(origin.x - 6, origin.y); ctx.lineTo(origin.x + 6, origin.y);
              ctx.moveTo(origin.x, origin.y - 6); ctx.lineTo(origin.x, origin.y + 6);
              ctx.stroke();
              labelX = origin.x + 4;
              labelY = origin.y - 4;
            }
            ctx.setLineDash([]);
            ctx.font = "11px monospace";
            const label = layer.id + (layer.isMask ? " (mask)" : layer.shapeType === "group" ? " (group)" : layer.shapeType === "instance" ? " (instance)" : "");
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = "rgba(2, 6, 23, 0.75)";
            ctx.fillRect(labelX, labelY - 12, textWidth + 6, 13);
            ctx.fillStyle = color;
            ctx.fillText(label, labelX + 3, labelY - 2);
          }
          ctx.restore();
        }

        window.__vaRenderDebugAt = function(t) {
          const clamped = Math.max(0, Math.min(duration, t));
          renderFrame(clamped);
          drawDebugOverlay(clamped);
          return canvas.toDataURL("image/png");
        };

        if (${headless}) {
          controls.style.display = "none";
          renderFrame(0);
        } else {
          updateUI();
          requestAnimationFrame(loop);
        }
      })();
      </script>
    `
  });
}

const vectorAnimationEmbeds = new Map();
const EMBED_CACHE_TTL_MS = 30 * 60_000; // 30 min

function cleanupVectorAnimationEmbeds() {
  const now = Date.now();
  for (const [id, embed] of vectorAnimationEmbeds) {
    if (now - embed.updatedAt > EMBED_CACHE_TTL_MS)
      vectorAnimationEmbeds.delete(id);
  }
}

// Snapshot filmstrips / exported videos when MinIO is unavailable — served
// by GET /vector-animation/asset with the same TTL as embeds.
const vectorAnimationAssets = new Map<string, { buffer: Buffer; mimeType: string; updatedAt: number }>();

function cleanupVectorAnimationAssets() {
  const now = Date.now();
  for (const [id, asset] of vectorAnimationAssets) {
    if (now - asset.updatedAt > EMBED_CACHE_TTL_MS)
      vectorAnimationAssets.delete(id);
  }
}

/** Store a rendered asset: MinIO when available, else the in-memory map. */
async function storeVectorAnimationAsset(buffer: Buffer, mimeType: string): Promise<string> {
  const minioUrl = await MinioService.uploadToolAsset(buffer, mimeType);
  if (minioUrl) return minioUrl;
  const assetId = crypto.randomUUID().slice(0, 12);
  vectorAnimationAssets.set(assetId, { buffer, mimeType, updatedAt: Date.now() });
  cleanupVectorAnimationAssets();
  return buildLocalUrl("creative/vector-animation/asset", { id: assetId });
}

router.post("/vector-animation", asyncHandler(async (req: Request, res: Response) => {
  const { options, sessionId, referenceImageUrl } = req.body;
  let { animation } = req.body;

  // Models frequently send `animation` as a JSON-encoded string. Before this
  // was parsed, those calls "succeeded" with an empty animation (0 layers,
  // 0 keyframes) — parse it, or reject with a format the model can copy.
  if (typeof animation === "string") {
    try {
      animation = JSON.parse(animation);
    } catch {
      return res.status(400).json({
        error:
          "'animation' was sent as a string that is not valid JSON. Send it as a JSON " +
          "object, e.g. {\"duration\": 5, \"layers\": [{\"id\": \"ball\", \"shapeType\": " +
          "\"circle\", \"shapeData\": {\"radius\": 40}, \"fillColor\": \"#38bdf8\", " +
          "\"keyframes\": [...]}]}",
      });
    }
  }
  if (!animation || typeof animation !== "object" || Array.isArray(animation)) {
    return res.status(400).json({
      error:
        "'animation' is required and must be an object with a 'layers' array. To change " +
        "only settings (duration, fps, background) or retime an existing session, pass " +
        "your sessionId with animation: {\"layers\": []} plus the fields to change.",
    });
  }
  // Unwrap accidental double-nesting ({animation: {animation: {...}}}).
  if (!animation.layers && animation.animation && typeof animation.animation === "object") {
    animation = { ...animation, ...animation.animation };
    delete animation.animation;
  }

  const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : sessionId;
  if (trimmedSessionId !== undefined && trimmedSessionId !== null && trimmedSessionId !== "") {
    if (
      typeof trimmedSessionId !== "string" ||
      trimmedSessionId === "null" ||
      trimmedSessionId === "undefined"
    ) {
      return res.status(400).json({
        error:
          `Invalid sessionId (got: ${JSON.stringify(trimmedSessionId)}). Pass the exact ` +
          `sessionId string returned by a previous call, or omit it to create a new animation.`,
      });
    }
    if (!vectorAnimationSessions.has(trimmedSessionId)) {
      // Sessions survive restarts via Mongo — hydrate on miss.
      try {
        const storedSession = await getVectorAnimationSession(trimmedSessionId);
        if (storedSession) {
          vectorAnimationSessions.set(trimmedSessionId, {
            animation: storedSession.animation,
            options: storedSession.options || {},
            updatedAt: Date.now(),
          });
        }
      } catch {
        // DB unavailable — fall through to the not-found error below.
      }
    }
    if (!vectorAnimationSessions.has(trimmedSessionId)) {
      return res.status(400).json({
        error:
          `Session '${trimmedSessionId}' not found or expired (sessions are kept for 7 ` +
          `days after the last edit). Omit sessionId to create a new animation — the ` +
          `response returns a server-assigned sessionId for later edits — and resend the ` +
          `complete animation, not just the changes.`,
      });
    }
  }

  const validationError = validateVectorAnimationInput(animation);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { username: callerUsername } = extractCallerContext(req);
  const isExistingSession = !!(trimmedSessionId && vectorAnimationSessions.has(trimmedSessionId));

  const requestedWidth = animation.width != null ? Number(animation.width) : undefined;
  const requestedHeight = animation.height != null ? Number(animation.height) : undefined;
  const clampWarnings: string[] = [];
  if (requestedWidth !== undefined && requestedWidth > 1920) {
    clampWarnings.push(`width ${requestedWidth} was clamped to 1920`);
  }
  if (requestedHeight !== undefined && requestedHeight > 1080) {
    clampWarnings.push(`height ${requestedHeight} was clamped to 1080`);
  }

  let sessionAnimation = {
    width: Math.min(requestedWidth || 800, 1920),
    height: Math.min(requestedHeight || 600, 1080),
    duration: animation.duration != null ? Number(animation.duration) : 5,
    fps: animation.fps != null ? Number(animation.fps) : 24,
    background: animation.background || "#ffffff",
    layers: [] as VectorLayer[],
    symbols: {} as SymbolMap,
  };

  const animationOptions: { loop: boolean; autoplay: boolean; title?: string } = {
    loop: options?.loop !== false,
    autoplay: options?.autoplay !== false,
  };
  if (typeof options?.title === "string" && options.title.trim()) {
    animationOptions.title = options.title.trim();
  }

  const activeSessionId = isExistingSession
    ? trimmedSessionId
    : crypto.randomUUID().slice(0, 12);

  const normalizedLayers = normalizeVectorLayers(animation.layers || []);
  sessionAnimation.layers = toRenderableLayers(normalizedLayers);
  const symbolsPatch = normalizeSymbolsInput(animation.symbols);
  sessionAnimation.symbols = symbolsPatch.set;

  // Keyframes past the effective duration would never play — reject with
  // guidance instead of counting them toward totalKeyframes.
  const effectiveDuration =
    animation.duration != null
      ? Number(animation.duration)
      : isExistingSession
        ? Number(vectorAnimationSessions.get(trimmedSessionId).animation.duration) || 5
        : sessionAnimation.duration;
  const keyframeTimeError = findKeyframeBeyondDuration(normalizedLayers, effectiveDuration);
  if (keyframeTimeError) {
    return res.status(400).json({ error: keyframeTimeError });
  }

  // A layer that doesn't already exist in the session must declare its shape —
  // without one the player would silently render nothing for it.
  const existingLayerIds = new Set<string>(
    isExistingSession
      ? vectorAnimationSessions.get(trimmedSessionId).animation.layers.map((layer: VectorLayer) => layer.id)
      : [],
  );
  for (const layer of normalizedLayers) {
    if (layer.action === "delete" || layer.deleted === true) continue;
    if (!layer.shapeType && !existingLayerIds.has(layer.id)) {
      return res.status(400).json({
        error:
          `Layer '${layer.id}' is new, so it needs a 'shapeType' (rectangle, circle, ` +
          `ellipse, line, polygon, path, text, group, or instance — instance is implied ` +
          `when 'symbol' is set). shapeType may only be omitted when updating a layer ` +
          `that already exists in the session.`,
      });
    }
  }

  if (isExistingSession) {
    const session = vectorAnimationSessions.get(trimmedSessionId);

    // Merge into a clone and validate the merged result before committing,
    // so a bad reference (parent cycle, unknown symbol) never corrupts the
    // session state the agent keeps building on.
    let nextAnimation: VectorAnimationConfig;
    if (options?.clearSession === true || animation.clearSession === true) {
      nextAnimation = { ...sessionAnimation };
    } else {
      nextAnimation = structuredClone(session.animation) as VectorAnimationConfig;
      if (animation.width) nextAnimation.width = sessionAnimation.width;
      if (animation.height) nextAnimation.height = sessionAnimation.height;
      if (animation.duration) nextAnimation.duration = sessionAnimation.duration;
      if (animation.fps) nextAnimation.fps = sessionAnimation.fps;
      if (animation.background) nextAnimation.background = animation.background;

      if (!nextAnimation.symbols) nextAnimation.symbols = {};
      for (const symbolName of symbolsPatch.remove) delete nextAnimation.symbols[symbolName];
      Object.assign(nextAnimation.symbols, symbolsPatch.set);

      // Retime existing keyframes ("make it slower/faster/later") before
      // merging this call's layers. Global retime rescales the duration too.
      const retime = (animation as { retime?: { scale?: number; offset?: number; layerIds?: string[] } }).retime;
      if (retime && typeof retime === "object") {
        const scale = retime.scale !== undefined ? Number(retime.scale) : 1;
        const offset = retime.offset !== undefined ? Number(retime.offset) : 0;
        const targetIds =
          Array.isArray(retime.layerIds) && retime.layerIds.length > 0 ? new Set(retime.layerIds) : null;
        if (!targetIds) {
          nextAnimation.duration = Math.max(
            0.1,
            (Number(nextAnimation.duration) || 5) * scale + Math.max(0, offset),
          );
        }
        const maxTime = Number(nextAnimation.duration) || 5;
        for (const targetLayer of nextAnimation.layers) {
          if (targetIds && !targetIds.has(targetLayer.id)) continue;
          for (const keyframe of targetLayer.keyframes || []) {
            keyframe.time = Math.max(0, Math.min(maxTime, Number(keyframe.time) * scale + offset));
          }
          targetLayer.keyframes?.sort((keyframeA, keyframeB) => keyframeA.time - keyframeB.time);
        }
      }

      for (const newLayer of normalizedLayers) {
        // Support layer deletion
        if (newLayer.action === "delete" || newLayer.deleted === true) {
          nextAnimation.layers = nextAnimation.layers.filter((layer: VectorLayer) => layer.id !== newLayer.id);
          continue;
        }

        const existingLayer = nextAnimation.layers.find((layer: VectorLayer) => layer.id === newLayer.id);
        if (existingLayer) {
          if (newLayer.shapeType) existingLayer.shapeType = newLayer.shapeType as VectorLayer["shapeType"];
          if (newLayer.shapeData) existingLayer.shapeData = { ...existingLayer.shapeData, ...newLayer.shapeData } as VectorLayer["shapeData"];
          for (const field of MERGEABLE_LAYER_FIELDS) {
            const value = (newLayer as unknown as Record<string, unknown>)[field];
            if (value === undefined) continue;
            if (value === null) delete (existingLayer as unknown as Record<string, unknown>)[field];
            else (existingLayer as unknown as Record<string, unknown>)[field] = value;
          }

          if (newLayer.keyframes && Array.isArray(newLayer.keyframes)) {
            if (newLayer.replaceKeyframes === true) {
              existingLayer.keyframes = [...newLayer.keyframes] as Keyframe[];
            } else {
              if (!existingLayer.keyframes) existingLayer.keyframes = [];
              for (const newKf of newLayer.keyframes) {
                // Epsilon match: 0.3333 should update the keyframe stored at
                // 0.333 rather than pile up a float-precision duplicate.
                const existingKfIndex = existingLayer.keyframes.findIndex((keyframe: Keyframe) => Math.abs(Number(keyframe.time) - Number(newKf.time)) < 0.001);
                if (existingKfIndex !== -1) {
                  existingLayer.keyframes[existingKfIndex].properties = {
                    ...existingLayer.keyframes[existingKfIndex].properties,
                    ...newKf.properties,
                  } as Keyframe["properties"];
                  if (newKf.easing) existingLayer.keyframes[existingKfIndex].easing = newKf.easing;
                  if (newKf.motionPath) existingLayer.keyframes[existingKfIndex].motionPath = newKf.motionPath as Keyframe["motionPath"];
                } else {
                  existingLayer.keyframes.push(newKf as unknown as Keyframe);
                }
              }
            }
            existingLayer.keyframes.sort((keyframeA: Keyframe, keyframeB: Keyframe) => keyframeA.time - keyframeB.time);
          }
        } else {
          nextAnimation.layers.push(stripLayerMarkers(newLayer));
        }
      }
    }

    const mergedError = validateMergedAnimation(nextAnimation as Parameters<typeof validateMergedAnimation>[0]);
    if (mergedError) {
      return res.status(400).json({ error: mergedError });
    }
    session.animation = nextAnimation;

    if (options) {
      if (options.loop !== undefined) session.options.loop = options.loop;
      if (options.autoplay !== undefined) session.options.autoplay = options.autoplay;
      if (typeof options.title === "string") {
        session.options.title = options.title.trim() || undefined;
      }
    }

    session.updatedAt = Date.now();
    sessionAnimation = session.animation;
  } else {
    const mergedError = validateMergedAnimation(sessionAnimation as Parameters<typeof validateMergedAnimation>[0]);
    if (mergedError) {
      return res.status(400).json({ error: mergedError });
    }
    vectorAnimationSessions.set(activeSessionId, {
      animation: sessionAnimation,
      options: animationOptions,
      updatedAt: Date.now(),
    });
    cleanupVectorAnimationSessions();
  }

  if (referenceImageUrl && typeof referenceImageUrl === "string") {
    const imageFillShapeTypes = ["rectangle", "circle", "ellipse", "polygon", "path"];
    const imagePlaceholderValues = ["placeholder", "reference"];
    const substituteReferenceImages = (layers: VectorLayer[]) => {
      for (const layer of layers) {
        if (layer && typeof layer === "object") {
          const isCompatibleShape = imageFillShapeTypes.includes(layer.shapeType);
          if (isCompatibleShape && typeof layer.imageUrl === "string" && imagePlaceholderValues.includes(layer.imageUrl)) {
            layer.imageUrl = referenceImageUrl;

            if (layer.keyframes && Array.isArray(layer.keyframes)) {
              for (const keyframe of layer.keyframes) {
                if (keyframe?.properties && typeof keyframe.properties === "object") {
                  const keyframeProperties = keyframe.properties;
                  if (typeof keyframeProperties.imageUrl === "string" && imagePlaceholderValues.includes(keyframeProperties.imageUrl)) {
                    keyframeProperties.imageUrl = referenceImageUrl;
                  }
                }
              }
            }
          }
        }
      }
    };
    substituteReferenceImages(sessionAnimation.layers);
    for (const symbolDefinition of Object.values(sessionAnimation.symbols || {})) {
      substituteReferenceImages(symbolDefinition.layers || []);
    }
  }

  // Persist the working session so iteration survives restarts and long
  // gaps (Mongo TTL: 7 days). Failure is non-fatal — memory still works.
  {
    const activeSession = vectorAnimationSessions.get(activeSessionId);
    if (activeSession) {
      saveVectorAnimationSession(activeSessionId, activeSession.animation, activeSession.options).catch((error: unknown) => {
        logger.warn(`[CreativeRoutes] vector-animation session persist failed: ${errorMessage(error)}`);
      });
    }
  }

  const embedId = crypto.randomUUID().slice(0, 12);
  await saveVectorAnimation(embedId, sessionAnimation, animationOptions, activeSessionId, callerUsername);
  
  vectorAnimationEmbeds.set(embedId, {
    animation: sessionAnimation,
    options: animationOptions,
    updatedAt: Date.now(),
  });
  cleanupVectorAnimationEmbeds();
  
  const embedUrl = buildLocalUrl("creative/vector-animation/embed", { id: embedId });
  const totalKeyframes = sessionAnimation.layers.reduce((sum: number, layer: VectorLayer) => sum + (layer.keyframes?.length || 0), 0);
  const layerIds = sessionAnimation.layers.map((layer: VectorLayer) => layer.id);
  const symbolNames = Object.keys(sessionAnimation.symbols || {});

  // Static sanity analysis — catches the silent failures (off-canvas,
  // invisible, empty symbols, float-dupe keyframes) on every call.
  let lintWarnings: string[] = [];
  try {
    lintWarnings = lintAnimation(sessionAnimation as Parameters<typeof lintAnimation>[0]);
  } catch (error: unknown) {
    logger.warn(`[CreativeRoutes] vector-animation lint failed: ${errorMessage(error)}`);
  }

  // ── Optional server-side rendering: snapshot filmstrip (agent
  // self-inspection via describe_image) and mp4/gif export ──
  let snapshotInfo: { url: string; times: number[]; mode?: string } | null = null;
  let exportInfo: { url: string; format: "mp4" | "gif"; audio?: boolean } | null = null;
  const featureNotes: string[] = [...clampWarnings, ...lintWarnings];

  const snapshotDebug = options?.snapshot === "debug";
  const wantsSnapshot =
    options?.snapshot === true ||
    snapshotDebug ||
    (Array.isArray(options?.snapshotTimes) && options.snapshotTimes.length > 0);
  const exportFormat: "mp4" | "gif" | null =
    options?.export === "mp4" || options?.export === "gif" ? options.export : null;

  if (wantsSnapshot || exportFormat) {
    const durationSeconds = Number(sessionAnimation.duration) || 5;
    const headlessHtml = buildVectorAnimationEmbedHtml(
      sessionAnimation,
      { ...animationOptions, autoplay: false },
      { headless: true },
    );

    if (wantsSnapshot) {
      try {
        const requestedTimes: unknown[] =
          Array.isArray(options?.snapshotTimes) && options.snapshotTimes.length > 0
            ? options.snapshotTimes
            : [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * durationSeconds);
        const times = requestedTimes
          .slice(0, 8)
          .map((time) => Math.max(0, Math.min(durationSeconds, Number(time) || 0)));
        const frames = await renderAnimationFrames(headlessHtml, times, { debug: snapshotDebug });
        const filmstrip = await buildFilmstripImage(frames, times);
        snapshotInfo = {
          url: await storeVectorAnimationAsset(filmstrip, "image/png"),
          times,
          ...(snapshotDebug && { mode: "debug" }),
        };
      } catch (error: unknown) {
        featureNotes.push(`snapshot rendering failed (${errorMessage(error)})`);
        logger.warn(`[CreativeRoutes] vector-animation snapshot failed: ${errorMessage(error)}`);
      }
    }

    if (exportFormat) {
      try {
        const fpsValue = Number(sessionAnimation.fps) || 24;
        const MAX_EXPORT_FRAMES = 600;
        const frameCount = Math.max(2, Math.min(Math.round(durationSeconds * fpsValue) + 1, MAX_EXPORT_FRAMES));
        const effectiveFps = (frameCount - 1) / durationSeconds;
        const times = Array.from({ length: frameCount }, (_, index) => index / effectiveFps);
        const frames = await renderAnimationFrames(headlessHtml, times);
        const audioUrl =
          exportFormat === "mp4" && typeof options?.audioUrl === "string" && /^(https?:|data:)/.test(options.audioUrl)
            ? options.audioUrl
            : undefined;
        if (options?.audioUrl && exportFormat === "gif") {
          featureNotes.push("audioUrl ignored for gif export — use export: 'mp4' for sound");
        }
        const encoded = await encodeAnimationVideo(frames, effectiveFps, exportFormat, audioUrl);
        exportInfo = {
          url: await storeVectorAnimationAsset(encoded.buffer, encoded.mimeType),
          format: exportFormat,
          ...(audioUrl && { audio: true }),
        };
      } catch (error: unknown) {
        featureNotes.push(`${exportFormat} export failed (${errorMessage(error)})`);
        logger.warn(`[CreativeRoutes] vector-animation export failed: ${errorMessage(error)}`);
      }
    }
  }

  const noteSuffix = featureNotes.length > 0 ? ` Note: ${featureNotes.join("; ")}.` : "";
  const snapshotSuffix = snapshotInfo
    ? ` Filmstrip snapshot rendered at [${snapshotInfo.times.map((time) => time.toFixed(2)).join(", ")}]s — ` +
      `the filmstrip image is attached for you to inspect (fallback: pass snapshot.url to describe_image).`
    : "";
  const exportSuffix = exportInfo
    ? ` Exported ${exportInfo.format} is attached for the user.`
    : "";
  const message =
    `Animation ${isExistingSession ? "updated" : "created"}: ${sessionAnimation.layers.length} ` +
    `layer(s) [${layerIds.join(", ")}], ${totalKeyframes} keyframe(s)` +
    (symbolNames.length > 0 ? `, ${symbolNames.length} symbol(s) [${symbolNames.join(", ")}]` : "") +
    `, ${sessionAnimation.duration}s at ${sessionAnimation.fps}fps. The user can see this ` +
    `version now. To keep building on it, call again with sessionId '${activeSessionId}' and ` +
    `only the layers you are adding or changing — layers merge by id, keyframes merge by time, ` +
    `layers with {"action": "delete"} are removed, and the session is kept for 7 days.` +
    snapshotSuffix +
    exportSuffix +
    noteSuffix;

  const display = exportInfo
    ? buildDisplay(exportInfo.format === "mp4" ? "video" : "image", exportInfo.url, {
        title: `Vector Animation (${exportInfo.format})`,
      })
    : buildDisplay("embed", embedUrl, { height: 480, title: "Vector Animation" });

  res.json({
    message,
    embedUrl,
    display,
    sessionId: activeSessionId,
    animationId: embedId,
    duration: sessionAnimation.duration,
    layerCount: sessionAnimation.layers.length,
    layerIds,
    ...(symbolNames.length > 0 && { symbolNames }),
    totalKeyframes,
    canvasSize: `${sessionAnimation.width}x${sessionAnimation.height}`,
    isAppend: isExistingSession,
    ...(lintWarnings.length > 0 && { warnings: lintWarnings }),
    ...(snapshotInfo && { snapshot: snapshotInfo }),
    ...(exportInfo && { export: exportInfo }),
    // Session readback for context recovery: pass options.includeState with
    // animation.layers: [] to read the merged state without changing it.
    ...(options?.includeState === true && {
      state: {
        animation: sessionAnimation,
        options: vectorAnimationSessions.get(activeSessionId)?.options ?? animationOptions,
      },
    }),
  });
}));

router.get("/vector-animation/embed", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.query as Record<string, string>;
  if (!id) return res.status(400).send("Missing 'id' parameter");
  
  let entry = await getVectorAnimation(id);
  if (!entry) {
    entry = vectorAnimationEmbeds.get(id) || null;
  }
  
  if (!entry) {
    return res.status(404).send("Vector animation not found or expired");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildVectorAnimationEmbedHtml(entry.animation, entry.options));
}));

// Serves snapshot filmstrips / exports when MinIO is unavailable.
router.get("/vector-animation/asset", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.query as Record<string, string>;
  if (!id) return res.status(400).send("Missing 'id' parameter");
  const asset = vectorAnimationAssets.get(id);
  if (!asset) return res.status(404).send("Vector animation asset not found or expired");
  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Cache-Control", "public, max-age=1800");
  res.send(asset.buffer);
}));

// ────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────

export function getCreativeHealth() {
  const emojiHealth = getEmojiKitchenHealth();
  return {
    generateImage: "on-demand (Google Gemini via Prism)",
    describeImage: "on-demand (Google Gemini via Prism)",
    textToSpeech: "on-demand (ElevenLabs/OpenAI via Prism)",
    speechToText: "on-demand (OpenAI Whisper via Prism)",
    vectorAnimation: "on-demand (Creative Vector Animation Engine)",
    emojiKitchen: {
      lastFetch: emojiHealth.lastFetch,
      hasData: emojiHealth.hasData,
      count: emojiHealth.count,
      error: emojiHealth.error,
    },
  };
}

export default router;
