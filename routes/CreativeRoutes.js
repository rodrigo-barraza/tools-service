// ============================================================
// Creative Routes — Image Generation & Vision
// ============================================================
// Centralized creative tool endpoints. These proxy LLM calls
// through Prism's /chat endpoint via PrismService for actual
// model execution (Google Gemini for both generation and vision).
//
// Any consumer (Prism, Lupos, Prism Client, future agents) can call
// these endpoints. Telemetry is automatically captured by the
// ToolCallLoggerMiddleware — no manual reporting needed.
// ============================================================

import { Router } from "express";
import PrismService from "../services/PrismService.js";
import logger from "../logger.js";
import { extractCallerContext } from "../utilities.js";
import CONFIG from "../config.js";

const router = Router();

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const IMAGE_MODEL = CONFIG.TOOLS_IMAGE_MODEL;
const IMAGE_PROVIDER = "google";
const VISION_MODEL = CONFIG.TOOLS_VISION_MODEL;
const VISION_PROVIDER = "google";

const MAX_SAFETY_RETRIES = 3;

// ────────────────────────────────────────────────────────────
// Prompt Softening — graceful degradation for content safety
// ────────────────────────────────────────────────────────────
// Progressive substitutions applied cumulatively on each retry.
// Tier 2 includes tier 1 changes, tier 3 includes both, etc.
// The visual intent is preserved while problematic descriptors
// are replaced with policy-compliant creative alternatives.
// ────────────────────────────────────────────────────────────

