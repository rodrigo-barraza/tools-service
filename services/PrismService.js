// ============================================================
// Prism Service — HTTP Client for Prism LLM Gateway
// ============================================================
// Enables tools-api → Prism communication so any tools-api
// service that needs LLM capabilities (text generation, image
// generation, vision) can call Prism's /chat endpoint.
//
// Prism runs on CONFIG.PRISM_URL (default: localhost:7777).
// ============================================================

import CONFIG from "../config.js";
import logger from "../logger.js";

const PRISM_URL = CONFIG.PRISM_URL;

/**
 * Call Prism's /chat endpoint for text/image generation.
 *
 * @param {object} params - Request payload matching Prism's /chat contract
 * @param {string} params.provider - Provider name (e.g. "google", "openai")
 * @param {string} params.model - Model name
 * @param {Array}  params.messages - Messages array
 * @param {object} [params.options] - Generation options (temperature, etc.)
 * @returns {Promise<object>} Parsed JSON response from Prism
 */
export async function chat(params) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const res = await fetch(`${PRISM_URL}/chat?stream=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...params,
        project: params.project || "tools-api",
        username: params.username || "system",
        skipConversation: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Prism returned ${res.status}: ${errText.slice(0, 200)}`);
    }

    return await res.json();
  } catch (err) {
    logger.error(`[PrismService] chat failed: ${err.message}`);
    throw err;
  }
}

/**
 * Check Prism health/connectivity.
 * @returns {Promise<boolean>} true if Prism is reachable
 */
export async function health() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${PRISM_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Call Prism's /text-to-audio endpoint to generate speech.
 * Collects the streamed binary response into a base64-encoded buffer.
 *
 * @param {object} params
 * @param {string} params.text - Text to synthesize
 * @param {string} [params.provider="elevenlabs"] - TTS provider
 * @param {string} [params.voice] - Voice identifier
 * @param {string} [params.model] - Model name
 * @param {string} [params.project] - Project identifier
 * @param {string} [params.username] - Username identifier
 * @returns {Promise<{ audioBase64: string, contentType: string }>}
 */
export async function textToSpeech(params) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const res = await fetch(`${PRISM_URL}/text-to-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: params.provider || "elevenlabs",
        text: params.text,
        voice: params.voice || undefined,
        model: params.model || undefined,
        skipConversation: true,
        project: params.project || "tools-api",
        username: params.username || "system",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Prism TTS returned ${res.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = res.headers.get("content-type") || "audio/mpeg";
    const arrayBuffer = await res.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

    return { audioBase64, contentType };
  } catch (err) {
    logger.error(`[PrismService] textToSpeech failed: ${err.message}`);
    throw err;
  }
}

/**
 * Call Prism's /audio-to-text endpoint to transcribe audio.
 *
 * @param {object} params
 * @param {string} params.audio - Base64-encoded audio or data URL
 * @param {string} [params.provider="openai"] - STT provider
 * @param {string} [params.model] - Model name
 * @param {string} [params.language] - Language hint (ISO 639-1)
 * @param {string} [params.project] - Project identifier
 * @param {string} [params.username] - Username identifier
 * @returns {Promise<{ text: string, usage?: object }>}
 */
export async function speechToText(params) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const res = await fetch(`${PRISM_URL}/audio-to-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: params.provider || "openai",
        audio: params.audio,
        model: params.model || undefined,
        language: params.language || undefined,
        skipConversation: true,
        project: params.project || "tools-api",
        username: params.username || "system",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Prism STT returned ${res.status}: ${errText.slice(0, 200)}`);
    }

    return await res.json();
  } catch (err) {
    logger.error(`[PrismService] speechToText failed: ${err.message}`);
    throw err;
  }
}

export default { chat, health, textToSpeech, speechToText };

