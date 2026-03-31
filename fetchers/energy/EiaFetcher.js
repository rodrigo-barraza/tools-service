import CONFIG from "../../config.js";
import { EIA_BASE_URL, EIA_DEFAULT_SERIES } from "../../constants.js";
import rateLimiter from "../../services/RateLimiterService.js";

/**
 * EIA (U.S. Energy Information Administration) APIv2 Fetcher.
 * https://www.eia.gov/opendata/documentation.php
 *
 * Provides authoritative U.S. energy data: petroleum prices, electricity
 * generation, natural gas storage, coal production, renewable capacity,
 * nuclear outages, and more.
 *
 * Requires: Free API key — register at https://www.eia.gov/opendata/
 * Rate limits: Undocumented per-second limit; keys auto-suspended if exceeded.
 *              Using conservative 500ms pacing between requests.
 * Max rows: 5,000 per request (use offset for pagination).
 */

// ─── In-Memory Cache ───────────────────────────────────────────────

const dataCache = new Map();
const DATA_CACHE_TTL_MS = 3_600_000; // 1 hour — energy data updates infrequently

const metaCache = new Map();
const META_CACHE_TTL_MS = 86_400_000; // 24 hours — routes/metadata rarely change

// ─── Helpers ───────────────────────────────────────────────────────

function buildUrl(route, params = {}) {
  const url = new URL(`${EIA_BASE_URL}/${route}`);
  url.searchParams.set("api_key", CONFIG.EIA_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(`${key}[]`, String(v)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function eiaFetch(route, params = {}) {
  if (!CONFIG.EIA_API_KEY) {
    throw new Error("EIA_API_KEY is not configured");
  }

  await rateLimiter.wait("EIA");

  const url = buildUrl(route, params);
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`EIA API → ${res.status} ${res.statusText}: ${body}`);
  }

  const json = await res.json();

  // EIA returns errors inside the response body
  if (json.error) {
    throw new Error(`EIA API error: ${json.error}`);
  }

  return json;
}

// ─── Route Discovery / Metadata ────────────────────────────────────

/**
 * Browse the EIA data tree at a given route path.
 * Returns child routes, available facets, frequencies, and data columns.
 *
 * @param {string} [route=""] - Route path (e.g. "electricity", "petroleum/pri")
 * @returns {Promise<object>}
 */
export async function browseRoute(route = "") {
  const cacheKey = `meta:${route}`;
  const cached = metaCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < META_CACHE_TTL_MS) {
    return cached.data;
  }

  const path = route ? `v2/${route}` : "v2";
  const json = await eiaFetch(path);
  const resp = json.response || json;

  const result = {
    id: resp.id,
    name: resp.name,
    description: resp.description || null,
    routes: (resp.routes || []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || null,
    })),
    frequency: resp.frequency || [],
    facets: resp.facets || [],
    data: resp.data || null, // available data columns
    startPeriod: resp.startPeriod || null,
    endPeriod: resp.endPeriod || null,
  };

  metaCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

/**
 * Get available facet values for a route + facet.
 *
 * @param {string} route - e.g. "electricity/retail-sales"
 * @param {string} facetId - e.g. "stateid", "sectorid"
 * @returns {Promise<object>}
 */
export async function getFacetValues(route, facetId) {
  const cacheKey = `facet:${route}:${facetId}`;
  const cached = metaCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < META_CACHE_TTL_MS) {
    return cached.data;
  }

  const json = await eiaFetch(`v2/${route}/facet/${facetId}`);
  const resp = json.response || json;

  const result = {
    route,
    facetId,
    totalFacets: resp.totalFacets || 0,
    facets: (resp.facets || []).map((f) => ({
      id: f.id,
      name: f.name,
      alias: f.alias || null,
    })),
  };

  metaCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

// ─── Data Retrieval ────────────────────────────────────────────────

