// ============================================================
// PyPI Fetcher — Python Package Metadata
// ============================================================
// Uses the public PyPI JSON API. No auth needed.
// Docs: https://warehouse.pypa.io/api-reference/json.html
// ============================================================

const PYPI_API = "https://pypi.org/pypi";

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch Python package info from PyPI.
 * @param {string} packageName - PyPI package name (e.g. "requests", "numpy")
 * @returns {Promise<object>}
 */
export async function getPyPiPackage(packageName) {
  if (!packageName || typeof packageName !== "string") {
    return { error: "Package name is required" };
  }

  const encoded = encodeURIComponent(packageName);
  const res = await fetch(`${PYPI_API}/${encoded}/json`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { error: `PyPI package not found: "${packageName}"` };
    }
    return { error: `PyPI API error: ${res.status}` };
  }

  const data = await res.json();
  const info = data.info || {};

  // Extract classifier categories
  const classifiers = (info.classifiers || []).reduce((acc, c) => {
    const parts = c.split(" :: ");
    const category = parts[0];
    if (!acc[category]) acc[category] = [];
    acc[category].push(parts.slice(1).join(" :: "));
    return acc;
  }, {});

  return {
    name: info.name,
    version: info.version,
    summary: info.summary || null,
    description: info.description
      ? info.description.slice(0, 15_000) + (info.description.length > 15_000 ? "\n\n... [truncated]" : "")
      : null,
    descriptionContentType: info.description_content_type || null,
    author: info.author || info.author_email || null,
    maintainer: info.maintainer || info.maintainer_email || null,
    license: info.license || null,
    homepage: info.home_page || info.project_url || null,
    projectUrls: info.project_urls || {},
    keywords: info.keywords ? info.keywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
    requiresPython: info.requires_python || null,
    requiresDist: info.requires_dist || [],
    packageUrl: info.package_url || null,
    releaseUrl: info.release_url || null,
    yanked: info.yanked || false,
    yankedReason: info.yanked_reason || null,
    classifiers: Object.keys(classifiers).length > 0 ? classifiers : null,
  };
}
