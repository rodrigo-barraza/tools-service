// ============================================================
// YouTube Fetcher — Video Metadata + Transcript Extraction
// ============================================================
// Combines YouTube's public oEmbed API (no API key required)
// with the youtube-transcript package for caption/subtitle
// extraction. Supports standard watch URLs, short URLs,
// shorts, and live streams.
//
// oEmbed docs: https://oembed.com/
// ============================================================

import { YoutubeTranscript } from "youtube-transcript/dist/youtube-transcript.esm.js";

// ─── URL Parsing ───────────────────────────────────────────────────

/**
 * Regex that extracts a YouTube video ID from all common URL formats:
 *   - youtube.com/watch?v=ID
 *   - youtu.be/ID
 *   - youtube.com/shorts/ID
 *   - youtube.com/live/ID
 *   - youtube.com/embed/ID
 *   - youtube.com/v/ID
 *   - Raw 11-char video IDs
 */
const YOUTUBE_ID_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;

/**
 * Extract a YouTube video ID from a URL or raw ID string.
 * @param {string} input - URL or video ID
 * @returns {string|null} 11-character video ID or null
 */
export function extractVideoId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  const match = trimmed.match(YOUTUBE_ID_REGEX);
  if (!match) return null;
  return match[1] || match[2] || null;
}

// ─── oEmbed Metadata ──────────────────────────────────────────────

const OEMBED_URL = "https://www.youtube.com/oembed";

/**
 * Fetch video metadata via YouTube's public oEmbed endpoint.
 * Returns title, author, thumbnail — no API key needed.
 * @param {string} videoId
 * @returns {Promise<object|null>}
 */
async function fetchOembedMetadata(videoId) {
  const url = `${OEMBED_URL}?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  return {
    title: data.title || null,
    author: data.author_name || null,
    authorUrl: data.author_url || null,
    thumbnailUrl: data.thumbnail_url || null,
    thumbnailWidth: data.thumbnail_width || null,
    thumbnailHeight: data.thumbnail_height || null,
    providerName: data.provider_name || "YouTube",
  };
}

// ─── HTML Page Metadata (Open Graph) ──────────────────────────────

/**
 * Scrape additional metadata from the YouTube video page HTML.
 * Gets description and other OG tags not available via oEmbed.
 * @param {string} videoId
 * @returns {Promise<object>}
 */
async function fetchPageMetadata(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return {};
    const html = await res.text();

    const extract = (pattern) => {
      const match = html.match(pattern);
      return match ? match[1]?.replace(/\\u0026/g, "&")?.replace(/\\"/g, '"') : null;
    };

    // Extract from meta tags and JSON-LD
    const description =
      extract(/<meta\s+name="description"\s+content="([^"]*)"/) ||
      extract(/<meta\s+property="og:description"\s+content="([^"]*)"/) ||
      null;

    const publishDate =
      extract(/<meta\s+itemprop="datePublished"\s+content="([^"]*)"/) ||
      null;

    const genre =
      extract(/<meta\s+itemprop="genre"\s+content="([^"]*)"/) ||
      null;

    const duration =
      extract(/<meta\s+itemprop="duration"\s+content="([^"]*)"/) ||
      null;

    const isFamilyFriendly =
      extract(/<meta\s+itemprop="isFamilyFriendly"\s+content="([^"]*)"/) ||
      null;

    const viewCount =
      extract(/<meta\s+itemprop="interactionCount"\s+content="([^"]*)"/) ||
      null;

    const keywords =
      extract(/<meta\s+name="keywords"\s+content="([^"]*)"/) ||
      null;

    const channelId =
      extract(/<meta\s+itemprop="channelId"\s+content="([^"]*)"/) ||
      null;

    return {
      description,
      publishDate,
      genre,
      duration,
      isFamilyFriendly: isFamilyFriendly === "true" ? true : isFamilyFriendly === "false" ? false : null,
      viewCount: viewCount ? parseInt(viewCount, 10) || null : null,
      keywords: keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : null,
      channelId,
    };
  } catch {
    return {};
  }
}

// ─── Transcript Extraction ────────────────────────────────────────

/**
 * Fetch the transcript/captions for a YouTube video.
 * @param {string} videoId
 * @param {string} [lang] - Preferred language code (e.g. "en", "es")
 * @returns {Promise<object>}
 */
async function fetchTranscript(videoId, lang) {
  try {
    const config = { lang: lang || "en" };
    const entries = await YoutubeTranscript.fetchTranscript(videoId, config);

    if (!entries?.length) {
      return { available: false, segments: [], text: "" };
    }

    const segments = entries.map((entry) => {
      const offsetMs = entry.offset || 0;
      const minutes = Math.floor(offsetMs / 60000);
      const seconds = Math.floor((offsetMs % 60000) / 1000);
      const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

      return {
        timestamp,
        offsetMs,
        durationMs: entry.duration || 0,
        text: entry.text || "",
      };
    });

    const fullText = segments.map((s) => s.text).join(" ");
    const timestampedText = segments
      .map((s) => `[${s.timestamp}] ${s.text}`)
      .join("\n");

    return {
      available: true,
      segmentCount: segments.length,
      segments,
      text: fullText,
      timestampedText,
    };
  } catch (error) {
    return {
      available: false,
      segments: [],
      text: "",
      error: error.message || "Transcript unavailable",
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Full YouTube video info: metadata + transcript.
 * The primary endpoint for the agentic YouTube tool.
 * @param {string} input - YouTube URL or video ID
 * @param {object} [options]
 * @param {string} [options.lang] - Preferred transcript language
 * @param {boolean} [options.includeTranscript=true] - Whether to fetch transcript
 * @param {boolean} [options.includeTimestamps=true] - Include timestamps in transcript
 * @returns {Promise<object>}
 */
export async function getYouTubeVideoInfo(input, options = {}) {
  const videoId = extractVideoId(input);
  if (!videoId) {
    return { error: `Invalid YouTube URL or video ID: "${input}"` };
  }

  const {
    lang,
    includeTranscript = true,
    includeTimestamps = true,
  } = options;

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Fetch metadata and transcript concurrently
  const tasks = [
    fetchOembedMetadata(videoId),
    fetchPageMetadata(videoId),
  ];

  if (includeTranscript) {
    tasks.push(fetchTranscript(videoId, lang));
  }

  const [oembed, page, transcript] = await Promise.all(tasks);

  const result = {
    videoId,
    url: videoUrl,
    title: oembed?.title || null,
    author: oembed?.author || null,
    authorUrl: oembed?.authorUrl || null,
    channelId: page?.channelId || null,
    description: page?.description || null,
    publishDate: page?.publishDate || null,
    duration: page?.duration || null,
    genre: page?.genre || null,
    viewCount: page?.viewCount || null,
    isFamilyFriendly: page?.isFamilyFriendly ?? null,
    keywords: page?.keywords || null,
    thumbnailUrl: oembed?.thumbnailUrl || null,
  };

  if (includeTranscript && transcript) {
    result.transcript = {
      available: transcript.available,
      segmentCount: transcript.segmentCount || 0,
      language: lang || "en",
      text: includeTimestamps
        ? transcript.timestampedText || ""
        : transcript.text || "",
    };
    if (transcript.error) {
      result.transcript.error = transcript.error;
    }
  }

  return result;
}