const SAFETY_SOFTENING_TIERS = [
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
    [/\bexposed\s+(skin|body|flesh)\b/gi, "visible silhouette through sheer fabric"],
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
 * @param {string} prompt - The original prompt
 * @param {number} tier - 0-indexed tier to apply up to (inclusive)
 * @returns {string} Softened prompt
 */
function softenPrompt(prompt, tier) {
  let softened = prompt;
  for (let t = 0; t <= tier && t < SAFETY_SOFTENING_TIERS.length; t++) {
    for (const [pattern, replacement] of SAFETY_SOFTENING_TIERS[t]) {
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

router.post("/generate-image", async (req, res) => {
  const { prompt, referenceImages } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Missing required parameter: prompt" });
  }

  // Extract caller context from headers for Prism attribution
  const { project: callerProject, username: callerUsername, agent: callerAgent, traceId: callerTraceId, agentSessionId: callerAgentSessionId } = extractCallerContext(req);

  try {
    let currentPrompt = prompt;
    let result = null;
    let safetyRetries = 0;

    for (let attempt = 0; attempt <= MAX_SAFETY_RETRIES; attempt++) {
      const messages = [
        {
          role: "user",
          content: currentPrompt,
          ...(referenceImages?.length > 0 && { images: referenceImages }),
        },
      ];

      // When reference images are present, instruct the image model to
      // preserve and edit them rather than re-imagining from scratch.
      const systemPrompt = referenceImages?.length > 0
        ? "You are an image editor. The user has attached reference image(s). " +
          "Use the attached image(s) as the direct basis for your output. " +
          "Preserve the appearance, features, and identity of subjects in the reference image(s) as closely as possible. " +
          "Apply ONLY the specific changes described in the prompt. Do not re-imagine or reinvent the image from scratch."
        : undefined;

      try {
        result = await PrismService.chat({
          provider: IMAGE_PROVIDER,
          model: IMAGE_MODEL,
          messages,
          forceImageGeneration: true,
          project: callerProject,
          username: callerUsername,
          agent: callerAgent,
          traceId: callerTraceId,
          agentSessionId: callerAgentSessionId,
          skipConversation: true,
          ...(systemPrompt && { systemPrompt }),
        });
      } catch (err) {
        logger.error(`[CreativeRoutes] Prism chat failed: ${err.message}`);
        return res.status(502).json({
          error: `Image generation failed: ${err.message}`,
        });
      }

      // Success — we got an image
      if (!result.safetyBlock && result.images?.length > 0) {
        break;
      }

      // Safety block — can we retry with a softer prompt?
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

    // All attempts exhausted — still blocked
    if (result.safetyBlock) {
      return res.status(422).json({
        success: false,
        error:
          "Image generation was blocked by content safety filters after " +
          `${safetyRetries + 1} attempts (including softened prompts). ` +
          "The content may be too explicit to generate even with creative alternatives.",
      });
    }

    // No image in response (model returned text instead)
    if (!result.images || result.images.length === 0) {
      return res.status(422).json({
        success: false,
        error:
          "No image was generated. The model may have returned text instead. " +
          "Try a more specific and descriptive prompt.",
      });
    }

    const image = result.images[0];

    // Build the result message — note if prompt was softened
    const resultMessage = safetyRetries > 0
      ? "Image generated and delivered to the user. Note: the original prompt was " +
        "automatically softened to comply with content safety filters (e.g., nudity " +
        "replaced with robes/clothing, violence with calmer alternatives). The image " +
        "captures the spirit of the request with a more tasteful interpretation."
      : "Image generated and delivered to the user.";

    res.json({
      success: true,
      message: resultMessage,
      description: result.text || null,
      image: {
        data: image.data,
        mimeType: image.mimeType || "image/png",
      },
      ...(safetyRetries > 0 && {
        safetyRetries,
        softenedPrompt: currentPrompt.slice(0, 200),
      }),
    });
  } catch (err) {
    logger.error(`[CreativeRoutes] generate-image failed: ${err.message}`);
    res.status(500).json({ error: `Image generation failed: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
// POST /creative/describe-image
// ────────────────────────────────────────────────────────────

router.post("/describe-image", async (req, res) => {
  const { imageUrls, context = "general" } = req.body;

  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({
      error: "Missing required parameter: imageUrls (array of URLs)",
    });
  }

  // Extract caller context from headers for Prism attribution
  const { project: callerProject, username: callerUsername, agent: callerAgent, traceId: callerTraceId, agentSessionId: callerAgentSessionId } = extractCallerContext(req);

  // Tailor the prompt based on image context
  const prompts = {
    avatar:
      "Describe this profile picture/avatar. Focus on the person's appearance, " +
      "style, notable features, and any artistic elements. Make no mention about quality or resolution.",
    banner:
      "Describe this profile banner image. Focus on the scene, colors, mood, " +
      "and notable elements. Make no mention about quality or resolution.",
    photo: "Describe this image. Make no mention about the quality, resolution, or pixelation.",
    general: "Describe this image. Make no mention about the quality, resolution, or pixelation.",
  };
  const visionPrompt = prompts[context] || prompts.general;

  try {
    const descriptions = [];

    // Per-request dedup cache keyed by X-Request-Id header
    const requestId = req.headers["x-request-id"] || "default";
    if (!visionCache.has(requestId)) {
      visionCache.set(requestId, new Map());
      setTimeout(() => visionCache.delete(requestId), VISION_CACHE_TTL_MS);
    }
    const urlCache = visionCache.get(requestId);

    // Deduplicate URLs within this call
    const uniqueUrls = [...new Set(imageUrls)];

    for (const url of uniqueUrls) {
      // Singleflight: if a request for this URL is already in-flight,
      // await it instead of firing a duplicate.
      if (urlCache.has(url)) {
        const cached = await urlCache.get(url);
        descriptions.push({ url, description: cached });
        logger.info(`[CreativeRoutes] describe-image: cache hit for ${url.slice(0, 60)}…`);
        continue;
      }

      // Store the promise IMMEDIATELY so parallel calls can await it
      const descriptionPromise = (async () => {
        try {
          const result = await PrismService.chat({
            provider: VISION_PROVIDER,
            model: VISION_MODEL,
            messages: [{ role: "user", content: visionPrompt, images: [url] }],
            project: callerProject,
            username: callerUsername,
            agent: callerAgent,
            traceId: callerTraceId,
            agentSessionId: callerAgentSessionId,
            skipConversation: true,
          });

          return result.text || "Unable to describe this image.";
        } catch (err) {
          logger.error(`[CreativeRoutes] describe-image vision call failed: ${err.message}`);
          return `Failed to describe image: ${err.message}`;
        }
      })();

      urlCache.set(url, descriptionPromise);

      const text = await descriptionPromise;
      descriptions.push({ url, description: text });
    }

    logger.info(
      `[CreativeRoutes] describe-image: described ${descriptions.length} image(s), context=${context}`,
    );

    res.json({
      success: true,
      descriptions,
    });
  } catch (err) {
    logger.error(`[CreativeRoutes] describe-image failed: ${err.message}`);
    res.status(500).json({ error: `Image description failed: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
// POST /creative/text-to-speech
// ────────────────────────────────────────────────────────────

router.post("/text-to-speech", async (req, res) => {
  const { text, voice, provider, model } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing required parameter: text" });
  }

  const { project: callerProject, username: callerUsername } = extractCallerContext(req);

  try {
    const result = await PrismService.textToSpeech({
      text,
      voice,
      provider: provider || "elevenlabs",
      model,
      project: callerProject,
      username: callerUsername,
    });

    res.json({
      success: true,
      message: "Audio generated and delivered to the user.",
      audio: {
        data: result.audioBase64,
        mimeType: result.contentType,
      },
      textLength: text.length,
    });
  } catch (err) {
    logger.error(`[CreativeRoutes] text-to-speech failed: ${err.message}`);
    res.status(500).json({ error: `Text-to-speech failed: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
// POST /creative/speech-to-text
// ────────────────────────────────────────────────────────────

router.post("/speech-to-text", async (req, res) => {
  const { audioUrl, audio, provider, model, language } = req.body;

  // Accept either a URL (we fetch it) or raw base64 audio
  let audioData = audio;
  if (!audioData && audioUrl) {
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) {
        return res.status(400).json({ error: `Failed to fetch audio from URL: ${response.status}` });
      }
      const buffer = await response.arrayBuffer();
      const mimeType = response.headers.get("content-type") || "audio/mpeg";
      audioData = `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
    } catch (err) {
      return res.status(400).json({ error: `Failed to fetch audio URL: ${err.message}` });
    }
  }

  if (!audioData) {
    return res.status(400).json({
      error: "Missing required parameter: 'audio' (base64) or 'audioUrl' (URL to audio file)",
    });
  }

  const { project: callerProject, username: callerUsername } = extractCallerContext(req);

  try {
    const result = await PrismService.speechToText({
      audio: audioData,
      provider: provider || "openai",
      model,
      language,
      project: callerProject,
      username: callerUsername,
    });

    res.json({
      success: true,
      text: result.text,
      usage: result.usage || {},
    });
  } catch (err) {
    logger.error(`[CreativeRoutes] speech-to-text failed: ${err.message}`);
    res.status(500).json({ error: `Speech-to-text failed: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────

export function getCreativeHealth() {
  return {
    generateImage: "on-demand (Google Gemini via Prism)",
    describeImage: "on-demand (Google Gemini via Prism)",
    textToSpeech: "on-demand (ElevenLabs/OpenAI via Prism)",
    speechToText: "on-demand (OpenAI Whisper via Prism)",
  };
}

export default router;
