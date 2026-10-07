import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile, unlink } from "node:fs/promises";
import crypto from "node:crypto";
import { validatePath } from "./AgenticFileService.ts";
import { fetchPublicOrOwnUrl } from "../fetchers/web/SsrfGuard.ts";
import CONFIG from "../config.ts";

const executeFileAsynchronously = promisify(execFile);

export interface ConvertVideoToGifInput {
  input: string;
  quality?: "high" | "low";
  width?: number;
  fps?: number;
}

export interface ConvertVideoToGifResult {
  buffer: Buffer;
  mimeType: string;
}

const MAXIMUM_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB limit
const FFMPEG_TIMEOUT_MILLISECONDS = 45_000;

export async function convertVideoToGif({
  input,
  quality = "high",
  width = 480,
  fps = 15,
}: ConvertVideoToGifInput): Promise<ConvertVideoToGifResult> {
  if (!input || typeof input !== "string") {
    throw new Error("'input' is required (URL or local workspace path)");
  }

  const VALID_QUALITY_VALUES = new Set(["high", "low"]);
  if (quality && !VALID_QUALITY_VALUES.has(quality)) {
    throw new Error(
      `Invalid quality '${quality}'. Valid: ${[...VALID_QUALITY_VALUES].join(", ")}`,
    );
  }

  if (fps !== undefined && (typeof fps !== "number" || fps < 1 || fps > 30)) {
    throw new Error(
      `Invalid fps ${fps}. Must be a number between 1 and 30`,
    );
  }

  if (width !== undefined && (typeof width !== "number" || width < 64 || width > 1280)) {
    throw new Error(
      `Invalid width ${width}. Must be a number between 64 and 1280`,
    );
  }

  // Enforce parameter boundaries
  const boundedFps = fps;
  const boundedWidth = width;

  const ffmpegBinaryPath = CONFIG.FFMPEG_PATH || "ffmpeg";

  let resolvedInputPath = "";
  let isInputTemporaryFile = false;

  const paletteTemporaryPath = join(
    tmpdir(),
    `palette-${crypto.randomUUID()}.png`,
  );
  const outputGifTemporaryPath = join(
    tmpdir(),
    `vid-out-${crypto.randomUUID()}.gif`,
  );

  try {
    // ── Resolve Input Source ─────────────────────────────────
    if (input.startsWith("http://") || input.startsWith("https://")) {
      const uniqueInputId = crypto.randomUUID();
      resolvedInputPath = join(tmpdir(), `vid-in-${uniqueInputId}`);
      isInputTemporaryFile = true;

      // A model's URL: public, or one of our own services (SsrfGuard)
      const networkResponse = await fetchPublicOrOwnUrl(input, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!networkResponse.ok) {
        throw new Error(
          `Failed to fetch video from URL: HTTP ${networkResponse.status}`,
        );
      }

      const contentLengthHeader = networkResponse.headers.get("content-length");
      const contentLengthBytes = parseInt(contentLengthHeader || "0", 10);
      if (contentLengthBytes > MAXIMUM_INPUT_BYTES) {
        throw new Error(
          `Remote video exceeds ${MAXIMUM_INPUT_BYTES / 1024 / 1024} MB limit`,
        );
      }

      const networkArrayBuffer = await networkResponse.arrayBuffer();
      const networkBuffer = Buffer.from(networkArrayBuffer);

      if (networkBuffer.length > MAXIMUM_INPUT_BYTES) {
        throw new Error(
          `Downloaded video exceeds ${MAXIMUM_INPUT_BYTES / 1024 / 1024} MB limit`,
        );
      }

      await writeFile(resolvedInputPath, networkBuffer);
    } else {
      // Local workspace file path
      let diskPath = input;
      if (input.startsWith("file://")) {
        diskPath = decodeURIComponent(input.replace(/^file:\/\/\/?/, "/"));
      }

      const pathValidation = validatePath(diskPath);
      if (pathValidation.safe && pathValidation.resolved) {
        resolvedInputPath = pathValidation.resolved;
      } else {
        throw new Error(
          `Local path validation failed: ${pathValidation.error}`,
        );
      }
    }

    // ── Pass 1: Generate Palette ─────────────────────────────
    // For high-quality, we use a full 256-color palette.
    // For low-quality, we can restrict colors to 128 to save file size.
    const maximumColors = quality === "low" ? 128 : 256;
    const paletteArguments = [
      "-y",
      "-i",
      resolvedInputPath,
      "-vf",
      `fps=${boundedFps},scale=${boundedWidth}:-1:flags=lanczos,palettegen=max_colors=${maximumColors}`,
      paletteTemporaryPath,
    ];

    await executeFileAsynchronously(ffmpegBinaryPath, paletteArguments, {
      timeout: FFMPEG_TIMEOUT_MILLISECONDS,
    });

    // ── Pass 2: Generate GIF ─────────────────────────────────
    // Dithering option sierra2_4a provides high spatial and color fidelity.
    // Dithering = none produces flat blocks and yields a much smaller file size.
    const ditheringStrategy = quality === "low" ? "none" : "sierra2_4a";
    const gifArguments = [
      "-y",
      "-i",
      resolvedInputPath,
      "-i",
      paletteTemporaryPath,
      "-filter_complex",
      `fps=${boundedFps},scale=${boundedWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=${ditheringStrategy}`,
      outputGifTemporaryPath,
    ];

    await executeFileAsynchronously(ffmpegBinaryPath, gifArguments, {
      timeout: FFMPEG_TIMEOUT_MILLISECONDS,
    });

    const outputBuffer = await readFile(outputGifTemporaryPath);
    return {
      buffer: outputBuffer,
      mimeType: "image/gif",
    };
  } finally {
    // ── Clean up Temporary Files ─────────────────────────────
    if (isInputTemporaryFile && resolvedInputPath) {
      await unlink(resolvedInputPath).catch(() => {});
    }
    await unlink(paletteTemporaryPath).catch(() => {});
    await unlink(outputGifTemporaryPath).catch(() => {});
  }
}

