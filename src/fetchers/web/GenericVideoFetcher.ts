// ─── Unified Video Downloader ───────────────────────────────
// Single video download tool powered by yt-dlp. Works with
// any URL from 1000+ supported sites (YouTube, Twitter/X,
// TikTok, Twitch, Vimeo, Dailymotion, etc.). For YouTube
// URLs, also accepts raw 11-character video IDs and all
// youtu.be/youtube.com URL formats. Returns temp file path
// + metadata for the route handler to deliver via MinIO or
// GIF conversion.

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import logger from "../../logger.ts";
import { errorMessage } from "../../utilities.ts";
import { convertVideoToGif } from "../../services/VideoService.ts";
import { extractVideoId } from "../knowledge/YouTubeFetcher.ts";
import { ownServiceOrigins, validatePublicWebUrl } from "./SsrfGuard.ts";

// ─── Constants ─────────────────────────────────────────────────────

const DOWNLOAD_TIMEOUT_MILLISECONDS = 180_000;
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const YTDLP_BINARY = "yt-dlp";

// ─── URL Validation & Normalization ────────────────────────────────

const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

export function normalizeInputUrl(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // YouTube raw video ID (11-char alphanumeric string)
  const videoId = extractVideoId(trimmed);
  if (videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  // YouTube URL normalization (already a valid YouTube URL)
  if (YOUTUBE_URL_REGEX.test(trimmed)) {
    return trimmed;
  }

  // Generic URL — just validate it's a valid HTTP(S) URL
  try {
    const parsedUrl = new URL(trimmed);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

// ─── yt-dlp Download ───────────────────────────────────────────────

export type VideoDownloadFormat = "mp4" | "mp3" | "gif";

interface YtDlpDownloadResult {
  filePath: string;
  fileSize: number;
  format: string;
}

function runYtDlpDownload(
  videoUrl: string,
  outputDirectory: string,
  format: "mp4" | "mp3",
): Promise<YtDlpDownloadResult> {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDirectory, "%(id)s.%(ext)s");

    const processArguments: string[] =
      format === "mp3"
        ? [
            videoUrl,
            "--format", "bestaudio",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-thumbnail",
            "--embed-metadata",
            "--output", outputTemplate,
            "--no-playlist",
            "--no-check-certificates",
            "--quiet",
            "--no-warnings",
            "--print", "after_move:filepath",
            "--max-filesize", `${MAX_FILE_SIZE_BYTES}`,
          ]
        : [
            videoUrl,
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            "--embed-thumbnail",
            "--embed-metadata",
            "--embed-subs",
            "--sub-langs", "en",
            "--output", outputTemplate,
            "--no-playlist",
            "--no-check-certificates",
            "--quiet",
            "--no-warnings",
            "--print", "after_move:filepath",
            "--max-filesize", `${MAX_FILE_SIZE_BYTES}`,
          ];

    const childProcess = spawn(YTDLP_BINARY, processArguments, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DOWNLOAD_TIMEOUT_MILLISECONDS,
    });

    let standardOutput = "";
    let standardError = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      standardOutput += chunk.toString();
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      standardError += chunk.toString();
    });

    childProcess.on("close", async (exitCode) => {
      if (exitCode !== 0) {
        const errorDetail = standardError.trim() || `yt-dlp exited with code ${exitCode}`;
        return reject(new Error(`Video download failed: ${errorDetail}`));
      }

      const downloadedFilePath = standardOutput.trim();
      if (!downloadedFilePath) {
        return reject(new Error("yt-dlp produced no output file path"));
      }

      try {
        const fileStats = await stat(downloadedFilePath);
        resolve({
          filePath: downloadedFilePath,
          fileSize: fileStats.size,
          format: path.extname(downloadedFilePath).replace(".", ""),
        });
      } catch {
        reject(new Error(`Downloaded file not found at: ${downloadedFilePath}`));
      }
    });

    childProcess.on("error", (processError) => {
      reject(
        new Error(
          `Failed to spawn yt-dlp: ${processError.message}. ` +
            "Ensure yt-dlp is installed and available in PATH.",
        ),
      );
    });
  });
}

// ─── Metadata Extraction via yt-dlp ────────────────────────────────

export interface VideoMetadata {
  title: string;
  uploader: string;
  channel: string | null;
  platform: string;
  durationSeconds: number | null;
  viewCount: number | null;
  uploadDate: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  originalUrl: string;
}

function extractMetadataViaYtDlp(videoUrl: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const processArguments = [
      videoUrl,
      "--no-download",
      "--no-playlist",
      "--no-check-certificates",
      "--quiet",
      "--no-warnings",
      "--print", "%(title)s\n%(uploader)s\n%(channel)s\n%(extractor)s\n%(duration)s\n%(view_count)s\n%(upload_date)s\n%(description).200s\n%(thumbnail)s",
    ];

    const childProcess = spawn(YTDLP_BINARY, processArguments, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    let standardOutput = "";
    let standardError = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      standardOutput += chunk.toString();
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      standardError += chunk.toString();
    });

    childProcess.on("close", (exitCode) => {
      if (exitCode !== 0) {
        const errorDetail = standardError.trim();
        if (errorDetail.includes("Unsupported URL") || errorDetail.includes("No video found")) {
          return reject(new Error(`Unsupported URL or no video found: ${errorDetail}`));
        }
        return resolve(buildFallbackMetadata(videoUrl));
      }

      const lines = standardOutput.trim().split("\n");
      const parseNumber = (value: string): number | null => {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) || value === "NA" ? null : parsed;
      };
      const cleanField = (value: string | undefined): string | null => {
        if (!value || value === "NA" || value === "None") return null;
        return value;
      };

      resolve({
        title: lines[0] && lines[0] !== "NA" ? lines[0] : "Video",
        uploader: lines[1] && lines[1] !== "NA" ? lines[1] : "Unknown",
        channel: cleanField(lines[2]),
        platform: lines[3] && lines[3] !== "NA" ? lines[3] : "Unknown",
        durationSeconds: parseNumber(lines[4] || ""),
        viewCount: parseNumber(lines[5] || ""),
        uploadDate: cleanField(lines[6]),
        description: cleanField(lines[7]),
        thumbnailUrl: cleanField(lines[8]),
        originalUrl: videoUrl,
      });
    });

    childProcess.on("error", () => {
      resolve(buildFallbackMetadata(videoUrl));
    });
  });
}

