import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * Exoplanet Fetcher — Static In-Memory NASA Exoplanet Archive Database
 *
 * Loads ~6,100 confirmed exoplanets from the NASA Exoplanet Archive into memory.
 * Provides search, name lookup, discovery method statistics, habitability
 * zone filtering, and ranking by mass/radius/temperature.
 *
 * Source: NASA Exoplanet Archive (Public Domain)
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── CSV Parser ────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── Load & Index ──────────────────────────────────────────────

const PLANET_DB = [];
let loaded = false;

const FIELD_META = {
  pl_orbper: { label: "Orbital Period", unit: "days" },
  pl_rade: { label: "Planet Radius", unit: "Earth radii" },
  pl_bmasse: { label: "Planet Mass", unit: "Earth masses" },
  pl_orbsmax: { label: "Semi-major Axis", unit: "AU" },
  pl_orbeccen: { label: "Orbital Eccentricity", unit: "" },
  pl_eqt: { label: "Equilibrium Temperature", unit: "K" },
  sy_vmag: { label: "V-band Magnitude", unit: "mag" },
  st_mass: { label: "Stellar Mass", unit: "Solar masses" },
  st_rad: { label: "Stellar Radius", unit: "Solar radii" },
  st_teff: { label: "Stellar Eff. Temperature", unit: "K" },
  sy_dist: { label: "Distance", unit: "parsecs" },
};

const NUMERIC_FIELDS = new Set([
  "disc_year",
  "pl_orbper",
  "pl_rade",
  "pl_bmasse",
  "pl_orbsmax",
  "pl_orbeccen",
  "pl_eqt",
  "sy_vmag",
  "st_mass",
  "st_rad",
  "st_teff",
  "sy_dist",
  "ra",
  "dec",
]);

function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  const csvPath = join(__dirname, "data", "digest_exoplanets.csv");
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const headers = parseCSVLine(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 5) continue;

    const row = {};
    headers.forEach((h, idx) => {
      const val = values[idx] || "";
      if (NUMERIC_FIELDS.has(h)) {
        const num = parseFloat(val);
        row[h] = isNaN(num) ? null : num;
      } else {
        row[h] = val || null;
      }
    });

    PLANET_DB.push(row);
  }

  console.log(`🪐 Exoplanet database loaded: ${PLANET_DB.length} planets`);
}

// ─── Helpers ───────────────────────────────────────────────────

function normalizeSearch(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, "");
}

