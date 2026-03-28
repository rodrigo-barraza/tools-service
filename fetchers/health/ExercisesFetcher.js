import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * Exercises Fetcher — Static In-Memory Database
 *
 * Loads gym exercises into memory.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const EXERCISE_DB = [];
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  const dataPath = join(__dirname, "data", "digest_exercises.csv");
  const rawData = readFileSync(dataPath, "utf-8");
  const lines = rawData.split("\n").filter((l) => l.trim());
  const headers = parseCSVLine(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => {
      const val = values[idx] || "";
      if (h === "primary_muscles" || h === "secondary_muscles") {
        row[h] = val ? val.split("|") : [];
      } else {
        row[h] = val;
      }
    });

    EXERCISE_DB.push(row);
  }

  console.log(`🏋️ Exercises DB loaded: ${EXERCISE_DB.length} exercises`);
}

function normalizeSearch(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

function normalizeQuery(str) {
  return str ? str.toLowerCase().trim() : "";
}

export function searchExercises(query, opts = {}) {
  ensureLoaded();

  const {
    limit = 10,
    category,
    equipment,
    force,
    level,
    mechanic,
    muscle,
  } = opts;

  let candidates = EXERCISE_DB;

  if (category) {
    const f = normalizeQuery(category);
    candidates = candidates.filter((c) => normalizeQuery(c.category) === f);
  }
  if (equipment) {
    const f = normalizeQuery(equipment);
    candidates = candidates.filter((c) => normalizeQuery(c.equipment) === f);
  }
  if (force) {
    const f = normalizeQuery(force);
    candidates = candidates.filter((c) => normalizeQuery(c.force) === f);
  }
  if (level) {
    const f = normalizeQuery(level);
    candidates = candidates.filter((c) => normalizeQuery(c.level) === f);
  }
  if (mechanic) {
    const f = normalizeQuery(mechanic);
    candidates = candidates.filter((c) => normalizeQuery(c.mechanic) === f);
  }
  if (muscle) {
    const f = normalizeQuery(muscle);
    candidates = candidates.filter(
      (c) =>
        c.primary_muscles.some((m) => normalizeQuery(m) === f) ||
        c.secondary_muscles.some((m) => normalizeQuery(m) === f)
    );
  }

  if (query) {
    const term = normalizeSearch(query);
    candidates = candidates.filter((c) => {
      const parts = term.split(/\s+/).filter(Boolean);
      const name = normalizeSearch(c.name);
      const id = normalizeSearch(c.id);
      return parts.every((p) => name.includes(p) || id.includes(p));
    });
  }

  return {
    count: candidates.length,
    returned: Math.min(candidates.length, limit),
    query: query || null,
    exercises: candidates.slice(0, limit),
  };
}

export function getExerciseById(id) {
  ensureLoaded();
  const normalized = normalizeQuery(id);
  const ex = EXERCISE_DB.find((c) => normalizeQuery(c.id) === normalized);
  return ex || null;
}

export function getExerciseCategories() {
  ensureLoaded();
  const categories = [...new Set(EXERCISE_DB.map((e) => e.category).filter(Boolean))];
  const equipment = [...new Set(EXERCISE_DB.map((e) => e.equipment).filter(Boolean))];
  const muscles = [
    ...new Set(EXERCISE_DB.flatMap((e) => [...e.primary_muscles, ...e.secondary_muscles]).filter(Boolean)),
  ];

  return {
    totalExercises: EXERCISE_DB.length,
    categories: categories.sort(),
    equipment: equipment.sort(),
    muscles: muscles.sort(),
  };
}
