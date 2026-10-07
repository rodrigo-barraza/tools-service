import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoUnresolvedAttachedSentinel } from "./AttachedMediaSentinel.ts";
import { validatePath } from "./AgenticFileService.ts";
import { fetchPublicOrOwnUrl } from "../fetchers/web/SsrfGuard.ts";

const execFileAsync = promisify(execFile);

export const MAX_AUDIO_INPUT_BYTES = 25 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;

/** An audio source that cannot be used — refused, unreadable or malformed: the caller's to fix (400). */
export class AudioSourceError extends Error {}

const tooLarge = (what: string) =>
  new AudioSourceError(
    `${what} exceeds maximum size of ${MAX_AUDIO_INPUT_BYTES / (1024 * 1024)}MB`,
  );

/**
 * Resolves an audio source string (URL, base64 data URI, or absolute file
 * path) into a raw encoded-audio Buffer. Shared by every audio-consuming
 * tool (remix_audio, generate_audio sampler channels).
 *
 * A URL must be public, or one of this fleet's own services (SsrfGuard),
 * on every hop. A path is read only where every read tool may read:
 * inside a workspace root, or under this service's own temp root (task
 * output, transcripts) — validatePath's read rule, which also refuses
 * secrets such as .env files and keys.
 */
export async function resolveAudioInput(input: string): Promise<Buffer> {
  // Unresolved harness sentinel — no attached audio existed to substitute.
  assertNoUnresolvedAttachedSentinel(
    input,
    "audio",
    "an explicit URL or data URI",
  );

  if (input.startsWith("data:")) {
    const commaIndex = input.indexOf(",");
    if (commaIndex === -1) {
      throw new AudioSourceError("Invalid data URI: missing comma separator");
    }
    const base64Data = input.slice(commaIndex + 1);
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > MAX_AUDIO_INPUT_BYTES) throw tooLarge("Input audio");
    return buffer;
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    let response: Response;
    try {
      response = await fetchPublicOrOwnUrl(input);
    } catch (error: unknown) {
      throw new AudioSourceError(
        `Failed to fetch audio from URL: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new AudioSourceError(`Failed to fetch audio from URL: HTTP ${response.status}`);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_AUDIO_INPUT_BYTES) {
      throw tooLarge("Remote audio");
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_AUDIO_INPUT_BYTES) throw tooLarge("Downloaded audio");
    return buffer;
  }

  if (input.startsWith("/")) {
    const validation = validatePath(input, { read: true });
    if (!validation.safe) {
      throw new AudioSourceError(`Audio path not allowed: ${validation.error}`);
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(validation.resolved);
    } catch (error: unknown) {
      throw new AudioSourceError(
        `Could not read audio file ${input}: ${(error as Error).message}`,
      );
    }
    if (buffer.length > MAX_AUDIO_INPUT_BYTES) throw tooLarge("Local audio file");
    return buffer;
  }

  if (input.startsWith("minio://")) {
    throw new AudioSourceError(
      "minio:// references are internal storage refs and cannot be fetched. " +
        "Use the public https URL from the earlier tool result instead " +
        "(its downloadUrl or display.url field).",
    );
  }

  throw new AudioSourceError(
    "Invalid input: must be a URL (http/https), base64 data URI (data:audio/...), or absolute file path",
  );
}

export interface DecodedPcm {
  pcm: Float32Array;
  sampleRate: number;
  durationSeconds: number;
  truncated: boolean;
}

/**
 * Decodes any ffmpeg-readable audio into mono float PCM at the requested
 * sample rate. Decoding is capped at `maxDurationSeconds` — sampler
 * buffers live in tracker session memory, so unbounded decodes would let
 * a single long upload pin tens of MB per channel.
 */
export async function decodeAudioToPcm(
  encodedAudio: Buffer,
  options: { sampleRate: number; maxDurationSeconds: number },
): Promise<DecodedPcm> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "audio-decode-"));
  const inputPath = join(temporaryDirectory, "input");
  const outputPath = join(temporaryDirectory, "output.f32");

  try {
    await writeFile(inputPath, encodedAudio);

    // Decode slightly past the cap so we can distinguish "fit exactly"
    // from "was truncated" without probing the source duration first.
    const decodeWindow = options.maxDurationSeconds + 0.05;
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", inputPath,
        "-t", String(decodeWindow),
        "-ac", "1",
        "-ar", String(options.sampleRate),
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        outputPath,
      ],
      { timeout: FFMPEG_TIMEOUT_MS },
    );

    const rawPcm = await readFile(outputPath);
    const totalSamples = Math.floor(rawPcm.length / 4);
    if (totalSamples === 0) {
      throw new Error("Decoded audio contains no samples — is the input a valid audio file?");
    }

    const maxSamples = Math.floor(options.maxDurationSeconds * options.sampleRate);
    const truncated = totalSamples > maxSamples;
    const keptSamples = truncated ? maxSamples : totalSamples;

    const pcm = new Float32Array(keptSamples);
    for (let i = 0; i < keptSamples; i++) {
      pcm[i] = rawPcm.readFloatLE(i * 4);
    }

    return {
      pcm,
      sampleRate: options.sampleRate,
      durationSeconds: keptSamples / options.sampleRate,
      truncated,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Invalid data") || message.includes("could not find codec")) {
      throw new Error(`Could not decode audio input: ${message}`, { cause: error });
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
