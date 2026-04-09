// ============================================================
// Reddit Fetcher — Thread Content + Top Comments
// ============================================================
// Uses Reddit's public .json suffix API. No auth needed.
// Rate limit: ~10 requests/minute unauthenticated.
// ============================================================

const MAX_COMMENTS = 20;
const MAX_BODY_CHARS = 10_000;

// ─── URL Parsing ───────────────────────────────────────────────────

const REDDIT_THREAD_REGEX =
  /(?:https?:\/\/)?(?:(?:www|old|new)\.)?reddit\.com\/(r\/[^/]+\/comments\/[a-z0-9]+[^?\s]*)/i;

const REDD_IT_REGEX = /(?:https?:\/\/)?redd\.it\/([a-z0-9]+)/i;

/**
 * Normalize a Reddit URL to its .json endpoint.
 * @param {string} input
 * @returns {string|null}
 */
function buildRedditJsonUrl(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // Full reddit.com URL
  const fullMatch = trimmed.match(REDDIT_THREAD_REGEX);
  if (fullMatch) {
    const path = fullMatch[1].replace(/\/$/, "");
    return `https://www.reddit.com/${path}.json`;
  }

  // redd.it short URL
  const shortMatch = trimmed.match(REDD_IT_REGEX);
  if (shortMatch) {
    return `https://www.reddit.com/comments/${shortMatch[1]}.json`;
  }

  // Bare path like r/programming/comments/abc123/title
  if (trimmed.startsWith("r/") && trimmed.includes("/comments/")) {
    return `https://www.reddit.com/${trimmed.replace(/\/$/, "")}.json`;
  }

  return null;
}

// ─── Comment Tree Flattening ──────────────────────────────────────

function extractComments(children, limit) {
  const comments = [];

  for (const child of children) {
    if (comments.length >= limit) break;
    if (child.kind !== "t1") continue;

    const c = child.data;
    comments.push({
      author: c.author,
      score: c.score,
      body: c.body?.length > MAX_BODY_CHARS
        ? c.body.slice(0, MAX_BODY_CHARS) + "... [truncated]"
        : c.body,
      createdUtc: c.created_utc,
      isOp: c.is_submitter || false,
      depth: c.depth || 0,
      awards: c.total_awards_received || 0,
    });

    // Recurse into replies (flatten tree)
    if (c.replies?.data?.children?.length && comments.length < limit) {
      const nested = extractComments(c.replies.data.children, limit - comments.length);
      comments.push(...nested);
    }
  }

  return comments;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch a Reddit thread with post content and top comments.
 * @param {string} input - Reddit URL (full, short, or path)
 * @param {object} [options]
 * @param {number} [options.commentLimit=20]
 * @returns {Promise<object>}
 */
export async function getRedditThread(input, options = {}) {
  const jsonUrl = buildRedditJsonUrl(input);
  if (!jsonUrl) {
    return { error: `Invalid Reddit URL: "${input}"` };
  }

  const { commentLimit = MAX_COMMENTS } = options;

  try {
    const res = await fetch(jsonUrl, {
      headers: {
        "User-Agent": "SunTools/1.0 (web content extraction)",
      },
    });

    if (!res.ok) {
      if (res.status === 404) return { error: "Reddit thread not found" };
      if (res.status === 429) return { error: "Reddit rate limit exceeded" };
      return { error: `Reddit API error: ${res.status}` };
    }

    const data = await res.json();

    // Reddit returns [post_listing, comment_listing]
    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) {
      return { error: "Could not parse Reddit response" };
    }

    const commentChildren = data[1]?.data?.children || [];
    const comments = extractComments(commentChildren, commentLimit);

    const selfText = post.selftext || "";

    return {
      title: post.title,
      author: post.author,
      subreddit: post.subreddit_name_prefixed,
      score: post.score,
      upvoteRatio: post.upvote_ratio,
      url: `https://www.reddit.com${post.permalink}`,
      externalUrl: post.url !== `https://www.reddit.com${post.permalink}` ? post.url : null,
      selfText: selfText.length > MAX_BODY_CHARS
        ? selfText.slice(0, MAX_BODY_CHARS) + "... [truncated]"
        : selfText,
      commentCount: post.num_comments,
      createdUtc: post.created_utc,
      flair: post.link_flair_text || null,
      isNsfw: post.over_18 || false,
      isPinned: post.stickied || false,
      awards: post.total_awards_received || 0,
      domain: post.domain || null,
      comments,
    };
  } catch (error) {
    return { error: `Reddit fetch failed: ${error.message}` };
  }
}
