// ============================================================
// Package Fetcher — Unified NPM / PyPI Lookup
// ============================================================
// Consolidates NPM and PyPI package lookups into a single tool.
// The agent specifies the registry explicitly.
// ============================================================

import { getNpmPackage } from "./NpmFetcher.js";
import { getPyPiPackage } from "./PyPiFetcher.js";

// ─── Public API ───────────────────────────────────────────────────

/**
 * Look up a package on NPM or PyPI.
 *
 * @param {string} name - Package name
 * @param {string} registry - "npm" or "pypi"
 * @param {object} [options]
 * @param {string} [options.readme] - "true"/"false" — include README (NPM only, default: true)
 * @returns {Promise<object>} Package metadata with "registry" field
 */
export async function getPackageInfo(name, registry, options = {}) {
  if (!name || typeof name !== "string") {
    return { error: "Package name is required" };
  }

  const reg = (registry || "npm").toLowerCase().trim();

  let result;

  switch (reg) {
    case "npm":
      result = await getNpmPackage(name, {
        includeReadme: options.readme !== "false",
      });
      break;

    case "pypi":
    case "pip":
    case "python":
      result = await getPyPiPackage(name);
      break;

    default:
      return { error: `Unknown registry: "${registry}". Supported: "npm", "pypi".` };
  }

  // Tag the result with the registry
  if (result && !result.error) {
    result.registry = reg === "pip" || reg === "python" ? "pypi" : reg;
  }

  return result;
}
