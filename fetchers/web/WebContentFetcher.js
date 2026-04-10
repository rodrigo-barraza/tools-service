// ============================================================
// Web Content Fetcher — Unified URL → Structured Content
// ============================================================
// Auto-detects the platform from a URL and delegates to the
// specialized fetcher. One tool replaces six individual ones,
// saving system prompt space for the agent.
//
// Supported platforms:
//   GitHub, Reddit, Twitter/X, Hacker News, Stack Overflow,
//   YouTube, and any generic web page (fallback)
// ============================================================

import { getRedditThread } from "./RedditFetcher.js";
import { getTwitterPost } from "./TwitterFetcher.js";
import { getHackerNewsThread } from "./HackerNewsFetcher.js";
import { getStackOverflowQuestion } from "./StackOverflowFetcher.js";
import { getGitHubRepo } from "./GitHubFetcher.js";
import { getYouTubeVideoInfo } from "../knowledge/YouTubeFetcher.js";
import { fetchGenericPage } from "./GenericPageFetcher.js";

// ─── Platform Detection ──────────────────────────────────────────
// Order matters: more specific patterns first, catch-alls last.

const PLATFORM_PATTERNS = [
  {
    platform: "youtube",
    test: (url) =>
      /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url),
  },
  {
    platform: "reddit",
    test: (url) =>
      /(?:reddit\.com|redd\.it)/i.test(url) ||
      /^r\/\w+\/comments\//i.test(url),
  },
  {
    platform: "twitter",
    test: (url) =>
      /(?:twitter\.com|x\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com|nitter\.\w+)/i.test(url) ||
      (/\/status\/\d+/i.test(url) && !/reddit|github|stackoverflow/i.test(url)),
  },
  {
    platform: "hackernews",
    test: (url) =>
      /(?:news\.ycombinator\.com)/i.test(url),
  },
  {
    platform: "stackoverflow",
    test: (url) =>
      /(?:stackoverflow\.com|stackexchange\.com)/i.test(url) ||
      /^(?:stackoverflow|so):\d+$/i.test(url),
  },
  {
    platform: "github",
    test: (url) =>
      /(?:github\.com)/i.test(url) ||
      // owner/repo shorthand: must have exactly one slash, no dots in TLD pattern
      /^[a-zA-Z][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+$/.test(url),
  },
];

/**
 * Detect which platform a URL belongs to.
 * @param {string} url
 * @returns {string|null} Platform name, or null for generic pages
 */
function detectPlatform(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  for (const { platform, test } of PLATFORM_PATTERNS) {
    if (test(trimmed)) return platform;
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Extract structured content from any URL.
 * Auto-detects GitHub, Reddit, Twitter/X, Hacker News, Stack Overflow,
 * or YouTube. Falls back to generic HTML extraction for unknown sites.
 *
 * @param {string} url - Any URL
 * @param {object} [options]
 * @param {number}  [options.commentLimit]  - Max comments (Reddit/HN, default: 20/25)
 * @param {number}  [options.answerLimit]   - Max answers (Stack Overflow, default: 5)
 * @param {string}  [options.readme]        - "true"/"false" — include README (GitHub, default: true)
 * @param {string}  [options.languages]     - "true"/"false" — include language breakdown (GitHub, default: true)
 * @param {string}  [options.transcript]    - "true"/"false" — include transcript (YouTube, default: true)
 * @param {string}  [options.lang]          - Transcript language (YouTube, default: "en")
 * @param {number}  [options.maxChars]      - Max body text chars (generic, default: 15000)
 * @returns {Promise<object>} Platform-specific result with "platform" field
 */
export async function getWebContent(url, options = {}) {
  const platform = detectPlatform(url);

  let result;

  switch (platform) {
    case "youtube":
      result = await getYouTubeVideoInfo(url, {
        lang: options.lang,
        includeTranscript: options.transcript !== "false",
        includeTimestamps: true,
      });
      break;

    case "reddit":
      result = await getRedditThread(url, {
        commentLimit: options.commentLimit ? parseInt(options.commentLimit, 10) : undefined,
      });
      break;

    case "twitter":
      result = await getTwitterPost(url);
      break;

    case "hackernews":
      result = await getHackerNewsThread(url, {
        commentLimit: options.commentLimit ? parseInt(options.commentLimit, 10) : undefined,
      });
      break;

    case "stackoverflow": {
      // Strip "so:" or "stackoverflow:" prefix if used
      const soUrl = url.replace(/^(?:stackoverflow|so):/i, "");
      result = await getStackOverflowQuestion(soUrl, {
        answerLimit: options.answerLimit ? parseInt(options.answerLimit, 10) : undefined,
      });
      break;
    }

    case "github":
      result = await getGitHubRepo(url, {
        includeReadme: options.readme !== "false",
        includeLanguages: options.languages !== "false",
      });
      break;

    default:
      // Generic fallback — fetch + Cheerio extraction
      result = await fetchGenericPage(url, {
        maxChars: options.maxChars,
      });
      break;
  }

  // Tag the result with the detected platform
  if (result && !result.error) {
    result.platform = platform || "generic";
  }

  return result;
}

export { detectPlatform };
