// ============================================================
// Prism Service — HTTP Client for Prism LLM Gateway
// ============================================================
// Enables tools-api → Prism communication so any tools-api
// service that needs LLM capabilities (text generation, image
// generation, vision) can call Prism's /chat endpoint.
//
// Prism runs on CONFIG.PRISM_API_URL (default: localhost:7777).
// ============================================================

import CONFIG from "../config.js";
import logger from "../logger.js";

const PRISM_URL = CONFIG.PRISM_API_URL;

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

export default { chat, health };
