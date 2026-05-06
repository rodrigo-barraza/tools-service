import { stripHtml } from "@rodrigo-barraza/utilities-library";

const AVCAN_PRODUCTS_URL = "https://api.avalanche.ca/forecasts/en/products";
/**
 * Fetch avalanche forecasts from Avalanche Canada.
 * Free, no key required. Fetches all current product metadata
 * and filters for the Sea-to-Sky / South Coast regions.
 */
export async function fetchAvalancheForecast() {
  const res = await fetch(AVCAN_PRODUCTS_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; Sun/Nimbus; github.com/rodrigo-barraza)",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Avalanche Canada API returned ${res.status}: ${res.statusText}`,
    );
  }
  const products = await res.json();
  if (!Array.isArray(products)) {
    throw new Error("Avalanche Canada returned unexpected data format");
  }
  // Filter for BC regions relevant to Vancouver area
  const bcKeywords = [
    "sea-to-sky",
    "south-coast",
    "north-shore",
    "whistler",
    "squamish",
    "howe sound",
  ];
  const forecasts = [];
  for (const product of products) {
    const title = (
      product.report?.title ||
      product.area?.name ||
      product.id ||
      ""
    ).toLowerCase();
    const areaId = (product.area?.id || product.id || "").toLowerCase();
    const isRelevant = bcKeywords.some(
      (kw) => title.includes(kw) || areaId.includes(kw),
    );
    if (isRelevant) {
      const report = product.report || {};
      forecasts.push({
        id: product.id || product.slug,
        title: report.title || product.area?.name || areaId,
        dateIssued: report.dateIssued || null,
        validUntil: report.validUntil || null,
        highlights: report.highlights ? stripHtml(report.highlights) : null,
        confidence: report.confidence?.rating?.display || null,
        dangerRatings: (report.dangerRatings || []).map((dr) => ({
          date: dr.date?.display || null,
          alpine: dr.ratings?.alp?.rating?.display || null,
          treeline: dr.ratings?.tln?.rating?.display || null,
          belowTreeline: dr.ratings?.btl?.rating?.display || null,
        })),
        problems: (report.problems || []).map((p) => ({
          type: p.type?.display || null,
          comment: p.comment ? stripHtml(p.comment) : null,
        })),
        url:
          product.url ||
          `https://avalanche.ca/forecasts/${product.id || areaId}`,
      });
    }
  }
  // If no matching regions, return a summary of all available
  if (forecasts.length === 0 && products.length > 0) {
    for (const product of products.slice(0, 5)) {
      const report = product.report || {};
      forecasts.push({
        id: product.id || product.slug,
        title: report.title || product.area?.name || "Unknown Region",
        dateIssued: report.dateIssued || null,
        validUntil: report.validUntil || null,
        highlights: report.highlights ? stripHtml(report.highlights) : null,
        confidence: report.confidence?.rating?.display || null,
        dangerRatings: (report.dangerRatings || []).map((dr) => ({
          date: dr.date?.display || null,
          alpine: dr.ratings?.alp?.rating?.display || null,
          treeline: dr.ratings?.tln?.rating?.display || null,
          belowTreeline: dr.ratings?.btl?.rating?.display || null,
        })),
        problems: (report.problems || []).map((p) => ({
          type: p.type?.display || null,
          comment: p.comment ? stripHtml(p.comment) : null,
        })),
        url:
          product.url || `https://avalanche.ca/forecasts/${product.id || ""}`,
      });
    }
  }
  return forecasts;
}
