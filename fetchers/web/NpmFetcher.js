// ============================================================
// NPM Fetcher — Package Metadata + README
// ============================================================
// Uses the public NPM Registry API. No auth needed.
// Docs: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
// ============================================================

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week";
const MAX_README_CHARS = 15_000;

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch NPM package info including version, deps, and README.
 * @param {string} packageName - NPM package name (e.g. "express", "@types/node")
 * @param {object} [options]
 * @param {boolean} [options.includeReadme=true]
 * @returns {Promise<object>}
 */
export async function getNpmPackage(packageName, options = {}) {
  if (!packageName || typeof packageName !== "string") {
    return { error: "Package name is required" };
  }

  const { includeReadme = true } = options;
  const encoded = encodeURIComponent(packageName);

  // Fetch package metadata + download counts concurrently
  const [pkgRes, dlRes] = await Promise.all([
    fetch(`${NPM_REGISTRY}/${encoded}`, {
      headers: { Accept: "application/json" },
    }),
    fetch(`${NPM_DOWNLOADS}/${encoded}`).catch(() => null),
  ]);

  if (!pkgRes.ok) {
    if (pkgRes.status === 404) {
      return { error: `NPM package not found: "${packageName}"` };
    }
    return { error: `NPM Registry error: ${pkgRes.status}` };
  }

  const data = await pkgRes.json();
  const latest = data["dist-tags"]?.latest;
  const version = data.versions?.[latest] || {};

  const result = {
    name: data.name,
    version: latest,
    description: data.description || version.description || null,
    license: version.license || data.license || null,
    homepage: data.homepage || version.homepage || null,
    repository: typeof data.repository === "string"
      ? data.repository
      : data.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") || null,
    keywords: data.keywords || [],
    author: typeof version.author === "string"
      ? version.author
      : version.author?.name || null,
    maintainers: (data.maintainers || []).map((m) => m.name || m).slice(0, 10),
    dependencies: version.dependencies || {},
    devDependencies: version.devDependencies || {},
    peerDependencies: version.peerDependencies || {},
    engines: version.engines || null,
    types: version.types || version.typings || null,
    bin: version.bin ? Object.keys(version.bin) : null,
    distTags: data["dist-tags"] || {},
    createdAt: data.time?.created || null,
    lastPublished: data.time?.[latest] || null,
  };

  // Download stats
  if (dlRes?.ok) {
    const dlData = await dlRes.json();
    result.weeklyDownloads = dlData.downloads || null;
  }

  // Deprecated?
  if (version.deprecated) {
    result.deprecated = version.deprecated;
  }

  // README
  if (includeReadme && data.readme) {
    result.readme = data.readme.length > MAX_README_CHARS
      ? data.readme.slice(0, MAX_README_CHARS) + "\n\n... [truncated]"
      : data.readme;
    result.readmeTruncated = data.readme.length > MAX_README_CHARS;
  }

  return result;
}
