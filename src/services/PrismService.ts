// ─── HTTP Client for Prism LLM Gateway ──────────────────────
//
// Thin wrapper around the shared PrismApiClient: tools-service defaults
// (project/username, per-endpoint timeouts) plus trace-header propagation.

import { PrismApiClient } from "@rodrigo-barraza/utilities-library/service";
import { getErrorMessage } from "@rodrigo-barraza/utilities-library";
import CONFIG from "../config.ts";
import logger from "../logger.ts";
import {
  PRISM_CHAT_TIMEOUT_MS,
  PRISM_HEALTH_TIMEOUT_MS,
  PRISM_TTS_TIMEOUT_MS,
  PRISM_STT_TIMEOUT_MS,
} from "../constants.ts";
import { getTraceHeaders } from "@rodrigo-barraza/utilities-library/service";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface PrismChatParams {
  project?: string;
  username?: string;
  model?: string;
  messages?: Array<{
    role: string;
    content: string;
    name?: string;
    images?: string[];
  }>;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface PrismTTSParams {
  provider?: string;
  text: string;
  voice?: string;
  model?: string;
  project?: string;
  username?: string;
}

export interface PrismSoundEffectParams {
  prompt: string;
  durationSeconds?: number;
  loop?: boolean;
  username?: string;
}

export interface PrismSTTParams {
  provider?: string;
  audio: string;
  model?: string;
  language?: string;
  project?: string;
  username?: string;
}

export interface TransformedPrismSpeechResult {
  audioBase64: string;
  contentType: string;
}

export interface TransformedPrismChatResult {
  text?: string;
  message?: { role: string; content: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface TransformedPrismSTTResult {
  text: string;
  [key: string]: unknown;
}

// Lazy so a missing PRISM_SERVICE_URL fails at call time, not module load.
let client: PrismApiClient | null = null;
function prism(): PrismApiClient {
  if (!client) {
    // Cast: constructor throws a clear error at first call if unset.
    client = new PrismApiClient({
      baseUrl: CONFIG.PRISM_SERVICE_URL as string,
      project: "tools-api",
      defaultUsername: "system",
      // Request-scoped trace/identity headers win over the static defaults,
      // so calls made while serving a request keep the caller's identity.
      getExtraHeaders: getTraceHeaders,
      defaultTimeoutMs: PRISM_CHAT_TIMEOUT_MS,
      logger,
    });
  }
  return client;
}

/**
 * Call Prism's /chat endpoint for text/image generation.
 */
export async function chat(
  params: PrismChatParams,
): Promise<TransformedPrismChatResult> {
  try {
    const { username, ...body } = params;
    return (await prism().chat({
      ...body,
      messages: body.messages ?? [],
      // Body project beats headers on the Prism side — keeps cost accounting
      // attributed exactly as before the shared-client migration.
      project: body.project || "tools-api",
      username: username || "system",
      timeoutMs: PRISM_CHAT_TIMEOUT_MS,
    })) as TransformedPrismChatResult;
  } catch (error: unknown) {
    logger.error(
      `[PrismService] chat failed: ${getErrorMessage(error)}`,
    );
    throw error;
  }
}

/**
 * Check Prism health/connectivity.
 */
export async function health(): Promise<boolean> {
  return prism().health(PRISM_HEALTH_TIMEOUT_MS);
}

/**
 * Call Prism's /text-to-audio endpoint to generate speech.
 * Collects the streamed binary response into a base64-encoded buffer.
 */
export async function textToSpeech(
  params: PrismTTSParams,
): Promise<TransformedPrismSpeechResult> {
  try {
    return await prism().textToSpeech({
      provider: params.provider || "elevenlabs",
      text: params.text,
      voice: params.voice || undefined,
      model: params.model || undefined,
      project: params.project || "tools-api",
      username: params.username || "system",
      timeoutMs: PRISM_TTS_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    logger.error(
      `[PrismService] textToSpeech failed: ${getErrorMessage(error)}`,
    );
    throw error;
  }
}

/**
 * Call Prism's /audio-to-text endpoint to transcribe audio.
 */
export async function speechToText(
  params: PrismSTTParams,
): Promise<TransformedPrismSTTResult> {
  try {
    return (await prism().transcribeAudio({
      provider: params.provider || "openai",
      audio: params.audio,
      model: params.model || undefined,
      language: params.language || undefined,
      project: params.project || "tools-api",
      username: params.username || "system",
      timeoutMs: PRISM_STT_TIMEOUT_MS,
    })) as TransformedPrismSTTResult;
  } catch (error: unknown) {
    logger.error(
      `[PrismService] speechToText failed: ${getErrorMessage(error)}`,
    );
    throw error;
  }
}

/**
 * Call Prism's /text-to-sound-effect endpoint (ElevenLabs sound effects).
 * Collects the binary response into a base64-encoded buffer, as
 * textToSpeech does — the shared client has no wrapper for this route.
 */
export async function soundEffect(
  params: PrismSoundEffectParams,
): Promise<TransformedPrismSpeechResult> {
  try {
    const response = await prism().requestRaw("/text-to-sound-effect", {
      body: {
        prompt: params.prompt,
        durationSeconds: params.durationSeconds,
        loop: params.loop,
      },
      username: params.username || "system",
      timeoutMs: PRISM_TTS_TIMEOUT_MS,
    });
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    return {
      audioBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
      contentType,
    };
  } catch (error: unknown) {
    logger.error(
      `[PrismService] soundEffect failed: ${getErrorMessage(error)}`,
    );
    throw error;
  }
}

/**
 * Fetch global user settings from Prism's /settings endpoint.
 */
export async function getSettings(): Promise<Record<string, unknown> | null> {
  return prism().getSettings(PRISM_HEALTH_TIMEOUT_MS);
}

export default {
  chat,
  health,
  textToSpeech,
  speechToText,
  soundEffect,
  getSettings,
};
