import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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
      inQuotes = !inQuotes;
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

const REQUIREMENTS_DB = [];
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  const datasetPath = join(
    __dirname,
    "..",
    "..",
    "..",
    "digest",
    "database",
    "data",
    "digest_nutrient_requirement.csv"
  );
  
  try {
    const raw = readFileSync(datasetPath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const headers = parseCSVLine(lines[0]);

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < headers.length) continue;

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || "";
      });
      
      row.value_numeric = parseFloat(row.value_numeric);
      REQUIREMENTS_DB.push(row);
    }
    console.log(`📊 Nutrition Requirement DB loaded: ${REQUIREMENTS_DB.length} rules.`);
  } catch (err) {
    console.error("Failed to load digest_nutrient_requirement.csv", err);
  }
}

// ─── Target Profile Engine ─────────────────────────────────────

/**
 * Dynamically compile the nutritional requirement checklist for an agent context.
 *
 * @param {object} params
 * @param {string} params.species - enum: human, canine, feline
 * @param {string} params.lifeStage - enum: adult_male, adult_female, adult_maintenance, puppy
 * @param {string} params.authority - enum: US_DRI, AAFCO, EFSA, NRC
 * @param {number} params.weightKg - User/Pet body weight in kg (critical for amino acid scales)
 * @param {number} [params.caloricIntake] - Daily kcal intake (used to stretch per-1000kcal boundaries)
 * @param {boolean} [params.includeCompositional] - If true, include NO_DRI compositional nutrients
 * @returns {object} Compiled requirements map
 */
export function calculateTargetProfile({
  species,
  lifeStage,
  authority,
  weightKg,
  caloricIntake,
  includeCompositional = false,
}) {
  ensureLoaded();

  const speciesLower = (species || "human").toLowerCase();
  const lifeStageLower = (lifeStage || "adult_male").toLowerCase();
  const targetAuth = (authority || (speciesLower === "human" ? "US_DRI" : "AAFCO")).toUpperCase();

  const baseRules = REQUIREMENTS_DB.filter(
    (r) =>
      r.species.toLowerCase() === speciesLower &&
      r.demographic_life_stage.toLowerCase() === lifeStageLower &&
      r.authority.toUpperCase() === targetAuth,
  );

  const requirements = {};
  const compositional = [];
  const kcalMult = caloricIntake ? caloricIntake / 1000.0 : 1;

  for (const rule of baseRules) {
    // Skip NO_DRI compositional nutrients unless explicitly requested
    if (rule.metric === "NO_DRI") {
      compositional.push(rule.nutrient_id);
      if (!includeCompositional) continue;
    }

    if (!requirements[rule.nutrient_id]) {
      requirements[rule.nutrient_id] = {};
    }

    const nutrientNode = requirements[rule.nutrient_id];
    let calculatedValue = rule.value_numeric;
    let finalUnit = rule.unit;

    // Execute context-aware math scaling based on human weight or pet calories
    if (rule.metric === "RDA_multiplier_per_kg" && weightKg) {
      calculatedValue = rule.value_numeric * weightKg;
    } else if (rule.metric.includes("per_1000kcal") && caloricIntake) {
      calculatedValue = rule.value_numeric * kcalMult;
      finalUnit = finalUnit.replace("_per_1000kcal", "");
    }

    nutrientNode[rule.metric] = {
      value: Number(calculatedValue.toFixed(4)),
      unit: finalUnit,
    };
  }

  return {
    _context: {
      species: speciesLower,
      lifeStage: lifeStageLower,
      authority: targetAuth,
      weightKg,
      caloricIntake,
    },
    _summary: {
      actionableNutrients: Object.keys(requirements).length,
      compositionalNutrients: compositional.length,
      totalRulesMatched: baseRules.length,
    },
    requirements,
  };
}
