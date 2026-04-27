import * as cheerio from "cheerio";
import { createHash } from "crypto";
import { basename, extname } from "path";

// ═══════════════════════════════════════════════════════════════
//  ClockCrew Asset Service — Extract & Archive BBS Media
// ═══════════════════════════════════════════════════════════════
//  Extracts embedded media URLs from ClockCrew BBS posts and
//  uploads them to MinIO. Handles dedup, categorization, retry.
// ═══════════════════════════════════════════════════════════════

// ─── Asset Category Mapping ─────────────────────────────────────

const EXT_TO_CATEGORY = {
  // Images
  ".jpg": "images", ".jpeg": "images", ".png": "images", ".gif": "images",
  ".bmp": "images", ".webp": "images", ".tiff": "images", ".tif": "images",
  ".ico": "images", ".svg": "images",

  // Flash
  ".swf": "flash", ".fla": "flash", ".dcr": "flash", ".dir": "flash",

  // Audio
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".mid": "audio",
  ".midi": "audio", ".wma": "audio", ".aac": "audio", ".flac": "audio",
  ".mod": "audio", ".xm": "audio", ".it": "audio", ".s3m": "audio",

  // Video
  ".mp4": "video", ".avi": "video", ".wmv": "video", ".flv": "video",
  ".mov": "video", ".mpg": "video", ".mpeg": "video", ".3gp": "video",

  // Archives
  ".zip": "archives", ".rar": "archives", ".7z": "archives",
  ".tar": "archives", ".gz": "archives", ".bz2": "archives",
};

const MIME_TO_CATEGORY = {
  "image/": "images",
  "audio/": "audio",
  "video/": "video",
  "application/x-shockwave-flash": "flash",
  "application/zip": "archives",
  "application/x-rar": "archives",
  "application/x-7z": "archives",
  "application/gzip": "archives",
  "application/octet-stream": null, // Fall back to extension
};

// File extensions we consider "media assets" worth downloading
const MEDIA_EXTENSIONS = new Set(Object.keys(EXT_TO_CATEGORY));

// Known dead/useless hosts to skip entirely
const SKIP_HOSTS = new Set([
  "www.clockcrew.net", // Relative to forum — handled separately
]);

// SMF smiley/icon paths to ignore
const IGNORE_PATTERNS = [
  /smileys/i,
  /Smileys/i,
  /\/icons\//i,
  /\/avatars?\//i,
  /\/Themes\//i,
  /gravatar\.com/i,
  /pixel\.quantserve/i,
  /doubleclick\.net/i,
  /google-analytics/i,
  /favicon/i,
];

// ─── URL Extraction ─────────────────────────────────────────────

/**
 * Extract all media-related URLs from a post's HTML body.
 * Uses both DOM parsing (cheerio) and regex for BBCode/bare URLs.
 *
 * @param {string} bodyHtml - Raw HTML from post body
 * @param {string[]} [existingImages=[]] - Already-parsed images from scraper
 * @param {Array<{url: string}>} [existingLinks=[]] - Already-parsed links from scraper
 * @returns {Array<{url: string, type: string, context: string}>}
 */