/**
 * Check if ffmpeg is available on the system.
 */
export async function checkFfmpegAvailability(): Promise<{
  available: boolean;
  version?: string;
}> {
  const ffmpegBinaryPath = CONFIG.FFMPEG_PATH || "ffmpeg";
  try {
    const { stdout } = await executeFileAsynchronously(
      ffmpegBinaryPath,
      ["-version"],
      { timeout: 5_000 },
    );
    const versionMatch = stdout.match(/ffmpeg\s+version\s+([\d.\w-]+)/i);
    return {
      available: true,
      version: versionMatch?.[1] || "unknown",
    };
  } catch {
    return { available: false };
  }
}

// ─── Video Trimming ────────────────────────────────────────────────

const MAXIMUM_TRIM_INPUT_BYTES = 200 * 1024 * 1024;
const MAXIMUM_TRIM_OUTPUT_SECONDS = 300;
const TRIM_TIMEOUT_MILLISECONDS = 60_000;

export interface TrimVideoInput {
  input: string;
  startTimestamp?: string;
  endTimestamp?: string;
}

export interface TrimVideoResult {
  buffer: Buffer;
  mimeType: string;
  format: string;
  durationSeconds: number | null;
}

function parseTimestampToSeconds(timestamp: string): number {
  const trimmed = timestamp.trim();

  // Pure numeric seconds (e.g. "90", "120.5")
  const numericValue = parseFloat(trimmed);
  if (!isNaN(numericValue) && /^[\d.]+$/.test(trimmed)) {
    return numericValue;
  }

  // HH:MM:SS or MM:SS (e.g. "1:30", "00:01:30", "2:00")
  const timeSegments = trimmed.split(":").map(Number);
  if (timeSegments.some(isNaN)) {
    throw new Error(`Invalid timestamp format: "${timestamp}". Use HH:MM:SS, MM:SS, or seconds.`);
  }

  if (timeSegments.length === 3) {
    return timeSegments[0] * 3600 + timeSegments[1] * 60 + timeSegments[2];
  }
  if (timeSegments.length === 2) {
    return timeSegments[0] * 60 + timeSegments[1];
  }

  throw new Error(`Invalid timestamp format: "${timestamp}". Use HH:MM:SS, MM:SS, or seconds.`);
}

function formatSecondsToTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondsFixed = seconds.toFixed(3);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secondsFixed.padStart(6, "0")}`;
}

export async function trimVideo({
  input,
  startTimestamp,
  endTimestamp,
}: TrimVideoInput): Promise<TrimVideoResult> {
  if (!input || typeof input !== "string") {
    throw new Error("'input' is required (URL or local file path)");
  }

  if (!startTimestamp && !endTimestamp) {
    throw new Error("At least one of 'start' or 'end' must be provided for trimming.");
  }

  const startSeconds = startTimestamp ? parseTimestampToSeconds(startTimestamp) : 0;
  const endSeconds = endTimestamp ? parseTimestampToSeconds(endTimestamp) : null;

  if (endSeconds !== null && endSeconds <= startSeconds) {
    throw new Error(`End timestamp (${endTimestamp}) must be after start timestamp (${startTimestamp}).`);
  }

  if (endSeconds !== null && (endSeconds - startSeconds) > MAXIMUM_TRIM_OUTPUT_SECONDS) {
    throw new Error(
      `Trim duration (${(endSeconds - startSeconds).toFixed(0)}s) exceeds maximum of ${MAXIMUM_TRIM_OUTPUT_SECONDS}s (5 minutes).`,
    );
  }

  const ffmpegBinaryPath = CONFIG.FFMPEG_PATH || "ffmpeg";

  let resolvedInputPath = "";
  let isInputTemporaryFile = false;

  const outputTemporaryPath = join(
    tmpdir(),
    `trim-out-${crypto.randomUUID()}.mp4`,
  );

  try {
    // ── Resolve Input Source ─────────────────────────────────
    if (input.startsWith("http://") || input.startsWith("https://")) {
      const uniqueInputId = crypto.randomUUID();
      resolvedInputPath = join(tmpdir(), `trim-in-${uniqueInputId}.mp4`);
      isInputTemporaryFile = true;

      // A model's URL: public, or one of our own services (SsrfGuard)
      const networkResponse = await fetchPublicOrOwnUrl(input, {
        signal: AbortSignal.timeout(60_000),
      });

      if (!networkResponse.ok) {
        throw new Error(
          `Failed to fetch video from URL: HTTP ${networkResponse.status}`,
        );
      }

      const contentLengthHeader = networkResponse.headers.get("content-length");
      const contentLengthBytes = parseInt(contentLengthHeader || "0", 10);
      if (contentLengthBytes > MAXIMUM_TRIM_INPUT_BYTES) {
        throw new Error(
          `Remote video exceeds ${MAXIMUM_TRIM_INPUT_BYTES / 1024 / 1024} MB limit`,
        );
      }

      const networkArrayBuffer = await networkResponse.arrayBuffer();
      const networkBuffer = Buffer.from(networkArrayBuffer);

      if (networkBuffer.length > MAXIMUM_TRIM_INPUT_BYTES) {
        throw new Error(
          `Downloaded video exceeds ${MAXIMUM_TRIM_INPUT_BYTES / 1024 / 1024} MB limit`,
        );
      }

      await writeFile(resolvedInputPath, networkBuffer);
    } else {
      let diskPath = input;
      if (input.startsWith("file://")) {
        diskPath = decodeURIComponent(input.replace(/^file:\/\/\/?/, "/"));
      }

      const pathValidation = validatePath(diskPath);
      if (pathValidation.safe && pathValidation.resolved) {
        resolvedInputPath = pathValidation.resolved;
      } else {
        throw new Error(
          `Local path validation failed: ${pathValidation.error}`,
        );
      }
    }

    // ── Build ffmpeg arguments ───────────────────────────────
    // Using -ss before -i for fast seeking (input seeking),
    // and -c copy for stream copy (no re-encoding = instant)
    const trimArguments: string[] = ["-y"];

    // Input seeking — fast, keyframe-accurate
    trimArguments.push("-ss", formatSecondsToTimestamp(startSeconds));

    trimArguments.push("-i", resolvedInputPath);

    // Duration or end time
    if (endSeconds !== null) {
      const durationSeconds = endSeconds - startSeconds;
      trimArguments.push("-t", String(durationSeconds));
    } else if (!endTimestamp) {
      // No end = trim to end of file, but cap at max
      trimArguments.push("-t", String(MAXIMUM_TRIM_OUTPUT_SECONDS));
    }

    // Stream copy — no re-encoding
    trimArguments.push("-c", "copy");

    // Avoid negative timestamps from keyframe seeking
    trimArguments.push("-avoid_negative_ts", "make_zero");

    trimArguments.push(outputTemporaryPath);

    await executeFileAsynchronously(ffmpegBinaryPath, trimArguments, {
      timeout: TRIM_TIMEOUT_MILLISECONDS,
    });

    const outputBuffer = await readFile(outputTemporaryPath);

    const computedDuration =
      endSeconds !== null
        ? endSeconds - startSeconds
        : null;

    return {
      buffer: outputBuffer,
      mimeType: "video/mp4",
      format: "mp4",
      durationSeconds: computedDuration,
    };
  } finally {
    if (isInputTemporaryFile && resolvedInputPath) {
      await unlink(resolvedInputPath).catch(() => {});
    }
    await unlink(outputTemporaryPath).catch(() => {});
  }
}
