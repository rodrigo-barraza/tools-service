import { stripHtml } from "@rodrigo-barraza/utilities-library";
/**
 * Fetch weather warnings from Environment Canada for Metro Vancouver.
 * Scrapes the public warnings page since RSS/Atom feeds and GeoMet API
 * are currently unreliable (404/500).
 * Free, no key required.
 */

const EC_WARNINGS_PAGE = "https://weather.gc.ca/warnings/report_e.html?bc74";
// Backup: the city forecast page which includes warning banners
const EC_CITY_PAGE = "https://weather.gc.ca/city/pages/bc-74_metric_e.html";
export async function fetchEnvironmentCanadaWarnings() {
  // Try the main warnings page first
  let warnings = await tryWarningsPage();
  // Fallback to city page warning banners
  if (warnings.length === 0) {
    warnings = await tryCityPage();
  }
  return warnings;
}
async function tryWarningsPage() {
  try {
    const res = await fetch(EC_WARNINGS_PAGE, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseWarningsHtml(html);
  } catch {
    return [];
  }
}
async function tryCityPage() {
  try {
    const res = await fetch(EC_CITY_PAGE, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseCityWarnings(html);
  } catch {
    return [];
  }
}
/**
 * Parse warnings from the EC warnings report page.
 */
function parseWarningsHtml(html) {
  const warnings = [];
  // Look for warning/watch/statement sections
  const sectionRegex =
    /<h2[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = sectionRegex.exec(html)) !== null) {
    const title = stripHtml(match[1]);
    const content = stripHtml(match[2]);
    if (isWarningTitle(title)) {
      warnings.push({
        title,
        summary: content.substring(0, 500),
        type: classifyWarning(title),
        source: "weather.gc.ca",
        url: EC_WARNINGS_PAGE,
      });
    }
  }
  // Also look for alert banners
  const alertRegex =
    /class="[^"]*alert[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/gi;
  while ((match = alertRegex.exec(html)) !== null) {
    const content = stripHtml(match[1]);
    if (content.length > 10 && isWarningContent(content)) {
      const existing = warnings.find((w) => content.includes(w.title));
      if (!existing) {
        warnings.push({
          title: content.substring(0, 100),
          summary: content.substring(0, 500),
          type: classifyWarning(content),
          source: "weather.gc.ca",
          url: EC_WARNINGS_PAGE,
        });
      }
    }
  }
  return warnings;
}
/**
 * Parse warning banners from the EC city forecast page.
 */
function parseCityWarnings(html) {
  const warnings = [];
  const warningRegex =
    /class="[^"]*(?:warning|alert|watch|advisory)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|a)>/gi;
  let match;
  while ((match = warningRegex.exec(html)) !== null) {
    const content = stripHtml(match[1]);
    if (content.length > 5 && isWarningContent(content)) {
      warnings.push({
        title: content.substring(0, 100),
        summary: content.substring(0, 500),
        type: classifyWarning(content),
        source: "weather.gc.ca",
        url: EC_CITY_PAGE,
      });
    }
  }
  return warnings;
}
function classifyWarning(text) {
  const lower = text.toLowerCase();
  if (lower.includes("warning")) return "warning";
  if (lower.includes("watch")) return "watch";
  if (lower.includes("advisory")) return "advisory";
  if (lower.includes("statement")) return "statement";
  if (lower.includes("ended")) return "ended";
  return "info";
}
function isWarningTitle(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("warning") ||
    lower.includes("watch") ||
    lower.includes("advisory") ||
    lower.includes("statement") ||
    lower.includes("alert") ||
    lower.includes("special weather")
  );
}
function isWarningContent(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("warning") ||
    lower.includes("watch") ||
    lower.includes("advisory") ||
    lower.includes("alert") ||
    lower.includes("in effect") ||
    lower.includes("issued") ||
    lower.includes("special weather")
  );
}