/**
 * Fetch data from the EIA API for a given route.
 *
 * @param {string} route - e.g. "electricity/retail-sales"
 * @param {object} [options]
 * @param {string[]} [options.data] - Data columns to retrieve (e.g. ["price", "revenue"])
 * @param {object} [options.facets] - Facet filters (e.g. { stateid: ["CO"], sectorid: ["RES"] })
 * @param {string} [options.frequency] - "monthly", "quarterly", "annual"
 * @param {string} [options.start] - Start period (e.g. "2020-01", "2020")
 * @param {string} [options.end] - End period
 * @param {string} [options.sort] - Sort column and direction (e.g. "period:desc")
 * @param {number} [options.length=100] - Max rows (max 5000)
 * @param {number} [options.offset=0] - Pagination offset
 * @returns {Promise<object>}
 */
export async function getData(route, options = {}) {
  const {
    data: dataColumns,
    facets,
    frequency,
    start,
    end,
    sort,
    length = 100,
    offset = 0,
  } = options;

  // Build cache key from all parameters
  const cacheKey = `data:${route}:${JSON.stringify(options)}`;
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < DATA_CACHE_TTL_MS) {
    return cached.data;
  }

  // Build query params
  const params = {
    length: Math.min(length, 5000),
    offset,
  };

  if (frequency) params.frequency = frequency;
  if (start) params.start = start;
  if (end) params.end = end;
  if (sort) {
    const [col, dir] = sort.split(":");
    params["sort[0][column]"] = col;
    params["sort[0][direction]"] = dir || "desc";
  }

  // Build the URL manually for array params (data[] and facets[][])
  let url = buildUrl(`v2/${route}/data`, params);

  // Append data columns
  if (dataColumns?.length) {
    const dataParams = dataColumns
      .map((d) => `data[]=${encodeURIComponent(d)}`)
      .join("&");
    url += `&${dataParams}`;
  }

  // Append facets
  if (facets) {
    for (const [facetId, values] of Object.entries(facets)) {
      const facetParams = (Array.isArray(values) ? values : [values])
        .map(
          (v) =>
            `facets[${encodeURIComponent(facetId)}][]=${encodeURIComponent(v)}`,
        )
        .join("&");
      url += `&${facetParams}`;
    }
  }

  // Direct fetch since we've manually built the URL
  await rateLimiter.wait("EIA");
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`EIA API → ${res.status} ${res.statusText}: ${body}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(`EIA API error: ${json.error}`);

  const resp = json.response || json;

  const result = {
    route,
    total: parseInt(resp.total, 10) || 0,
    dateFormat: resp.dateFormat || null,
    frequency: resp.frequency || null,
    count: (resp.data || []).length,
    data: resp.data || [],
    warning: resp.warning || null,
    fetchedAt: new Date().toISOString(),
  };

  dataCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

// ─── Curated Energy Snapshots ──────────────────────────────────────

/**
 * Get the latest values for a curated set of key energy indicators.
 * Fetches the most recent data point for each series in EIA_DEFAULT_SERIES.
 *
 * @returns {Promise<object>}
 */
export async function getEnergyIndicators() {
  const cacheKey = "energy-indicators";
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < DATA_CACHE_TTL_MS) {
    return cached.data;
  }

  const entries = Object.entries(EIA_DEFAULT_SERIES);
  const results = await Promise.allSettled(
    entries.map(async ([key, meta]) => {
      const seriesData = await getData(meta.route, {
        data: [meta.dataColumn],
        facets: meta.facets || undefined,
        frequency: meta.frequency || undefined,
        length: 1,
        sort: "period:desc",
      });

      const latest = seriesData.data?.[0];

      return {
        id: key,
        name: meta.name,
        category: meta.category,
        value: latest ? latest[meta.dataColumn] : null,
        period: latest?.period || null,
        unit: meta.unit,
        description: meta.description || null,
      };
    }),
  );

  const indicators = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r, i) => ({ series: entries[i][0], error: r.reason.message }));

  if (failed.length > 0) {
    console.warn(
      `[EiaFetcher] ⚠️ ${failed.length} indicator(s) failed:`,
      failed.map((f) => f.series).join(", "),
    );
  }

  const result = {
    count: indicators.length,
    indicators,
    fetchedAt: new Date().toISOString(),
  };

  dataCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}
