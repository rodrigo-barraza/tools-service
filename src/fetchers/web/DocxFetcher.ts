// ─── Download and Extract Text from DOCX URLs / Data URIs ────

import mammoth from "mammoth";
import { errorMessage, randomUserAgent } from "../../utilities.ts";
import {
  isUnresolvedAttachedSentinel,
  buildAttachedSentinelError,
} from "../../services/AttachedMediaSentinel.ts";
import { fetchPublicOrOwnUrl } from "./SsrfGuard.ts";

const MAX_DOCX_BYTES = 10_485_760; // 10 MB
const MAX_TEXT_CHARS = 100_000;
const FETCH_TIMEOUT_MS = 30_000;

// Define an interface for the mammoth methods not fully exposed in typescript declarations
interface MammothExtended {
  convertToMarkdown(
    input: { buffer: Buffer },
    options?: unknown,
  ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
  extractRawText(
    input: { buffer: Buffer },
  ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
}

const mammothParser = mammoth as unknown as MammothExtended;

// ─── Public API ───────────────────────────────────────────────────

export interface DocxOptions {
  maxChars?: number | string;
  outputFormat?: "markdown" | "text";
}

/** Short echo label for a source — avoids returning megabytes of base64. */
function describeSource(url: string): string {
  return url.startsWith("data:") ? `data: URI (${url.length} chars)` : url;
}

/**
 * Resolve a DOCX source (http(s) URL or base64 data: URI) to a Buffer.
 * Returns an error object in the same shape the reader responses use.
 */
async function resolveDocxBuffer(
  url: string,
): Promise<
  | { buffer: Buffer; contentType: string }
  | { error: string; url: string }
> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]*)(?:;base64)?,(.*)$/s);
    if (!match) {
      return {
        error:
          "Invalid data URI format. Expected: data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,<data>",
        url: describeSource(url),
      };
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > MAX_DOCX_BYTES) {
      return {
        error: `DOCX too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 10 MB)`,
        url: describeSource(url),
      };
    }
    return { buffer, contentType: match[1] || "application/octet-stream" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetchPublicOrOwnUrl(url, {
    signal: controller.signal,
    headers: {
      "User-Agent": randomUserAgent(),
      Accept:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/octet-stream,*/*",
    },
  });
  clearTimeout(timeout);

  if (!response.ok) {
    return { error: `HTTP ${response.status}: ${response.statusText}`, url };
  }

  // Verify content type
  const contentType = response.headers.get("content-type") || "";
  const isDocxContentType =
    contentType.includes("wordprocessingml") ||
    contentType.includes("msword") ||
    contentType.includes("octet-stream");

  if (!isDocxContentType) {
    return {
      error: `URL does not point to a DOCX (content-type: ${contentType})`,
      url,
    };
  }

  // Check content length
  const contentLength = parseInt(
    response.headers.get("content-length") || "0",
    10,
  );
  if (contentLength > MAX_DOCX_BYTES) {
    return {
      error: `DOCX too large: ${(contentLength / 1_048_576).toFixed(1)} MB (max: 10 MB)`,
      url,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_DOCX_BYTES) {
    return {
      error: `DOCX too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 10 MB)`,
      url,
    };
  }

  return { buffer, contentType };
}

/**
 * Read a DOCX from an http(s) URL or a base64 data: URI and extract its
 * text/markdown content.
 */
export async function readDocxUrl(url: string, options: DocxOptions = {}) {
  if (!url || typeof url !== "string") {
    return { error: "URL is required" };
  }

  // Unresolved harness sentinel — no attached document existed to substitute.
  if (isUnresolvedAttachedSentinel(url)) {
    return {
      error: buildAttachedSentinelError(
        "document",
        "an explicit URL or data: URI",
      ),
    };
  }

  try {
    const resolved = await resolveDocxBuffer(url);
    if ("error" in resolved) {
      return resolved;
    }
    const { buffer, contentType } = resolved;

    const targetFormat = options.outputFormat || "markdown";
    const useMarkdown = targetFormat === "markdown";

    // Perform mammoth conversion
    const conversionResult = useMarkdown
      ? await mammothParser.convertToMarkdown({ buffer })
      : await mammothParser.extractRawText({ buffer });

    let content = conversionResult.value || "";
    const charCount = content.length;

    // Apply max characters limit if requested
    const charsLimit = options.maxChars
      ? parseInt(String(options.maxChars), 10)
      : MAX_TEXT_CHARS;
    const isTruncated = charCount > charsLimit;
    if (isTruncated) {
      content = content.slice(0, charsLimit) + "\n\n... [truncated]";
    }

    const warnings = conversionResult.messages.map((message) => message.message);

    return {
      url: describeSource(url),
      info: {
        contentType,
      },
      content,
      charCount,
      truncated: isTruncated,
      outputFormat: targetFormat,
      warnings,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        error: `DOCX download timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
        url: describeSource(url),
      };
    }
    return {
      error: `DOCX extraction failed: ${errorMessage(error)}`,
      url: describeSource(url),
    };
  }
}