function formatPlanet(p) {
  return {
    name: p.pl_name,
    hostStar: p.hostname,
    discoveryMethod: p.discoverymethod,
    discoveryYear: p.disc_year,
    discoveryFacility: p.disc_facility,
    orbitalPeriodDays: p.pl_orbper,
    radiusEarth: p.pl_rade,
    massEarth: p.pl_bmasse,
    semiMajorAxisAU: p.pl_orbsmax,
    eccentricity: p.pl_orbeccen,
    equilibriumTempK: p.pl_eqt,
    stellarMassSolar: p.st_mass,
    stellarRadiusSolar: p.st_rad,
    stellarTempK: p.st_teff,
    distanceParsecs: p.sy_dist,
  };
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Search exoplanets by name or host star.
 */
export function searchExoplanets(query, opts = {}) {
  ensureLoaded();

  const { limit = 10, method } = opts;
  const q = normalizeSearch(query);

  if (!q) return { count: 0, query, planets: [] };

  let candidates = PLANET_DB;
  if (method) {
    const m = method.toLowerCase();
    candidates = candidates.filter(
      (p) =>
        p.discoverymethod && p.discoverymethod.toLowerCase().includes(m),
    );
  }

  const scored = candidates
    .map((p) => {
      let score = 0;
      const name = normalizeSearch(p.pl_name || "");
      const host = normalizeSearch(p.hostname || "");

      if (name === q) score += 100;
      else if (host === q) score += 80;
      else if (name.startsWith(q)) score += 60;
      else if (host.startsWith(q)) score += 50;
      else if (name.includes(q)) score += 30;
      else if (host.includes(q)) score += 25;

      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    count: scored.length,
    query,
    note: "Data from NASA Exoplanet Archive (Public Domain).",
    planets: scored.map((s) => formatPlanet(s.p)),
  };
}

/**
 * Get exoplanet by exact name.
 */
export function getExoplanetByName(name) {
  ensureLoaded();

  const q = normalizeSearch(name);
  const p = PLANET_DB.find((p) => normalizeSearch(p.pl_name || "") === q);

  if (!p) return null;
  return formatPlanet(p);
}

/**
 * Rank exoplanets by a specific field.
 */
export function rankExoplanets(field, opts = {}) {
  ensureLoaded();

  const { limit = 10, order = "desc" } = opts;

  if (!FIELD_META[field]) {
    return {
      error: `Unknown field: "${field}"`,
      availableFields: Object.entries(FIELD_META).map(([key, meta]) => ({
        key,
        label: meta.label,
        unit: meta.unit,
      })),
    };
  }

  const meta = FIELD_META[field];

  const ranked = PLANET_DB.filter((p) => p[field] !== null)
    .sort((a, b) =>
      order === "asc" ? a[field] - b[field] : b[field] - a[field],
    )
    .slice(0, limit);

  return {
    field,
    label: meta.label,
    unit: meta.unit,
    order,
    count: ranked.length,
    note: "Data from NASA Exoplanet Archive (Public Domain).",
    planets: ranked.map((p) => ({
      name: p.pl_name,
      hostStar: p.hostname,
      value: p[field],
      discoveryYear: p.disc_year,
      method: p.discoverymethod,
    })),
  };
}

/**
 * Get discovery method statistics.
 */
export function getDiscoveryStats() {
  ensureLoaded();

  const methods = {};
  const yearRange = { min: Infinity, max: -Infinity };
  const facilities = {};

  for (const p of PLANET_DB) {
    const m = p.discoverymethod || "Unknown";
    methods[m] = (methods[m] || 0) + 1;

    if (p.disc_year) {
      yearRange.min = Math.min(yearRange.min, p.disc_year);
      yearRange.max = Math.max(yearRange.max, p.disc_year);
    }

    const f = p.disc_facility || "Unknown";
    facilities[f] = (facilities[f] || 0) + 1;
  }

  const sortedMethods = Object.entries(methods)
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => ({ method, count }));

  const topFacilities = Object.entries(facilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([facility, count]) => ({ facility, count }));

  return {
    totalPlanets: PLANET_DB.length,
    yearRange: {
      first: yearRange.min === Infinity ? null : yearRange.min,
      latest: yearRange.max === -Infinity ? null : yearRange.max,
    },
    discoveryMethods: sortedMethods,
    topFacilities,
    note: "Data from NASA Exoplanet Archive (Public Domain).",
  };
}

/**
 * Find potentially habitable exoplanets (conservative habitable zone).
 */
export function getHabitableZonePlanets(opts = {}) {
  ensureLoaded();

  const { limit = 20 } = opts;

  // Conservative habitable zone: equilibrium temp roughly 200-320K
  // OR semi-major axis in ~0.8-1.5 AU for sun-like stars
  const habitable = PLANET_DB.filter((p) => {
    if (p.pl_eqt !== null && p.pl_eqt >= 200 && p.pl_eqt <= 320) return true;
    if (
      p.pl_orbsmax !== null &&
      p.st_teff !== null &&
      p.pl_orbsmax >= 0.7 &&
      p.pl_orbsmax <= 1.8 &&
      p.st_teff >= 4000 &&
      p.st_teff <= 7000
    )
      return true;
    return false;
  })
    .sort((a, b) => {
      // Prefer planets with measured radii close to Earth
      const aR = a.pl_rade !== null ? Math.abs(a.pl_rade - 1) : 100;
      const bR = b.pl_rade !== null ? Math.abs(b.pl_rade - 1) : 100;
      return aR - bR;
    })
    .slice(0, limit);

  return {
    count: habitable.length,
    criteria: "Equilibrium temperature 200-320K OR semi-major axis ~0.7-1.8 AU around sun-like star (4000-7000K)",
    note: "Data from NASA Exoplanet Archive (Public Domain). This is a simplified heuristic, not a definitive habitability assessment.",
    planets: habitable.map(formatPlanet),
  };
}
