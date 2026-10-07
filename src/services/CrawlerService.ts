// ─── Single-Page Static Scrape ───────────────────────────────
// Fetches one caller-supplied page through the SSRF guard — every hop in
// public address space, checked as it connects — and hands its parsed
// HTML to an extraction function. Serves GET /utility/scrape/metadata,
// which lupos-bot calls for link previews, so it is open to anyone.

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { fetchPublicUrl, UnsafeUrlError } from "../fetchers/web/SsrfGuard.ts";
import logger from "../logger.ts";
import { errorMessage } from "../utilities.ts";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 30_000;
/** Network failures, 5xx and 429 get this many tries in all. */
const ATTEMPTS = 2;
/** A longer page is cut here; its head, where metadata lives, comes first. */
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type ExtractionFunction = (context: {
  $: CheerioAPI;
  url: string;
}) => unknown | Promise<unknown>;

export interface CrawlStaticOptions {
  extractFunction?: ExtractionFunction;
}

export interface CrawlResult {
  url: string;
  data?: unknown;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// Single-Page Scrape (Cheerio — No Browser)
// ────────────────────────────────────────────────────────────

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer.subarray(0, maxBytes - size));
    size += buffer.length;
    if (size >= maxBytes) break;
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch a single URL and run `extractFunction` over its HTML (Cheerio,
 * the encoding sniffed as a browser would).
 */
export async function crawlSingleStatic(
  url: string,
  { extractFunction }: CrawlStaticOptions = {},
): Promise<CrawlResult> {
  if (!extractFunction) {
    return { url, error: "extractFn is required" };
  }

  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetchPublicUrl(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      if (error instanceof UnsafeUrlError) return { url, error: error.message };
      lastError = errorMessage(error);
      continue;
    }

    if (response.status >= 500 || response.status === 429) {
      lastError = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => {});
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { url, error: `HTTP ${response.status}` };
    }

    const charset = /charset=([^;]+)/i
      .exec(response.headers.get("content-type") ?? "")?.[1]
      ?.trim();
    const $ = cheerio.loadBuffer(await readCapped(response, MAX_PAGE_BYTES), {
      encoding: { transportLayerEncodingLabel: charset },
    });
    try {
      return {
        url,
        data: await extractFunction({ $, url: response.url || url }),
      };
    } catch (error: unknown) {
      logger.error(
        `[Scrape] Extract failed for ${url}: ${errorMessage(error)}`,
      );
      return { url, error: errorMessage(error) };
    }
  }

  logger.error(
    `[Scrape] Failed after ${ATTEMPTS} attempts: ${url} — ${lastError}`,
  );
  return { url, error: lastError };
}