export function extractAssetUrls(bodyHtml, existingImages = [], existingLinks = []) {
  const found = new Map(); // url → { url, type, context }

  function add(url, type, context) {
    if (!url || typeof url !== "string") return;

    // Clean up the URL
    url = url.trim();

    // Skip data URIs, javascript, anchors
    if (url.startsWith("data:") || url.startsWith("javascript:") || url.startsWith("#")) return;

    // Skip forum-internal navigation links
    if (url.includes("clockcrew.net/talk/index.php?action=") && !url.includes("dlattach")) return;
    if (url.includes("clockcrew.net/talk/index.php?topic=")) return;
    if (url.includes("clockcrew.net/talk/index.php?board=")) return;

    // Skip smileys, icons, avatars, tracking pixels
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(url)) return;
    }

    // Normalize protocol-relative URLs
    if (url.startsWith("//")) {
      url = "http:" + url;
    }

    // Must be HTTP(S)
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      // Could be a relative URL on clockcrew.net
      if (url.startsWith("/")) {
        url = "https://clockcrew.net" + url;
      } else {
        return; // Skip non-HTTP URLs
      }
    }

    // Skip known useless hosts
    try {
      const hostname = new URL(url).hostname;
      if (SKIP_HOSTS.has(hostname)) return;
    } catch {
      return; // Invalid URL
    }

    if (!found.has(url)) {
      found.set(url, { url, type, context });
    }
  }

  // ── 1. Use pre-extracted images[] from scraper ────────────────
  for (const src of existingImages) {
    add(src, "img-scraped", "pre-extracted by scraper");
  }

  // ── 2. Use pre-extracted links[] from scraper ────────────────
  for (const link of existingLinks) {
    const url = typeof link === "string" ? link : link?.url;
    if (url && hasMediaExtension(url)) {
      add(url, "link-scraped", "pre-extracted link");
    }
  }

  // ── 3. Parse bodyHtml with cheerio for deeper extraction ─────
  if (bodyHtml) {
    try {
      const $ = cheerio.load(bodyHtml, { decodeEntities: true });

      // <img> tags
      $("img").each((_i, el) => {
        const src = $(el).attr("src");
        add(src, "img", "img tag");
      });

      // <a> tags pointing to media files
      $("a[href]").each((_i, el) => {
        const href = $(el).attr("href");
        if (hasMediaExtension(href)) {
          add(href, "link", "anchor href");
        }
        // SMF attachment downloads
        if (href && href.includes("dlattach")) {
          add(href, "attachment", "SMF attachment");
        }
      });

      // <embed> / <object> tags (Flash)
      $("embed[src]").each((_i, el) => {
        add($(el).attr("src"), "embed", "embed tag");
      });
      $("object param[name='movie']").each((_i, el) => {
        add($(el).attr("value"), "object", "object param");
      });
      $("object[data]").each((_i, el) => {
        add($(el).attr("data"), "object", "object data attr");
      });

      // <source> tags (audio/video)
      $("source[src]").each((_i, el) => {
        add($(el).attr("src"), "source", "source tag");
      });

      // <audio> / <video> tags
      $("audio[src], video[src]").each((_i, el) => {
        add($(el).attr("src"), "media", "audio/video tag");
      });

      // <iframe> pointing to media (e.g., YouTube won't be downloaded, but SWF embeds might)
      $("iframe[src]").each((_i, el) => {
        const src = $(el).attr("src");
        if (src && hasMediaExtension(src)) {
          add(src, "iframe", "iframe src");
        }
      });
    } catch {
      // cheerio parse failure — fall through to regex
    }

    // ── 4. BBCode patterns (may exist in raw HTML) ─────────────
    // [img]URL[/img]
    const imgBBCode = bodyHtml.matchAll(/\[img\](.*?)\[\/img\]/gi);
    for (const m of imgBBCode) {
      add(m[1], "bbcode-img", "[img] BBCode");
    }

    // [flash=W,H]URL[/flash]
    const flashBBCode = bodyHtml.matchAll(/\[flash[^\]]*\](.*?)\[\/flash\]/gi);
    for (const m of flashBBCode) {
      add(m[1], "bbcode-flash", "[flash] BBCode");
    }

    // [url=...]...[/url] — only if URL points to a media file
    const urlBBCode = bodyHtml.matchAll(/\[url=([^\]]+)\]/gi);
    for (const m of urlBBCode) {
      if (hasMediaExtension(m[1])) {
        add(m[1], "bbcode-url", "[url] BBCode");
      }
    }

    // [attach]...[/attach] — SMF attachment references
    // These are typically IDs, not full URLs
    const attachBBCode = bodyHtml.matchAll(/\[attach\](\d+)\[\/attach\]/gi);
    for (const m of attachBBCode) {
      const attachUrl = `https://clockcrew.net/talk/index.php?action=dlattach;attach=${m[1]};type=avatar`;
      add(attachUrl, "bbcode-attach", "[attach] BBCode");
    }

    // ── 5. Bare URLs in text pointing to media files ───────────
    const bareUrls = bodyHtml.matchAll(/https?:\/\/[^\s"'<>[\]]+/gi);
    for (const m of bareUrls) {
      let url = m[0];
      // Clean trailing punctuation/HTML artifacts
      url = url.replace(/[)},;:!?]+$/, "");
      url = url.replace(/&amp;.*$/, ""); // Truncate at HTML entities that are likely garbage
      if (hasMediaExtension(url)) {
        add(url, "bare-url", "bare URL in text");
      }
    }
  }

  return Array.from(found.values());
}

/**
 * Check if a URL has a media file extension.
 */
