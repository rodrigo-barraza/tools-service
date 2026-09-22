// ─── Unified NPM / PyPI Lookup ──────────────────────────────

import { getNpmPackage } from "./NpmFetcher.ts";
import { getPyPiPackage } from "./PyPiFetcher.ts";

// ─── Public API ───────────────────────────────────────────────────

/**
 * Look up a package on NPM or PyPI.
 */
export async function getPackageInfo(
  name: string,
  registry?: string,
  options: Record<string, unknown> = {},
) {
  if (!name || typeof name !== "string") {
    return { error: "Package name is required" };
  }

  const reg = (registry || "npm").toLowerCase().trim();

  let result:
    | (Record<string, unknown> & { error?: string; registry?: string })
    | null;

  switch (reg) {
    case "npm":
      result = await getNpmPackage(name, {
        includeReadme: options.readme !== "false",
      });
      break;

    case "pypi":
    case "pip":
    case "python":
      result = (await getPyPiPackage(name)) as Record<string, unknown> & {
        error?: string;
      };
      break;

    default:
      return {
        error: `Unknown registry: "${registry}". Supported: "npm", "pypi".`,
      };
  }

  // Tag the result with the registry
  if (result && !result.error) {
    result.registry = reg === "pip" || reg === "python" ? "pypi" : reg;
  }

  return result;
}
