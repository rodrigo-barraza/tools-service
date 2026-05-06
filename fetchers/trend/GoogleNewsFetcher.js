import { normalizeName } from "@rodrigo-barraza/utilities-library";
import {
  TREND_SOURCES as SOURCES,
  GOOGLE_NEWS_ARTICLE_LIMIT,
} from "../../constants.js";
import {
  extractXmlTag,
  extractXmlItems,
} from "../../utilities.js";

const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss";

/**
 * Categorize a Google News article based on its source tag or section.
 * @param {string} section - RSS topic/section if present
 * @returns {string} Category string
 */
function categorizeArticle(section) {
  if (!section) return "general";

  const lower = section.toLowerCase();
  if (lower.includes("tech")) return "technology";
  if (lower.includes("sport")) return "sports";
  if (lower.includes("entertain")) return "entertainment";
  if (lower.includes("business") || lower.includes("economy")) {
    return "business";
  }
  if (lower.includes("science") || lower.includes("health")) return "science";
  if (lower.includes("world") || lower.includes("nation")) return "world";
  return "general";
}

/**
 * Fetches the top stories from Google News via their public RSS feed.
 * No API key required — returns up to ~100 headlines.
 * Feed sections: top headlines, world, nation, business, technology,
 * entertainment, sports, science, health.
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchGoogleNews() {
  const sections = [
    { url: GOOGLE_NEWS_RSS_URL, section: "Top Stories" },
    {
      url: `${GOOGLE_NEWS_RSS_URL}/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB`,
      section: "Technology",
    },
    {
      url: `${GOOGLE_NEWS_RSS_URL}/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB`,
      section: "Science",
    },
    {
      url: `${GOOGLE_NEWS_RSS_URL}/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB`,
      section: "Entertainment",
    },
    {
      url: `${GOOGLE_NEWS_RSS_URL}/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB`,
      section: "Business",
    },
  ];

  const allArticles = [];
  const seen = new Set();

  for (const { url, section } of sections) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "sun:trends:v0.1.0 (rodrigo@sun.dev)",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
      });

      if (!res.ok) {
        console.warn(`[Google News] ⚠️ ${section} returned ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const items = extractXmlItems(xml, "item");

      for (const item of items) {
        const title = extractXmlTag(item, "title");
        const link = extractXmlTag(item, "link");
        const pubDate = extractXmlTag(item, "pubDate");
        const source = extractXmlTag(item, "source");

        if (!title || seen.has(title)) continue;
        seen.add(title);

        allArticles.push({
          title,
          link,
          pubDate,
          source,
          section,
        });
      }
    } catch (error) {
      console.warn(
        `[Google News] ⚠️ ${section} fetch failed: ${error.message}`,
      );
    }
  }

  return allArticles
    .slice(0, GOOGLE_NEWS_ARTICLE_LIMIT)
    .map((article, index) => ({
      name: article.title,
      normalizedName: normalizeName(article.title),
      source: SOURCES.GOOGLE_NEWS,
      volume: GOOGLE_NEWS_ARTICLE_LIMIT - index,
      url: article.link,
      context: {
        rank: index + 1,
        section: article.section,
        publisher: article.source || null,
        publishedAt: article.pubDate
          ? new Date(article.pubDate).toISOString()
          : null,
      },
      category: categorizeArticle(article.section),
      timestamp: new Date().toISOString(),
    }));
}
