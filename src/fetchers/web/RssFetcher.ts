// ─── Parse RSS/Atom Feeds into Structured JSON ──────────────

import xml2js from "xml2js";
import { USER_AGENT } from "../../constants.ts";
import { errorMessage } from "../../utilities.ts";
import { fetchPublicUrl } from "./SsrfGuard.ts";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ITEMS = 50;

// ─── Public API ───────────────────────────────────────────────────

export interface RssOptions {
  limit?: number;
}

/**
 * Fetch and parse an RSS or Atom feed.
 *
 *
 */
export async function readRssFeed(url: string, options: RssOptions = {}) {
  if (!url || typeof url !== "string") {
    return { error: "Feed URL is required" };
  }

  const { limit = 20 } = options;
  const clampedLimit = Math.min(limit, MAX_ITEMS);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // A caller's URL: every hop must land in public address space
    const response = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}`, url };
    }

    const xml = await response.text();

    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      trim: true,
    });

    const parsed = await parser.parseStringPromise(xml);

    // Detect feed format and parse accordingly
    if (parsed.rss?.channel) {
      return parseRss2(parsed.rss.channel, url, clampedLimit);
    }
    if (parsed.feed) {
      return parseAtom(parsed.feed, url, clampedLimit);
    }

    return {
      error: "Unrecognized feed format (expected RSS 2.0 or Atom)",
      url,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        error: `Feed fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
        url,
      };
    }
    return { error: `Feed parsing failed: ${errorMessage(error)}`, url };
  }
}

// ─── RSS 2.0 Parser ──────────────────────────────────────────────

interface Rss2Channel {
  item?: Rss2Item | Rss2Item[];
  title?: string;
  description?: string;
  link?: string;
  language?: string;
  lastBuildDate?: string;
}

interface Rss2Item {
  title?: string;
  link?: string;
  pubDate?: string;
  author?: string;
  "dc:creator"?: string;
  description?: string;
  "content:encoded"?: string;
  category?: unknown;
  guid?: string | { _?: string };
}

function parseRss2(channel: Rss2Channel, feedUrl: string, limit: number) {
  const items = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];

  return {
    format: "rss2",
    feedUrl,
    title: channel.title || null,
    description: channel.description || null,
    link: channel.link || null,
    language: channel.language || null,
    lastBuildDate: channel.lastBuildDate || null,
    itemCount: items.length,
    items: items.slice(0, limit).map((item: Rss2Item) => ({
      title: item.title || null,
      link:
        item.link ||
        (typeof item.guid === "object" ? item.guid?._ : item.guid) ||
        null,
      pubDate: item.pubDate || null,
      author: item["dc:creator"] || item.author || null,
      description: stripCdata(item.description || ""),
      content: stripCdata(item["content:encoded"] || ""),
      categories: normalizeArray(item.category),
      guid: typeof item.guid === "object" ? item.guid?._ : item.guid || null,
    })),
  };
}

// ─── Atom Parser ─────────────────────────────────────────────────

interface AtomFeed {
  entry?: AtomEntry | AtomEntry[];
  title?: string | { _?: string };
  subtitle?: string | { _?: string };
  link?: string | Array<{ "rel"?: string; href?: string }> | { href?: string };
  updated?: string;
}

interface AtomEntry {
  title?: string | { _?: string };
  link?: string | Array<{ "rel"?: string; href?: string }> | { href?: string };
  published?: string;
  updated?: string;
  author?: { name?: string } | string | { _?: string };
  summary?: string | { _?: string };
  content?: string | { _?: string };
  category?: unknown;
  id?: string;
}

function parseAtom(feed: AtomFeed, feedUrl: string, limit: number) {
  const entries = Array.isArray(feed.entry)
    ? feed.entry
    : feed.entry
      ? [feed.entry]
      : [];

  return {
    format: "atom",
    feedUrl,
    title: extractText(feed.title),
    subtitle: extractText(feed.subtitle) || null,
    link: extractLink(feed.link) || null,
    updated: feed.updated || null,
    itemCount: entries.length,
    items: entries.slice(0, limit).map((entry: AtomEntry) => ({
      title: extractText(entry.title),
      link: extractLink(entry.link) || null,
      pubDate: entry.published || entry.updated || null,
      author:
        (typeof entry.author === "object" &&
        entry.author !== null &&
        "name" in entry.author
          ? entry.author.name
          : extractText(entry.author as string | { _?: string } | undefined)) ||
        null,
      description: extractText(entry.summary) || "",
      content: extractText(entry.content) || "",
      categories: (
        normalizeArray(entry.category) as Array<string | Record<string, string>>
      ).map((category) => (typeof category === "object" ? category.term || category.label : category)),
      id: entry.id || null,
    })),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function extractText(
  field: string | { _?: string } | null | undefined,
): string | null {
  if (!field) return null;
  if (typeof field === "string") return field;
  if (field._ !== undefined) return field._;
  return null;
}

function extractLink(
  link:
    | string
    | Array<{ "rel"?: string; href?: string }>
    | { href?: string }
    | null
    | undefined,
): string | null {
  if (!link) return null;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alternate = link.find((l) => l['rel'] === "alternate") || link[0];
    return alternate?.href || null;
  }
  return link.href || null;
}

function normalizeArray(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function stripCdata(cdataString: string): string {
  if (!cdataString) return "";
  return cdataString.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}
