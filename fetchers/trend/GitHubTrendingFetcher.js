import { TREND_SOURCES as SOURCES, TREND_CATEGORIES } from "../../constants.js";
import { stripHtml, randomUserAgent } from "../../utilities.js";

const GITHUB_TRENDING_URL = "https://github.com/trending";

/**
 * Scrapes GitHub's trending page for today's top repositories.
 * No API key required — HTML scraping.
 * @returns {Promise<Array>} Normalized trend objects
 */
export async function fetchGitHubTrending() {
  const res = await fetch(`${GITHUB_TRENDING_URL}?since=daily`, {
    headers: {
      "User-Agent": randomUserAgent(),
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    throw new Error(
      `GitHub Trending returned ${res.status}: ${res.statusText}`,
    );
  }

  const html = await res.text();
  return parseGitHubTrending(html);
}

/**
 * Parses GitHub Trending HTML into normalized trend objects.
 * Extracts repo name, description, language, stars, forks.
 */
function parseGitHubTrending(html) {
  const trends = [];
  const articleRegex = /<article class="Box-row">([\s\S]*?)<\/article>/g;
  let match;

  while ((match = articleRegex.exec(html)) !== null) {
    const article = match[1];

    // Extract repo full name (owner/repo)
    const repoMatch = article.match(
      /href="\/([^"]+)"[^>]*class="[^"]*Link[^"]*"/,
    );
    let fullName;
    if (!repoMatch) {
      // Fallback: try another pattern
      const altMatch = article.match(/href="\/([\w-]+\/[\w.-]+)"/);
      if (!altMatch) continue;
      fullName = altMatch[1].trim();
    } else {
      fullName = repoMatch[1].trim();
    }

    // Extract description
    const descMatch = article.match(/<p class="[^"]*">([\s\S]*?)<\/p>/);
    const description = descMatch ? stripHtml(descMatch[1]) : null;

    // Extract programming language
    const langMatch = article.match(
      /itemprop="programmingLanguage"[^>]*>([^<]+)/,
    );
    const language = langMatch ? langMatch[1].trim() : null;

    // Extract today's stars
    const starsMatch = article.match(/(\d[\d,]*)\s*stars?\s*today/i);
    const todayStars = starsMatch
      ? parseInt(starsMatch[1].replace(/,/g, ""))
      : 0;

    // Extract total stars
    const totalStarsMatch = article.match(
      /href="\/[^"]*\/stargazers"[^>]*>\s*[\s\S]*?(\d[\d,]*)/,
    );
    const totalStars = totalStarsMatch
      ? parseInt(totalStarsMatch[1].replace(/,/g, ""))
      : 0;

    // Extract forks
    const forksMatch = article.match(
      /href="\/[^"]*\/forks"[^>]*>\s*[\s\S]*?(\d[\d,]*)/,
    );
    const forks = forksMatch ? parseInt(forksMatch[1].replace(/,/g, "")) : 0;

    trends.push({
      name: fullName,
      normalizedName: fullName
        .toLowerCase()
        .replace(/[^a-z0-9\s/]/g, "")
        .trim()
        .replace(/\s+/g, " "),
      source: SOURCES.GITHUB,
      volume: todayStars || totalStars,
      url: `https://github.com/${fullName}`,
      context: {
        description,
        language,
        totalStars,
        todayStars,
        forks,
      },
      category: TREND_CATEGORIES.TECHNOLOGY,
      timestamp: new Date().toISOString(),
    });
  }

  return trends;
}
