import { execFile } from "node:child_process";
import { getErrorMessage } from "@rodrigo-barraza/utilities-library";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import logger from "../logger.ts";

const execFileAsync = promisify(execFile);

const ESPEAK_BINARY = "espeak-ng";
const MAX_TEXT_LENGTH = 10_000;
const DEFAULT_VOICE = "en-us";
const DEFAULT_SPEED = 175;
const DEFAULT_PITCH = 50;
const DEFAULT_VOLUME = 100;

export interface LocalTextToSpeechOptions {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  wordGap?: number;
}

export interface LocalTextToSpeechResult {
  audioBase64: string;
  mimeType: string;
  voice: string;
  textLength: number;
  durationEstimateSeconds: number;
}

const SUPPORTED_VOICES: Record<string, string> = {
  "en-us": "English (American)",
  "en-gb": "English (British)",
  "en-gb-scotland": "English (Scottish)",
  "en-gb-x-rp": "English (Received Pronunciation)",
  "en-029": "English (Caribbean)",
  "es": "Spanish (Spain)",
  "es-419": "Spanish (Latin America)",
  "fr": "French",
  "de": "German",
  "it": "Italian",
  "pt": "Portuguese",
  "pt-br": "Portuguese (Brazil)",
  "ja": "Japanese",
  "ko": "Korean",
  "zh": "Chinese (Mandarin)",
  "ru": "Russian",
  "ar": "Arabic",
  "hi": "Hindi",
  "nl": "Dutch",
  "sv": "Swedish",
  "da": "Danish",
  "fi": "Finnish",
  "no": "Norwegian",
  "pl": "Polish",
  "tr": "Turkish",
  "el": "Greek",
  "cs": "Czech",
  "ro": "Romanian",
  "uk": "Ukrainian",
};

export function getSupportedVoices(): Record<string, string> {
  return { ...SUPPORTED_VOICES };
}

export async function synthesizeSpeech(
  options: LocalTextToSpeechOptions,
): Promise<LocalTextToSpeechResult> {
  const {
    text,
    voice = DEFAULT_VOICE,
    speed = DEFAULT_SPEED,
    pitch = DEFAULT_PITCH,
    volume = DEFAULT_VOLUME,
    wordGap,
  } = options;

  if (!text || text.trim().length === 0) {
    throw new Error("Text parameter is required and must not be empty.");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters (received ${text.length}).`,
    );
  }

  const clampedSpeed = Math.min(Math.max(speed, 80), 450);
  const clampedPitch = Math.min(Math.max(pitch, 0), 99);
  const clampedVolume = Math.min(Math.max(volume, 0), 200);

  const outputFilePath = join(tmpdir(), `tts-${randomUUID()}.wav`);

  const espeakArguments: string[] = [
    "--stdout",
    "-v", voice,
    "-s", String(clampedSpeed),
    "-p", String(clampedPitch),
    "-a", String(clampedVolume),
  ];

  if (wordGap !== undefined) {
    const clampedWordGap = Math.min(Math.max(wordGap, 0), 100);
    espeakArguments.push("-g", String(clampedWordGap));
  }

  espeakArguments.push("-w", outputFilePath);
  espeakArguments.push("--", text);

  try {
    await execFileAsync(ESPEAK_BINARY, espeakArguments, {
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
    });

    const wavBuffer = await readFile(outputFilePath);
    const audioBase64 = wavBuffer.toString("base64");

    const estimatedDurationSeconds =
      (text.split(/\s+/).length / (clampedSpeed / 60)) * 1.1;

    logger.info(
      `[TextToSpeechService] synthesized ${text.length} chars with voice="${voice}", ` +
        `speed=${clampedSpeed}, pitch=${clampedPitch}, ~${estimatedDurationSeconds.toFixed(1)}s`,
    );

    return {
      audioBase64,
      mimeType: "audio/wav",
      voice,
      textLength: text.length,
      durationEstimateSeconds: parseFloat(
        estimatedDurationSeconds.toFixed(2),
      ),
    };
  } catch (error: unknown) {
    const errorText = getErrorMessage(error);
    logger.error(
      `[TextToSpeechService] espeak-ng failed: ${errorText}`,
    );
    throw new Error(`Local TTS synthesis failed: ${errorText}`, { cause: error });
  } finally {
    try {
      await unlink(outputFilePath);
    } catch {
      // Temp file cleanup is best-effort
    }
  }
}

export async function isEspeakAvailable(): Promise<boolean> {
  try {
    await execFileAsync(ESPEAK_BINARY, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
