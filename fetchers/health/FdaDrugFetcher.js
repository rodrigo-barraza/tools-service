import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * FDA Drug Fetcher — Static In-Memory FDA NDC Drug Database
 *
 * Loads ~26,000 FDA-registered drug products (NDC directory) into memory.
 * Provides search, NDC lookup, dosage form browsing, ingredient search,
 * and pharmacological class filtering.
 *
 * Source: FDA openFDA Drug NDC API (Public Domain)
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

const DRUG_DB = [];
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  const csvPath = join(__dirname, "data", "digest_fda_drugs.csv");
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const headers = parseCSVLine(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 3) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || null;
    });

    DRUG_DB.push(row);
  }

  console.log(`💊 FDA drug database loaded: ${DRUG_DB.length} products`);
}

// ─── Helpers ───────────────────────────────────────────────────

function normalizeSearch(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

function formatDrug(d) {
  return {
    productNdc: d.product_ndc,
    genericName: d.generic_name,
    brandName: d.brand_name,
    labelerName: d.labeler_name,
    dosageForm: d.dosage_form,
    route: d.route,
    productType: d.product_type,
    marketingCategory: d.marketing_category,
    activeIngredients: d.active_ingredients,
    pharmClass: d.pharm_class,
  };
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Search drugs by name, ingredient, or manufacturer.
 */
export function searchDrugs(query, opts = {}) {
  ensureLoaded();

  const { limit = 10, dosageForm, productType } = opts;
  const q = normalizeSearch(query);

  if (!q) return { count: 0, query, drugs: [] };

  let candidates = DRUG_DB;
  if (dosageForm) {
    const df = dosageForm.toUpperCase();
    candidates = candidates.filter(
      (d) => d.dosage_form && d.dosage_form.toUpperCase().includes(df),
    );
  }
  if (productType) {
    const pt = productType.toUpperCase();
    candidates = candidates.filter(
      (d) => d.product_type && d.product_type.toUpperCase().includes(pt),
    );
  }

  const scored = candidates
    .map((d) => {
      let score = 0;
      const generic = normalizeSearch(d.generic_name || "");
      const brand = normalizeSearch(d.brand_name || "");
      const ingredients = normalizeSearch(d.active_ingredients || "");
      const labeler = normalizeSearch(d.labeler_name || "");

      if (brand === q) score += 100;
      else if (generic === q) score += 95;
      else if (brand.startsWith(q)) score += 70;
      else if (generic.startsWith(q)) score += 65;
      else if (brand.includes(q)) score += 40;
      else if (generic.includes(q)) score += 35;
      else if (ingredients.includes(q)) score += 25;
      else if (labeler.includes(q)) score += 15;

      return { d, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    count: scored.length,
    query,
    note: "Data from FDA openFDA NDC API (Public Domain). For informational use only — not medical advice.",
    drugs: scored.map((s) => formatDrug(s.d)),
  };
}

/**
 * Get drug by exact NDC code.
 */
export function getDrugByNdc(ndc) {
  ensureLoaded();

  const n = ndc.trim();
  const d = DRUG_DB.find(
    (d) => d.product_ndc && d.product_ndc === n,
  );

  if (!d) return null;
  return formatDrug(d);
}

/**
 * Get all unique dosage forms with counts.
 */
export function getDosageForms() {
  ensureLoaded();

  const forms = {};
  for (const d of DRUG_DB) {
    const f = d.dosage_form || "Unknown";
    forms[f] = (forms[f] || 0) + 1;
  }

  return {
    totalProducts: DRUG_DB.length,
    dosageForms: Object.entries(forms)
      .sort((a, b) => b[1] - a[1])
      .map(([form, count]) => ({ form, count })),
    note: "Data from FDA openFDA NDC API (Public Domain).",
  };
}

/**
 * Search drugs by active ingredient.
 */
export function searchByIngredient(ingredient, opts = {}) {
  ensureLoaded();

  const { limit = 20 } = opts;
  const q = normalizeSearch(ingredient);

  const matches = DRUG_DB.filter((d) => {
    const ingredients = normalizeSearch(d.active_ingredients || "");
    return ingredients.includes(q);
  }).slice(0, limit);

  return {
    count: matches.length,
    ingredient: ingredient,
    note: "Data from FDA openFDA NDC API (Public Domain). For informational use only.",
    drugs: matches.map(formatDrug),
  };
}

/**
 * Search drugs by pharmacological class.
 */
export function searchByPharmClass(pharmClass, opts = {}) {
  ensureLoaded();

  const { limit = 20 } = opts;
  const q = normalizeSearch(pharmClass);

  const matches = DRUG_DB.filter((d) => {
    const pc = normalizeSearch(d.pharm_class || "");
    return pc.includes(q);
  }).slice(0, limit);

  return {
    count: matches.length,
    pharmClass: pharmClass,
    note: "Data from FDA openFDA NDC API (Public Domain). For informational use only.",
    drugs: matches.map(formatDrug),
  };
}
