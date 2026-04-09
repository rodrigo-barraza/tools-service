import * as cheerio from "cheerio";
import logger from "../../logger.js";

// ═══════════════════════════════════════════════════════════════
//  Clock Crew Forum Fetcher — clockcrew.net SMF 2.1 Scraper
// ═══════════════════════════════════════════════════════════════
//  Scrapes threads and posts from all boards on the Clock Crew
//  forum. Uses cheerio for HTML parsing (no headless browser).
//  Designed for idempotent, resumable operation.
// ═══════════════════════════════════════════════════════════════

const BASE_URL = "https://clockcrew.net/talk/index.php";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

// Polite delay between requests to avoid hammering the forum
const REQUEST_DELAY_MS = 800;

/**
 * Sleep for the given milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL and return the HTML body as a string.
 * Includes retry logic with exponential backoff.
 */
async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      if (attempt === retries) throw error;
      const backoff = attempt * 2000;
      logger.warn(
        `[ClockCrew] Attempt ${attempt}/${retries} failed for ${url} — retrying in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
}

// ─── Board Discovery ────────────────────────────────────────────

/**
 * Discover all boards from the forum index page.
 * Returns an array of { boardId, name }.
 */
export async function fetchBoardList() {
  const html = await fetchPage(BASE_URL);
  const $ = cheerio.load(html);
  const boards = [];
  const seen = new Set();

  $('a[href*="board="]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/board=(\d+)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      boards.push({
        boardId: parseInt(match[1], 10),
        name: $(el).text().trim(),
      });
    }
  });

  return boards;
}

// ─── Thread Listing ─────────────────────────────────────────────

/**
 * Fetch all topic IDs from a single board page at the given offset.
 * Returns { topics: [{ topicId, title, author, replies, views }], hasMore }.
 */
export async function fetchBoardPage(boardId, offset = 0) {
  const url = `${BASE_URL}?board=${boardId}.${offset}`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const topics = [];

  // Extract board name from page title (e.g. "General Discussion")
  let boardName = "";
  const $title = $("title");
  if ($title.length) {
    // SMF titles are like "Board Name - Forum Name" or just "Board Name"
    boardName = $title.text().split(" - ")[0].trim();
  }

  // SMF topic rows live inside <span id="msg_NNNNN">
  $('span[id^="msg_"]').each((_i, el) => {
    const $span = $(el);
    const $link = $span.find("a").first();
    const href = $link.attr("href") || "";
    const topicMatch = href.match(/topic=(\d+)/);
    if (!topicMatch) return;

    const topicId = parseInt(topicMatch[1], 10);
    const title = $link.text().trim();

    // Walk up to the parent row to find the author
    const $row =
      $span.closest("td").parent() || $span.closest("tr") || $span.parent();
    let author = "";

    // SMF puts the author in a "Farted by <a>..." or "Started by <a>..."
    const rowHtml = $row.html() || "";
    const authorMatch = rowHtml.match(
      /(?:Farted|Started)\s+by\s+<a[^>]*>([^<]+)<\/a>/i,
    );
    if (authorMatch) {
      author = authorMatch[1].trim();
    }

    topics.push({
      topicId,
      title,
      author,
      boardId,
    });
  });

  // Check if there's a next page
  const maxOffset = Math.max(
    0,
    ...Array.from(
      html.matchAll(new RegExp(`board=${boardId}\\.(\\d+)`, "g")),
      (m) => parseInt(m[1], 10),
    ),
  );

  return {
    topics,
    boardName,
    hasMore: offset + 20 <= maxOffset,
    maxOffset,
  };
}

/**
 * Fetch ALL topic IDs from a board (all pages).
 * Yields progress callbacks.
 */
export async function fetchAllThreadsForBoard(
  boardId,
  onProgress = () => {},
) {
  const allTopics = [];
  let offset = 0;
  let hasMore = true;
  let pageCount = 0;
  let boardName = "";

  while (hasMore) {
    const result = await fetchBoardPage(boardId, offset);
    allTopics.push(...result.topics);
    if (!boardName && result.boardName) boardName = result.boardName;
    pageCount++;
    onProgress({
      boardId,
      offset,
      topicsFound: allTopics.length,
      pageCount,
    });

    hasMore = result.hasMore;
    offset += 20;
    if (hasMore) await sleep(REQUEST_DELAY_MS);
  }

  return { topics: allTopics, boardName };
}

// ─── Post Scraping ──────────────────────────────────────────────

/**
 * Parse a single SMF post element into a structured object.
 */
function parsePost($, $postWrapper, topicId, boardId) {
  // Each post is wrapped in a <div class="windowbg"> or <div class="windowbg2">
  // The message ID is in a link like <a id="msg1234567"> or href="...msg=1234567"
  const wrapperHtml = $postWrapper.html() || "";

  // Extract message ID
  const msgIdMatch = wrapperHtml.match(/msg[=_]?(\d{4,})/);
  if (!msgIdMatch) return null;
  const messageId = parseInt(msgIdMatch[1], 10);

  // Extract author — in the poster_info or from the profile link
  let author = "";
  const $authorLink = $postWrapper.find(
    '.poster h4 a, .poster_info h4 a, a[title="View the profile"]',
  );
  if ($authorLink.length) {
    author = $authorLink.first().text().trim();
  } else {
    // Guest poster
    const $guestH4 = $postWrapper.find(".poster h4, .poster_info h4");
    if ($guestH4.length) {
      author = $guestH4.first().text().trim();
    }
  }

  // Extract author's profile URL (for userId)
  let authorProfileUrl = "";
  let authorUserId = null;
  const $profileLink = $postWrapper.find('a[href*="action=profile;u="]');
  if ($profileLink.length) {
    authorProfileUrl = $profileLink.first().attr("href") || "";
    const uidMatch = authorProfileUrl.match(/u=(\d+)/);
    if (uidMatch) authorUserId = parseInt(uidMatch[1], 10);
  }

  // Extract post date — look for the timestamp link near the message anchor
  let date = null;
  // SMF 2.1 puts dates in links like: <a href="...msg=NNNNN">November 10, 2019, 03:56:49 PM</a>
  const dateRegex =
    /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4},\s+\d{2}:\d{2}:\d{2}\s+[AP]M)/;
  const dateMatch = wrapperHtml.match(dateRegex);
  if (dateMatch) {
    date = new Date(dateMatch[1]);
    if (isNaN(date.getTime())) date = null;
  }

  // Extract post body
  const $body = $postWrapper.find(".post, .inner");
  let body = "";
  let bodyHtml = "";
  if ($body.length) {
    bodyHtml = $body.first().html() || "";
    body = $body.first().text().trim();
  }

  // Extract quoted content
  const quotes = [];
  $postWrapper.find(".quoteheader, blockquote").each((_i, el) => {
    const $q = $(el);
    if ($q.is(".quoteheader")) {
      // Get the "Quote from: Author on Date" text
      quotes.push({ header: $q.text().trim(), text: "" });
    } else if ($q.is("blockquote") && quotes.length > 0) {
      quotes[quotes.length - 1].text = $q.text().trim();
    } else if ($q.is("blockquote")) {
      quotes.push({ header: "", text: $q.text().trim() });
    }
  });

  // Extract image links
  const images = [];
  $postWrapper
    .find(".post img, .inner img")
    .each((_i, el) => {
      const src = $(el).attr("src");
      if (
        src &&
        !src.includes("smileys") &&
        !src.includes("Smileys") &&
        !src.includes("/icons/") &&
        !src.includes("avatar")
      ) {
        images.push(src);
      }
    });

  // Extract outbound links
  const links = [];
  $postWrapper
    .find(".post a[href], .inner a[href]")
    .each((_i, el) => {
      const href = $(el).attr("href") || "";
      if (
        href.startsWith("http") &&
        !href.includes("clockcrew.net/talk") &&
        !href.includes("javascript:")
      ) {
        links.push({
          url: href,
          text: $(el).text().trim(),
        });
      }
    });

  // Extract the poster's custom title / blurb
  let posterTitle = "";
  const $blurb = $postWrapper.find(".blurb, .custom_title");
  if ($blurb.length) {
    posterTitle = $blurb.first().text().trim();
  }

  return {
    messageId,
    topicId,
    boardId,
    author,
    authorUserId,
    authorProfileUrl,
    posterTitle,
    date,
    body,
    bodyHtml,
    quotes,
    images,
    links,
  };
}

/**
 * Fetch and parse all posts from a single topic page.
 * Returns { posts, threadTitle, threadAuthor, hasMore, totalPages }.
 */
export async function fetchTopicPage(topicId, offset = 0) {
  const url = `${BASE_URL}?topic=${topicId}.${offset}`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  // Extract thread title from breadcrumb or page title
  let threadTitle = "";
  const $title = $("title");
  if ($title.length) {
    threadTitle = $title.text().trim();
  }

  // Determine the board from breadcrumb
  let boardId = null;
  $('a[href*="board="]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/board=(\d+)/);
    if (m) boardId = parseInt(m[1], 10);
  });

  // Parse the "Farted by Author, Date" line
  let threadAuthor = "";
  let threadDate = null;
  const pageText = $.root().text();
  const fartedMatch = pageText.match(
    /Farted by\s+([^,]+),\s*(\w+ \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2} [AP]M)/,
  );
  if (fartedMatch) {
    threadAuthor = fartedMatch[1].trim();
    threadDate = new Date(fartedMatch[2]);
    if (isNaN(threadDate.getTime())) threadDate = null;
  }

  // Parse individual posts
  const posts = [];
  // SMF 2.1 wraps each post in <div class="windowbg"> or <div class="windowbg2">
  $(".windowbg").each((_i, el) => {
    const post = parsePost($, $(el), topicId, boardId);
    if (post) posts.push(post);
  });

  // If the above didn't work, try the SMF 2.1 structure with #msg_NNNNN wrappers
  if (posts.length === 0) {
    $('[id^="msg_"]').each((_i, el) => {
      const $wrapper = $(el).closest(".windowbg, .windowbg2, .post_wrapper");
      if ($wrapper.length) {
        const post = parsePost($, $wrapper, topicId, boardId);
        if (post) posts.push(post);
      }
    });
  }

  // Determine pagination
  const maxTopicOffset = Math.max(
    0,
    ...Array.from(
      html.matchAll(new RegExp(`topic=${topicId}\\.(\\d+)`, "g")),
      (m) => parseInt(m[1], 10),
    ),
  );

  return {
    posts,
    threadTitle,
    threadAuthor,
    threadDate,
    boardId,
    hasMore: offset + 20 <= maxTopicOffset,
    maxOffset: maxTopicOffset,
  };
}

/**
 * Fetch ALL posts from a topic (all pages).
 */
export async function fetchAllPostsForTopic(topicId) {
  const allPosts = [];
  let offset = 0;
  let hasMore = true;
  let threadMeta = null;

  while (hasMore) {
    const result = await fetchTopicPage(topicId, offset);

    if (!threadMeta) {
      threadMeta = {
        topicId,
        title: result.threadTitle,
        author: result.threadAuthor,
        date: result.threadDate,
        boardId: result.boardId,
      };
    }

    allPosts.push(...result.posts);
    hasMore = result.hasMore;
    offset += 20;
    if (hasMore) await sleep(REQUEST_DELAY_MS);
  }

  return { posts: allPosts, thread: threadMeta };
}
