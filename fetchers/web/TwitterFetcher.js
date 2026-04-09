// ============================================================
// Twitter/X Fetcher — Post Content Extraction
// ============================================================
// Uses the fxtwitter.com open API as primary source and
// publish.twitter.com/oembed as fallback. No auth needed.
// fxtwitter: https://github.com/FixTweet/FxTwitter
// ============================================================

const FXTWITTER_API = "https://api.fxtwitter.com";
const OEMBED_API = "https://publish.twitter.com/oembed";

// ─── URL Parsing ───────────────────────────────────────────────────

const TWITTER_URL_REGEX =
  /(?:https?:\/\/)?(?:(?:www\.|mobile\.)?(?:twitter\.com|x\.com)|(?:fixupx\.com|fxtwitter\.com|vxtwitter\.com))\/([^/\s]+)\/status\/(\d+)/i;

/**
 * Extract username and tweet ID from a Twitter/X URL.
 * @param {string} input
 * @returns {{ username: string, tweetId: string } | null}
 */
function parseTwitterUrl(input) {
  if (!input || typeof input !== "string") return null;
  const match = input.trim().match(TWITTER_URL_REGEX);
  if (match) return { username: match[1], tweetId: match[2] };

  // Bare tweet ID
  if (/^\d{10,}$/.test(input.trim())) {
    return { username: "_", tweetId: input.trim() };
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch a Twitter/X post with text, media, and engagement metrics.
 * @param {string} input - Twitter/X URL or tweet ID
 * @returns {Promise<object>}
 */
export async function getTwitterPost(input) {
  const parsed = parseTwitterUrl(input);
  if (!parsed) {
    return { error: `Invalid Twitter/X URL: "${input}"` };
  }

  const { username, tweetId } = parsed;

  // Try fxtwitter API first (richer data)
  const fxResult = await fetchFxTwitter(username, tweetId);
  if (!fxResult.error) return fxResult;

  // Fallback to oembed
  const oembedResult = await fetchOembed(tweetId);
  if (!oembedResult.error) return oembedResult;

  return { error: `Could not fetch tweet ${tweetId}: ${fxResult.error}` };
}

// ─── fxtwitter Provider ──────────────────────────────────────────

async function fetchFxTwitter(username, tweetId) {
  try {
    const res = await fetch(`${FXTWITTER_API}/${username}/status/${tweetId}`, {
      headers: { "User-Agent": "SunTools/1.0" },
    });

    if (!res.ok) {
      return { error: `fxtwitter API error: ${res.status}` };
    }

    const data = await res.json();
    const tweet = data.tweet;
    if (!tweet) return { error: "Tweet not found in response" };

    const result = {
      tweetId: tweet.id || tweetId,
      url: tweet.url || `https://x.com/${username}/status/${tweetId}`,
      author: tweet.author?.name || null,
      authorHandle: tweet.author?.screen_name ? `@${tweet.author.screen_name}` : null,
      authorVerified: tweet.author?.verified || false,
      text: tweet.text || null,
      createdAt: tweet.created_at || null,
      likes: tweet.likes ?? null,
      retweets: tweet.retweets ?? null,
      replies: tweet.replies ?? null,
      quotes: tweet.quotes ?? null,
      views: tweet.views ?? null,
      language: tweet.lang || null,
      source: tweet.source || null,
      isReply: !!tweet.replying_to,
      replyingTo: tweet.replying_to || null,
    };

    // Media
    if (tweet.media?.all?.length) {
      result.media = tweet.media.all.map((m) => ({
        type: m.type || "photo",
        url: m.url || null,
        thumbnailUrl: m.thumbnail_url || null,
        width: m.width || null,
        height: m.height || null,
        altText: m.altText || null,
      }));
    }

    // Quoted tweet
    if (tweet.quote) {
      result.quotedTweet = {
        author: tweet.quote.author?.name || null,
        authorHandle: tweet.quote.author?.screen_name
          ? `@${tweet.quote.author.screen_name}`
          : null,
        text: tweet.quote.text || null,
        url: tweet.quote.url || null,
      };
    }

    return result;
  } catch (error) {
    return { error: `fxtwitter fetch failed: ${error.message}` };
  }
}

// ─── Oembed Fallback ─────────────────────────────────────────────

async function fetchOembed(tweetId) {
  try {
    const tweetUrl = `https://twitter.com/i/status/${tweetId}`;
    const res = await fetch(
      `${OEMBED_API}?url=${encodeURIComponent(tweetUrl)}&omit_script=true`,
      { headers: { Accept: "application/json" } },
    );

    if (!res.ok) {
      return { error: `oembed error: ${res.status}` };
    }

    const data = await res.json();

    // Extract clean text from the HTML embed
    const text = data.html
      ?.replace(/<br\s*\/?>/gi, "\n")
      ?.replace(/<[^>]+>/g, "")
      ?.replace(/&amp;/g, "&")
      ?.replace(/&lt;/g, "<")
      ?.replace(/&gt;/g, ">")
      ?.replace(/&quot;/g, '"')
      ?.replace(/&#39;/g, "'")
      ?.trim() || null;

    return {
      tweetId,
      url: data.url || `https://x.com/i/status/${tweetId}`,
      author: data.author_name || null,
      authorHandle: data.author_url
        ? `@${data.author_url.split("/").pop()}`
        : null,
      text,
      source: "oembed (limited data)",
    };
  } catch (error) {
    return { error: `oembed fetch failed: ${error.message}` };
  }
}
