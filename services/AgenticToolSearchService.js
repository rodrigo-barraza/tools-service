// ============================================================
// Agentic Tool Search Service — Meta-Tool for Tool Discovery
// ============================================================
// Provides keyword/domain/label-based search across all
// registered tool schemas. Returns matching tool names and
// descriptions without executing anything.
//
// This enables deferred tool discovery — agents can start with
// a reduced tool set and discover additional capabilities
// on demand, reducing initial prompt token overhead.
// ============================================================

import { getToolSchemas } from "./ToolSchemaService.js";

/**
 * Search all registered tool schemas by keyword, domain, or label.
 *
 * @param {string} query - Search query (matched against name + description)
 * @param {object} [options]
 * @param {string} [options.domain] - Filter by domain (e.g. "Weather", "Agentic: File Operations")
 * @param {string} [options.label] - Filter by label category
 * @param {number} [options.limit=20] - Max results
 * @returns {{ matches: Array, total: number, query: string }}
 */
export function agenticToolSearch(query, { domain, label, limit = 20 } = {}) {
  const allSchemas = getToolSchemas();

  if (!allSchemas || allSchemas.length === 0) {
    return { error: "Tool schemas not loaded — tools-api may still be initializing" };
  }

  const queryLower = (query || "").toLowerCase().trim();

  let filtered = allSchemas;

  // Filter by domain (exact match, case-insensitive)
  if (domain) {
    const domainLower = domain.toLowerCase();
    filtered = filtered.filter(
      (t) => t.domain && t.domain.toLowerCase() === domainLower,
    );
  }

  // Filter by label category (exact match, case-insensitive)
  if (label) {
    const labelLower = label.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.labels &&
        Object.values(t.labels).some(
          (v) => typeof v === "string" && v.toLowerCase() === labelLower,
        ),
    );
  }

  // Keyword search on name + description
  let scored;
  if (queryLower) {
    scored = filtered.map((t) => {
      const nameLower = (t.name || "").toLowerCase();
      const descLower = (t.description || "").toLowerCase();

      let score = 0;
      // Exact name match → highest score
      if (nameLower === queryLower) score += 100;
      // Name contains query
      else if (nameLower.includes(queryLower)) score += 50;
      // Description contains query
      if (descLower.includes(queryLower)) score += 20;

      // Bonus: match individual words
      const queryWords = queryLower.split(/\s+/);
      for (const word of queryWords) {
        if (word.length < 2) continue;
        if (nameLower.includes(word)) score += 10;
        if (descLower.includes(word)) score += 5;
      }

      return { schema: t, score };
    }).filter((s) => s.score > 0);
  } else {
    // No keyword query — just domain/label filtering, return all matches
    scored = filtered.map((t) => ({ schema: t, score: 1 }));
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const capped = Math.min(Math.max(1, limit), 50);
  const matches = scored.slice(0, capped).map(({ schema }) => ({
    name: schema.name,
    description: schema.description,
    domain: schema.domain || null,
    labels: schema.labels || null,
    parameters: schema.parameters || null,
  }));

  return {
    matches,
    total: scored.length,
    query: query || null,
    domain: domain || null,
    label: label || null,
  };
}
