import * as cheerio from "cheerio";
import { sleep } from "../../utilities.js";

// ═══════════════════════════════════════════════════════════════
//  Newgrounds Profile Fetcher — newgrounds.com User Scraper
// ═══════════════════════════════════════════════════════════════
//  Scrapes Newgrounds user profile pages via cheerio.
//  Extracts: user stats, nav counts, user links, and XP data.
//  No headless browser required — static HTML parsing only.
// ═══════════════════════════════════════════════════════════════

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const REQUEST_DELAY_MS = 800;



/**
 * Fetch a URL and return the HTML body as a string.
 */
async function fetchPage(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

// ─── Profile Parsing ────────────────────────────────────────────

/**
 * Parse the userstats section from a Newgrounds profile page.
 * Extracts description, age, sex, job, school, location, join date.
 */
function parseUserStats($) {
  const stats = {
    description: "",
    realName: "",
    age: null,
    sex: "",
    job: "",
    school: "",
    location: "",
    joinDate: "",
    joinDateRaw: "",
  };

  // Description — blockquote inside userstats
  const $blockquote = $("#userstats blockquote.general");
  if ($blockquote.length) {
    stats.description = $blockquote.text().trim();
  }

  // Parse each span-1 div inside userstats
  $("#userstats .span-1").each((_i, el) => {
    const $el = $(el);
    const $icon = $el.find("i.fa");
    const text = $el.find("p").text().trim();

    if ($icon.hasClass("fa-user")) {
      // "Age 56, Male" or "Age 40" or "Male" etc.
      const ageMatch = text.match(/Age\s+(\d+)/i);
      if (ageMatch) stats.age = parseInt(ageMatch[1], 10);

      const sexMatch = text.match(/(?:,\s*)?(Male|Female|Non-binary)/i);
      if (sexMatch) stats.sex = sexMatch[1];

      // Real name: sometimes appears as "Name: ..." — but typically NG uses
      // the username display. If there's a "Name" prefix, capture it.
      const nameMatch = text.match(/Name:\s*(.+)/i);
      if (nameMatch) stats.realName = nameMatch[1].trim();
    } else if ($icon.hasClass("fa-wrench")) {
      // Job
      stats.job = text.replace(/^\s*/, "").trim();
    } else if ($icon.hasClass("fa-graduation-cap")) {
      // School
      stats.school = text.trim();
    } else if ($icon.hasClass("fa-map-marker")) {
      // Location
      stats.location = text.trim();
    } else if ($icon.hasClass("fa-calendar")) {
      // "Joined on 3/22/00"
      const joinMatch = text.match(/Joined\s+on\s+([\d/]+)/i);
      if (joinMatch) {
        stats.joinDateRaw = joinMatch[1];
        // Normalize to ISO: M/D/YY → YYYY-MM-DD
        const parts = joinMatch[1].split("/");
        if (parts.length === 3) {
          const [m, d, rawY] = parts.map(Number);
          const y = rawY < 50 ? rawY + 2000 : rawY + 1900;
          stats.joinDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      }
    }
  });

  return stats;
}

/**
 * Parse the nav counts from user-header-button links.
 * Returns: { fans, news, movies, games, audio, faves, reviews, posts }
 */
function parseNavCounts($) {
  const counts = {
    fans: { count: 0, url: "" },
    news: { count: 0, url: "" },
    movies: { count: 0, url: "" },
    games: { count: 0, url: "" },
    audio: { count: 0, url: "" },
    faves: { count: 0, url: "" },
    reviews: { count: 0, url: "" },
    posts: { count: 0, url: "" },
  };

  $(".user-header-button").each((_i, el) => {
    const $el = $(el);
    const label = $el.find("span").text().trim().toLowerCase();
    const countText = $el.find("strong").text().trim();
    const href = $el.attr("href") || "";

    // Parse count — handles "2.9K", "1.2M", plain numbers
    let count = 0;
    if (countText) {
      const kMatch = countText.match(/([\d.]+)\s*K/i);
      const mMatch = countText.match(/([\d.]+)\s*M/i);
      if (kMatch) {
        count = Math.round(parseFloat(kMatch[1]) * 1000);
      } else if (mMatch) {
        count = Math.round(parseFloat(mMatch[1]) * 1000000);
      } else {
        count = parseInt(countText.replace(/,/g, ""), 10) || 0;
      }
    }

    // Map label to key
    const keyMap = {
      fans: "fans",
      news: "news",
      movies: "movies",
      games: "games",
      audio: "audio",
      faves: "faves",
      favorites: "faves",
      reviews: "reviews",
      posts: "posts",
    };

    const key = keyMap[label];
    if (key) {
      counts[key] = { count, url: href };
    }
  });

  return counts;
}

/**
 * Parse user links from the #user_links section.
 * Returns an array of { text, url, faviconUrl }.
 */
function parseUserLinks($) {
  const links = [];

  $("#user_links .user-link").each((_i, el) => {
    const $el = $(el);
    const url = $el.attr("href") || "";
    const text = $el.find("strong.link").text().trim();
    const faviconUrl = $el.find("img").attr("src") || "";

    if (url) {
      links.push({ text, url, faviconUrl });
    }
  });

  return links;
}

/**
 * Parse detailed user stats (level, exp, rank, blam/protect, trophies, medals).
 */
function parseDetailedStats($) {
  const detailed = {
    level: null,
    expPoints: "",
    expRank: null,
    votePower: "",
    rank: "",
    globalRank: null,
    blams: null,
    saves: null,
    trophies: null,
    medals: null,
    supporter: "",
  };

  // Parse dl.stats-general dt/dd pairs
  $("dl.stats-general").each((_i, dl) => {
    $(dl)
      .find("dt")
      .each((_j, dt) => {
        const label = $(dt).text().trim().replace(/:$/, "");
        const $dd = $(dt).next("dd");
        if (!$dd.length) return;
        const value = $dd.text().trim();

        switch (label) {
          case "Level":
            detailed.level = parseInt(value, 10) || null;
            break;
          case "Exp Points":
            detailed.expPoints = value;
            break;
          case "Exp Rank":
            detailed.expRank = parseInt(value.replace(/,/g, ""), 10) || null;
            break;
          case "Vote Power":
            detailed.votePower = value;
            break;
          case "Rank":
            detailed.rank = value;
            break;
          case "Global Rank":
            detailed.globalRank =
              parseInt(value.replace(/,/g, ""), 10) || null;
            break;
          case "Blams":
            detailed.blams = parseInt(value.replace(/,/g, ""), 10) || null;
            break;
          case "Saves":
            detailed.saves = parseInt(value.replace(/,/g, ""), 10) || null;
            break;
          case "Trophies":
            detailed.trophies = parseInt(value.replace(/,/g, ""), 10) || null;
            break;
          case "Medals":
            detailed.medals = parseInt(value.replace(/,/g, ""), 10) || null;
            break;
          case "Supporter":
            detailed.supporter = value;
            break;
        }
      });
  });

  // Trophies/Medals/Supporter from the combined stat link
  const $trophyLink = $('a.user-stats-small[href="/trophies"]');
  if ($trophyLink.length) {
    const trophyText = $trophyLink.text();
    const tMatch = trophyText.match(/Trophies:\s*([\d,]+)/i);
    const mMatch = trophyText.match(/Medals:\s*([\d,]+)/i);
    const sMatch = trophyText.match(/Supporter:\s*(.+?)(?:\s*$)/i);

    if (tMatch)
      detailed.trophies = parseInt(tMatch[1].replace(/,/g, ""), 10) || null;
    if (mMatch)
      detailed.medals = parseInt(mMatch[1].replace(/,/g, ""), 10) || null;
    if (sMatch) detailed.supporter = sMatch[1].trim();
  }

  return detailed;
}

/**
 * Parse the user's avatar/icon URL from the profile header.
 */
function parseAvatarUrl($) {
  // Profile icon in user-header-icon
  const $icon = $("#user-header-icon img");
  if ($icon.length) {
    return $icon.attr("src") || "";
  }

  // Fallback: og:image meta tag
  const $ogImage = $('meta[property="og:image"]');
  if ($ogImage.length) {
    return $ogImage.attr("content") || "";
  }

  return "";
}

/**
 * Parse the banner/background image if present.
 */
function parseBannerUrl($) {
  const $bg = $(".user-header-bg");
  if ($bg.length) {
    const style = $bg.attr("style") || "";
    const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
    if (bgMatch) return bgMatch[1];
  }
  return "";
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Fetch and parse a Newgrounds user's profile page by username.
 * Returns a structured profile object or null if the profile doesn't exist.
 *
 * @param {string} username - Newgrounds username (e.g. "StrawberryClock")
 * @returns {Promise<object|null>}
 */
export async function fetchNewgroundsProfile(username) {
  const profileUrl = `https://${username.toLowerCase()}.newgrounds.com`;

  let html;
  try {
    html = await fetchPage(profileUrl);
  } catch (error) {
    if (error.message.includes("404") || error.message.includes("403")) {
      return null;
    }
    throw error;
  }

  const $ = cheerio.load(html);

  // Validate we're on a real profile page — title should be the username
  const pageTitle = $("title").text().trim();
  if (!pageTitle || pageTitle.includes("Page Not Found")) return null;

  // Extract the display username from the page
  const displayName =
    $(".user-header-name h2").text().trim() ||
    $("title").text().trim().split(" - ")[0] ||
    username;

  // Parse all sections
  const userStats = parseUserStats($);
  const navCounts = parseNavCounts($);
  const userLinks = parseUserLinks($);
  const detailedStats = parseDetailedStats($);
  const avatarUrl = parseAvatarUrl($);
  const bannerUrl = parseBannerUrl($);

  return {
    username: displayName,
    usernameLower: username.toLowerCase(),
    profileUrl,
    avatarUrl,
    bannerUrl,

    // User stats
    description: userStats.description,
    realName: userStats.realName,
    age: userStats.age,
    sex: userStats.sex,
    job: userStats.job,
    school: userStats.school,
    location: userStats.location,
    joinDate: userStats.joinDate,
    joinDateRaw: userStats.joinDateRaw,

    // Nav counts
    fans: navCounts.fans,
    news: navCounts.news,
    movies: navCounts.movies,
    games: navCounts.games,
    audio: navCounts.audio,
    faves: navCounts.faves,
    reviews: navCounts.reviews,
    posts: navCounts.posts,

    // User links
    links: userLinks,

    // Detailed stats
    level: detailedStats.level,
    expPoints: detailedStats.expPoints,
    expRank: detailedStats.expRank,
    votePower: detailedStats.votePower,
    rank: detailedStats.rank,
    globalRank: detailedStats.globalRank,
    blams: detailedStats.blams,
    saves: detailedStats.saves,
    trophies: detailedStats.trophies,
    medals: detailedStats.medals,
    supporter: detailedStats.supporter,
  };
}

/**
 * Batch fetch multiple Newgrounds profiles with polite delays.
 * Returns an array of { username, profile } objects.
 *
 * @param {string[]} usernames - Array of Newgrounds usernames
 * @param {function} onProgress - Progress callback
 * @returns {Promise<object[]>}
 */
export async function fetchMultipleProfiles(
  usernames,
  onProgress = () => {},
) {
  const results = [];

  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];

    try {
      const profile = await fetchNewgroundsProfile(username);
      results.push({ username, profile, error: null });
      onProgress({
        current: i + 1,
        total: usernames.length,
        username,
        success: !!profile,
      });
    } catch (error) {
      results.push({ username, profile: null, error: error.message });
      onProgress({
        current: i + 1,
        total: usernames.length,
        username,
        success: false,
        error: error.message,
      });
    }

    if (i < usernames.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
//  Sub-Page Fetchers — Fans, News, Movies, Games, Audio, Art,
//                       Faves, Reviews, Posts
// ═══════════════════════════════════════════════════════════════

/**
 * Generic paginated fetcher. Follows "Next" links until exhausted.
 * @param {string} baseUrl - First page URL
 * @param {function} parseFn - ($, pageHtml) => items[]
 * @returns {Promise<object[]>}
 */
async function fetchAllPages(baseUrl, parseFn) {
  const allItems = [];
  let url = baseUrl;
  let pageNum = 0;

  while (url) {
    let html;
    try {
      html = await fetchPage(url);
    } catch {
      break;
    }

    const $ = cheerio.load(html);
    const items = parseFn($, html);
    allItems.push(...items);
    pageNum++;

    // Find "Next" pagination link
    const $next = $("a").filter((_i, el) => {
      const text = $(el).text().trim().toLowerCase();
      return text === "next" || text.includes("next");
    });

    // Build the absolute next URL
    const nextHref = $next.first().attr("href") || "";
    const isDisabled = $next.first().attr("disabled") !== undefined;

    if (nextHref && !isDisabled && pageNum < 100) {
      // Convert relative to absolute
      if (nextHref.startsWith("http")) {
        url = nextHref;
      } else {
        const base = baseUrl.match(/^(https?:\/\/[^/]+)/);
        url = base ? base[1] + nextHref : null;
      }
      await sleep(REQUEST_DELAY_MS);
    } else {
      url = null;
    }
  }

  return allItems;
}

// ─── Fans ───────────────────────────────────────────────────────

/**
 * Fetch all fans for a user.
 * @param {string} username
 * @returns {Promise<object[]>} Array of { fanUsername, fanProfileUrl, fanIconUrl }
 */
export async function fetchFans(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/fans`;

  return fetchAllPages(baseUrl, ($) => {
    const fans = [];
    $(".item-user-small").each((_i, el) => {
      const $el = $(el);
      const $link = $el.find("a").first();
      const href = $link.attr("href") || "";
      const fanName = $el.find("h4 a").text().trim();
      const iconUrl = $el.find("img.user-icon").attr("src") || "";

      if (fanName) {
        fans.push({
          usernameLower: username.toLowerCase(),
          fanUsername: fanName,
          fanProfileUrl: href,
          fanIconUrl: iconUrl,
        });
      }
    });
    return fans;
  });
}

// ─── Movies / Games / Audio / Art (Portal Submissions) ──────────

/**
 * Parse portal submission cards (shared by movies, games, audio, art).
 */
function parsePortalSubmissions($, username, contentType) {
  const items = [];

  $(".portalsubmission-cell").each((_i, el) => {
    const $el = $(el);
    const $link = $el.find("a.inline-card-portalsubmission");
    const url = $link.attr("href") || "";
    const title = $link.attr("title") || $el.find("h4").text().trim();
    const thumbnailUrl = $el.find("img.card-img").attr("src") || "";

    // Score from star-score
    let score = null;
    const $stars = $el.find(".star-score");
    if ($stars.length) {
      const scoreTitle = $stars.attr("title") || "";
      const scoreMatch = scoreTitle.match(/Score:\s*([\d.]+)/);
      if (scoreMatch) score = parseFloat(scoreMatch[1]);
    }

    // Extract contentId from URL: /portal/view/993382
    let contentId = null;
    const idMatch = url.match(/\/view\/(\d+)/);
    if (idMatch) contentId = parseInt(idMatch[1], 10);

    if (url) {
      items.push({
        usernameLower: username.toLowerCase(),
        contentType,
        contentId,
        title,
        url,
        thumbnailUrl,
        score,
      });
    }
  });

  return items;
}

/**
 * Fetch all movies for a user.
 */
export async function fetchMovies(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/movies`;
  return fetchAllPages(baseUrl, ($) => parsePortalSubmissions($, username, "movie"));
}

/**
 * Fetch all games for a user.
 */
export async function fetchGames(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/games`;
  return fetchAllPages(baseUrl, ($) => parsePortalSubmissions($, username, "game"));
}

/**
 * Fetch all audio for a user.
 */
export async function fetchAudio(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/audio`;

  return fetchAllPages(baseUrl, ($) => {
    const items = [];

    // Audio uses a.item-audiosubmission links
    $("a.item-audiosubmission").each((_i, el) => {
      const $el = $(el);
      const url = $el.attr("href") || "";
      const title = $el.attr("title") || $el.text().trim();

      let contentId = null;
      const idMatch = url.match(/\/listen\/(\d+)/);
      if (idMatch) contentId = parseInt(idMatch[1], 10);

      if (url && title) {
        items.push({
          usernameLower: username.toLowerCase(),
          contentType: "audio",
          contentId,
          title,
          url,
          thumbnailUrl: "",
          score: null,
        });
      }
    });

    return items;
  });
}

/**
 * Fetch all art for a user.
 */
export async function fetchArt(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/art`;

  return fetchAllPages(baseUrl, ($) => {
    const items = [];

    // Art uses gallery-style items
    $(".item-portalsubmission, .portalsubmission-cell, .art-item").each((_i, el) => {
      const $el = $(el);
      const $link = $el.find("a[href*='/view/']").first();
      const url = $link.attr("href") || "";
      const title = $link.attr("title") || $el.find("h4").text().trim();
      const thumbnailUrl = $el.find("img").first().attr("src") || "";

      let contentId = null;
      const idMatch = url.match(/\/view\/(\d+)/);
      if (idMatch) contentId = parseInt(idMatch[1], 10);

      if (url) {
        items.push({
          usernameLower: username.toLowerCase(),
          contentType: "art",
          contentId,
          title,
          url,
          thumbnailUrl,
          score: null,
        });
      }
    });

    return items;
  });
}

// ─── News ───────────────────────────────────────────────────────

/**
 * Fetch all news/blog posts for a user.
 */
export async function fetchNews(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/news`;

  return fetchAllPages(baseUrl, ($) => {
    const items = [];
    const seen = new Set();

    // News posts are linked via .pod-head h2 a[href*='/news/post/']
    $("a[href*='/news/post/']").each((_i, el) => {
      const $el = $(el);
      const url = $el.attr("href") || "";

      // Dedupe — same post can appear in multiple links
      if (!url || seen.has(url)) return;
      seen.add(url);

      // Get title from the link text or title attribute
      const title = $el.attr("title") || $el.text().trim();
      if (!title || title === "More") return;

      let contentId = null;
      const idMatch = url.match(/\/post\/(\d+)/);
      if (idMatch) contentId = parseInt(idMatch[1], 10);

      items.push({
        usernameLower: username.toLowerCase(),
        contentType: "news",
        contentId,
        contentUrl: url,
        title,
        publishedDate: null,
      });
    });

    return items;
  });
}

// ─── Favorites ──────────────────────────────────────────────────

/**
 * Fetch user's favorited content (movies, games, audio, art).
 */
export async function fetchFaves(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/favorites`;

  return fetchAllPages(baseUrl, ($) => {
    const items = [];

    // Faves use .item-portalsubmission-small and .item-audiosubmission-small
    $("a.item-portalsubmission-small, a.item-link[href*='/audio/listen/']").each((_i, el) => {
      const $el = $(el);
      const url = $el.attr("href") || "";
      const title = $el.attr("title") || $el.text().trim();
      const thumbnailUrl = $el.find("img").first().attr("src") || "";

      if (url && title) {
        items.push({
          usernameLower: username.toLowerCase(),
          contentType: "favorite",
          contentUrl: url,
          title,
          thumbnailUrl,
          author: "",
        });
      }
    });

    return items;
  });
}

// ─── Reviews ────────────────────────────────────────────────────

/**
 * Fetch all reviews written by a user.
 */
export async function fetchReviews(username) {
  const baseUrl = `https://${username.toLowerCase()}.newgrounds.com/reviews`;

  return fetchAllPages(baseUrl, ($) => {
    const items = [];

    $(".pod-body.review[data-review-id]").each((_i, el) => {
      const $el = $(el);
      const reviewId = parseInt($el.attr("data-review-id"), 10) || null;

      // Reviewed item
      const $meta = $el.find(".review-meta");
      const $itemLink = $meta.find("a[href*='/portal/view/']").first();
      const reviewedUrl = $itemLink.attr("href") || "";
      const reviewedTitle = $itemLink.text().trim();
      const reviewedThumbnail = $meta.find("img").attr("src") || "";

      // Score
      let score = null;
      const $stars = $el.find(".star-score");
      if ($stars.length) {
        const scoreTitle = $stars.attr("title") || "";
        const scoreMatch = scoreTitle.match(/Score:\s*([\d.]+)/);
        if (scoreMatch) score = parseFloat(scoreMatch[1]);
      }

      // Date
      let date = null;
      const $time = $el.find("time");
      if ($time.length) {
        date = new Date($time.text().trim());
        if (isNaN(date.getTime())) date = null;
      }

      // Body
      const body = $el.find(".review-body").text().trim();

      if (reviewId) {
        items.push({
          usernameLower: username.toLowerCase(),
          reviewId,
          reviewedUrl,
          reviewedTitle,
          reviewedThumbnail,
          score,
          date,
          body,
        });
      }
    });

    return items;
  });
}

// ─── BBS Posts ───────────────────────────────────────────────────

/**
 * Fetch forum posts by a user from the BBS search page.
 */
export async function fetchPosts(username) {
  const baseUrl = `https://www.newgrounds.com/bbs/search/author/${encodeURIComponent(username)}`;

  return fetchAllPages(baseUrl, ($) => {
    const items = [];
    const seen = new Set();

    // BBS search results use a[href*='/bbs/post/goto/']
    $("a[href*='/bbs/post/goto/']").each((_i, el) => {
      const $el = $(el);
      const url = $el.attr("href") || "";
      const title = $el.text().trim();

      let postId = null;
      const idMatch = url.match(/\/goto\/(\d+)/);
      if (idMatch) postId = parseInt(idMatch[1], 10);

      if (url && title && postId && !seen.has(postId)) {
        seen.add(postId);
        items.push({
          usernameLower: username.toLowerCase(),
          postId,
          contentUrl: url,
          title,
        });
      }
    });

    return items;
  });
}

// ─── Full User Scrape ───────────────────────────────────────────

/**
 * Fetch a complete user profile + all sub-page content.
 * Returns { profile, fans, news, movies, games, audio, art, faves, reviews, posts }.
 *
 * @param {string} username
 * @returns {Promise<object|null>}
 */
export async function fetchFullProfile(username) {
  const profile = await fetchNewgroundsProfile(username);
  if (!profile) return null;

  // Scrape each sub-page with polite delays
  const fans = profile.fans.count > 0 ? await fetchFans(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const news = profile.news.count > 0 ? await fetchNews(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const movies = profile.movies.count > 0 ? await fetchMovies(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const games = profile.games.count > 0 ? await fetchGames(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const audio = profile.audio.count > 0 ? await fetchAudio(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const art = await fetchArt(username);
  await sleep(REQUEST_DELAY_MS);

  const faves = profile.faves.count > 0 ? await fetchFaves(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const reviews = profile.reviews.count > 0 ? await fetchReviews(username) : [];
  await sleep(REQUEST_DELAY_MS);

  const posts = profile.posts.count > 0 ? await fetchPosts(username) : [];

  return { profile, fans, news, movies, games, audio, art, faves, reviews, posts };
}