function hasMediaExtension(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const pathname = new URL(url, "http://x").pathname;
    const ext = extname(pathname).toLowerCase().split("?")[0];
    return MEDIA_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

// ─── Asset Categorization ───────────────────────────────────────

/**
 * Determine the storage category for an asset based on its URL and content type.
 *
 * @param {string} url - The asset URL
 * @param {string} [contentType=""] - The HTTP Content-Type header value
 * @returns {string} Category name: "images", "flash", "audio", "video", "archives", or "other"
 */
export function categorizeAsset(url, contentType = "") {
  // Try by file extension first (most reliable for old forum content)
  try {
    const pathname = new URL(url, "http://x").pathname;
    const ext = extname(pathname).toLowerCase().split("?")[0];
    if (EXT_TO_CATEGORY[ext]) return EXT_TO_CATEGORY[ext];
  } catch { /* ignore */ }

  // Fall back to content type
  if (contentType) {
    const ct = contentType.toLowerCase();
    for (const [prefix, category] of Object.entries(MIME_TO_CATEGORY)) {
      if (category && ct.startsWith(prefix)) return category;
    }
  }

  return "other";
}

// ─── Download ───────────────────────────────────────────────────

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB max per file
const RETRY_COUNT = 3;
const RETRY_BASE_DELAY_MS = 1_000;

const DOWNLOAD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Download a file from a URL with retry + timeout.
 *
 * @param {string} url
 * @returns {Promise<{buffer: Buffer, contentType: string, finalUrl: string, sizeBytes: number} | null>}
 *   Returns null if the download fails after all retries.
 */
export async function downloadAsset(url) {
  let _lastError = null;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: DOWNLOAD_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        _lastError = new Error(`HTTP ${response.status}`);
        // Don't retry 4xx errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return null;
        }
        continue;
      }

      // Check content length before downloading full body
      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_FILE_SIZE) {
        return null; // Too large
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > MAX_FILE_SIZE) {
        return null;
      }

      // Skip empty files
      if (buffer.length === 0) {
        return null;
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const finalUrl = response.url || url;

      return {
        buffer,
        contentType: contentType.split(";")[0].trim(),
        finalUrl,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      _lastError = err;
      if (attempt < RETRY_COUNT) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return null;
}

// ─── Hashing & Key Building ─────────────────────────────────────

/**
 * Compute SHA256 hash of a buffer.
 * @param {Buffer} buffer
 * @returns {string} Hex-encoded hash
 */
export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Build a MinIO object key for an asset.
 *
 * @param {string} category - "images", "flash", "audio", etc.
 * @param {string} hash - SHA256 hash of the file content
 * @param {string} url - Original URL (used to derive filename)
 * @returns {string} MinIO object key
 */
export function buildMinioKey(category, hash, url) {
  const prefix = hash.substring(0, 12);
  let filename = "file";

  try {
    const pathname = new URL(url, "http://x").pathname;
    filename = basename(pathname) || "file";
    // Sanitize filename — keep only safe characters
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    // Truncate overly long filenames
    if (filename.length > 120) {
      const ext = extname(filename);
      filename = filename.substring(0, 100) + ext;
    }
  } catch { /* use default */ }

  return `${category}/${prefix}_${filename}`;
}

// ─── MinIO Upload ───────────────────────────────────────────────

/**
 * Upload an asset buffer to MinIO, deduplicating by SHA256.
 *
 * @param {import("minio").Client} minioClient - MinIO client instance
 * @param {string} bucket - Bucket name
 * @param {Buffer} buffer - File data
 * @param {string} key - Object key
 * @param {string} contentType - MIME type
 * @returns {Promise<void>}
 */
export async function uploadToMinio(minioClient, bucket, buffer, key, contentType) {
  await minioClient.putObject(bucket, key, buffer, buffer.length, {
    "Content-Type": contentType,
  });
}

/**
 * Check if an object already exists in MinIO.
 *
 * @param {import("minio").Client} minioClient
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function existsInMinio(minioClient, bucket, key) {
  try {
    await minioClient.statObject(bucket, key);
    return true;
  } catch {
    return false;
  }
}

// ─── Bucket Setup ───────────────────────────────────────────────

const BUCKET_NAME = "clockcrew-assets";

/**
 * Ensure the clockcrew-assets bucket exists with public read policy.
 *
 * @param {import("minio").Client} minioClient
 * @returns {Promise<string>} The bucket name
 */
export async function ensureBucket(minioClient) {
  const exists = await minioClient.bucketExists(BUCKET_NAME);
  if (!exists) {
    await minioClient.makeBucket(BUCKET_NAME);
    console.log(`🪣 Created MinIO bucket: ${BUCKET_NAME}`);
  }

  // Set public read-only policy
  const publicPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { AWS: ["*"] },
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`],
    }],
  });
  await minioClient.setBucketPolicy(BUCKET_NAME, publicPolicy);

  return BUCKET_NAME;
}

export { BUCKET_NAME };