function buildFallbackMetadata(videoUrl: string): VideoMetadata {
  return {
    title: "Video",
    uploader: "Unknown",
    channel: null,
    platform: "Unknown",
    durationSeconds: null,
    viewCount: null,
    uploadDate: null,
    description: null,
    thumbnailUrl: null,
    originalUrl: videoUrl,
  };
}

// ─── Public API ────────────────────────────────────────────────────

export interface VideoFileResult {
  metadata: VideoMetadata;
  filePath: string;
  fileSize: number;
  format: string;
  mimeType: string;
  temporaryDirectory: string;
}

export interface VideoGifResult {
  metadata: VideoMetadata;
  gifBuffer: Buffer;
  mimeType: "image/gif";
}

export interface VideoErrorResult {
  error: string;
}

export type VideoDownloadResult =
  | VideoFileResult
  | VideoGifResult
  | VideoErrorResult;

export function isVideoFileResult(result: VideoDownloadResult): result is VideoFileResult {
  return "filePath" in result;
}

export function isVideoGifResult(result: VideoDownloadResult): result is VideoGifResult {
  return "gifBuffer" in result;
}

export function isVideoErrorResult(result: VideoDownloadResult): result is VideoErrorResult {
  return "error" in result;
}

export async function downloadVideo(
  input: string,
  format: VideoDownloadFormat = "mp4",
): Promise<VideoDownloadResult> {
  let temporaryDirectory: string | null = null;

  try {
    const normalizedUrl = normalizeInputUrl(input);
    if (!normalizedUrl) {
      return { error: `Invalid URL or video ID: "${input}". Provide a valid HTTP/HTTPS URL or YouTube video ID.` };
    }
    // A model's URL: public, or one of our own services. yt-dlp fetches it
    // itself, so this checks the URL and its addresses before it starts.
    const verdict = await validatePublicWebUrl(normalizedUrl, {
      trustedOrigins: ownServiceOrigins(),
    });
    if (!verdict.ok) {
      return { error: verdict.error ?? `Blocked: ${normalizedUrl}` };
    }

    logger.info(
      `[VideoFetcher] Downloading ${format.toUpperCase()}: ${normalizedUrl}`,
    );

    // For GIF, we download as MP4 first, then convert
    const downloadFormat: "mp4" | "mp3" = format === "gif" ? "mp4" : format;

    // Metadata extraction and download directory creation in parallel
    const [metadata, downloadDirectory] = await Promise.all([
      extractMetadataViaYtDlp(normalizedUrl),
      mkdtemp(path.join(tmpdir(), "video-download-")),
    ]);

    temporaryDirectory = downloadDirectory;

    logger.info(
      `[VideoFetcher] [${metadata.platform}] "${metadata.title}" by ${metadata.channel || metadata.uploader} ` +
        `(${metadata.durationSeconds ?? "?"}s)`,
    );

    const downloadResult = await runYtDlpDownload(
      normalizedUrl,
      temporaryDirectory,
      downloadFormat,
    );

    logger.info(
      `[VideoFetcher] Download complete: ${(downloadResult.fileSize / 1024 / 1024).toFixed(1)} MB`,
    );

    // ── GIF Conversion Path ──────────────────────────────────
    if (format === "gif") {
      logger.info("[VideoFetcher] Converting MP4 → GIF via ffmpeg...");

      const gifResult = await convertVideoToGif({
        input: downloadResult.filePath,
        quality: "high",
        width: 480,
        fps: 15,
      });

      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      temporaryDirectory = null;

      logger.info(
        `[VideoFetcher] GIF conversion complete: ${(gifResult.buffer.length / 1024 / 1024).toFixed(1)} MB`,
      );

      return {
        metadata,
        gifBuffer: gifResult.buffer,
        mimeType: "image/gif",
      };
    }

    // ── File Path Return (MP4/MP3) ───────────────────────────
    const actualFormat = downloadResult.format;
    const mimeType =
      actualFormat === "mp3"
        ? "audio/mpeg"
        : actualFormat === "mp4"
          ? "video/mp4"
          : actualFormat === "webm"
            ? "video/webm"
            : `video/${actualFormat}`;

    return {
      metadata,
      filePath: downloadResult.filePath,
      fileSize: downloadResult.fileSize,
      format: actualFormat,
      mimeType,
      temporaryDirectory,
    };
  } catch (error: unknown) {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }

    logger.error(
      `[VideoFetcher] Download failed: ${errorMessage(error)}`,
    );
    return { error: `Video download failed: ${errorMessage(error)}` };
  }
}
