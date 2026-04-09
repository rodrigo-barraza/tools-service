// ============================================================
// Hacker News Fetcher — Post + Comment Thread
// ============================================================
// Uses the official HN Firebase API. Fully public, no auth.
// Docs: https://github.com/HackerNewsAPI/API
// ============================================================

const HN_API = "https://hacker-news.firebaseio.com/v0";
const MAX_COMMENTS = 25;

// ─── URL Parsing ───────────────────────────────────────────────────

const HN_URL_REGEX =
  /(?:https?:\/\/)?(?:news\.ycombinator\.com)\/item\?id=(\d+)/i;

/**
 * Extract a HN item ID from a URL or raw ID.
 * @param {string} input
 * @returns {string|null}
 */
function parseHnInput(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  const match = trimmed.match(HN_URL_REGEX);
  if (match) return match[1];

  // Bare numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;

  return null;
}

// ─── Comment Fetching ────────────────────────────────────────────

/**
 * Recursively fetch comment tree (breadth-first, limited depth).
 * @param {number[]} ids - Comment IDs
 * @param {number} remaining - How many more comments to fetch
 * @param {number} depth - Current depth
 * @returns {Promise<object[]>}
 */
async function fetchComments(ids, remaining, depth = 0) {
  if (!ids?.length || remaining <= 0 || depth > 3) return [];

  const batch = ids.slice(0, remaining);
  const comments = [];

  const items = await Promise.all(
    batch.map((id) =>
      fetch(`${HN_API}/item/${id}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ),
  );

  for (const item of items) {
    if (!item || item.deleted || item.dead || comments.length >= remaining) continue;

    const comment = {
      id: item.id,
      author: item.by || "[deleted]",
      text: item.text || "",
      time: item.time ? new Date(item.time * 1000).toISOString() : null,
      depth,
    };

    comments.push(comment);

    // Fetch child comments
    if (item.kids?.length && comments.length < remaining) {
      const children = await fetchComments(
        item.kids,
        remaining - comments.length,
        depth + 1,
      );
      comments.push(...children);
    }
  }

  return comments;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch a Hacker News post with top comments.
 * @param {string} input - HN URL or item ID
 * @param {object} [options]
 * @param {number} [options.commentLimit=25]
 * @returns {Promise<object>}
 */
export async function getHackerNewsThread(input, options = {}) {
  const itemId = parseHnInput(input);
  if (!itemId) {
    return { error: `Invalid Hacker News URL or ID: "${input}"` };
  }

  const { commentLimit = MAX_COMMENTS } = options;

  try {
    const res = await fetch(`${HN_API}/item/${itemId}.json`);
    if (!res.ok) {
      return { error: `HN API error: ${res.status}` };
    }

    const item = await res.json();
    if (!item) {
      return { error: `Item not found: ${itemId}` };
    }

    const result = {
      id: item.id,
      type: item.type,
      title: item.title || null,
      url: item.url || null,
      hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
      author: item.by || null,
      score: item.score || 0,
      commentCount: item.descendants || 0,
      time: item.time ? new Date(item.time * 1000).toISOString() : null,
      text: item.text || null,
    };

    // Fetch top comments
    if (item.kids?.length) {
      result.comments = await fetchComments(item.kids, commentLimit);
    } else {
      result.comments = [];
    }

    return result;
  } catch (error) {
    return { error: `HN fetch failed: ${error.message}` };
  }
}
