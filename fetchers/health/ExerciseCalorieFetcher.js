/**
 * Exercise Calorie Fetcher — MET-Based Energy Expenditure
 *
 * Estimates caloric burn for exercises using Metabolic Equivalent
 * of Task (MET) values from the Compendium of Physical Activities.
 *
 * Formula: Calories = MET × weightKg × durationHours
 *
 * References:
 *   - Ainsworth BE et al. (2011) Compendium of Physical Activities
 *   - ACSM Guidelines for Exercise Testing and Prescription (11th Ed.)
 */

// ─── MET Value Lookup Table ────────────────────────────────────
// Maps exercise categories/types to MET values at different intensities.
// Source: Compendium of Physical Activities (Ainsworth et al. 2011)

const MET_TABLE = {
  // ── Strength Training ────────────────────────────────────────
  strength: {
    low: 3.5,
    moderate: 5.0,
    high: 6.0,
    default: 5.0,
    label: "Resistance/Weight training",
  },
  powerlifting: {
    low: 5.0,
    moderate: 6.0,
    high: 8.0,
    default: 6.0,
    label: "Powerlifting/Heavy lifting",
  },
  olympic_weightlifting: {
    low: 5.0,
    moderate: 6.5,
    high: 8.0,
    default: 6.5,
    label: "Olympic weightlifting",
  },

  // ── Cardio ───────────────────────────────────────────────────
  running: {
    low: 7.0,    // ~5 mph / 8 km/h
    moderate: 9.8, // ~6.5 mph / 10.5 km/h
    high: 12.8,   // ~8 mph / 13 km/h
    default: 9.8,
    label: "Running",
  },
  cycling: {
    low: 4.0,     // ~10 mph / 16 km/h
    moderate: 6.8, // ~12-14 mph / 19-22 km/h
    high: 10.0,    // ~16+ mph / 26+ km/h
    default: 6.8,
    label: "Cycling",
  },
  swimming: {
    low: 4.5,
    moderate: 7.0,
    high: 10.0,
    default: 7.0,
    label: "Swimming",
  },
  rowing: {
    low: 4.8,
    moderate: 7.0,
    high: 12.0,
    default: 7.0,
    label: "Rowing",
  },
  jump_rope: {
    low: 8.8,
    moderate: 11.8,
    high: 12.3,
    default: 11.8,
    label: "Jump rope",
  },
  elliptical: {
    low: 4.6,
    moderate: 6.3,
    high: 8.0,
    default: 6.3,
    label: "Elliptical trainer",
  },
  stair_climbing: {
    low: 4.0,
    moderate: 8.8,
    high: 12.0,
    default: 8.8,
    label: "Stair climbing",
  },
  walking: {
    low: 2.5,     // ~2.5 mph
    moderate: 3.5, // ~3.5 mph
    high: 5.0,     // ~4.5 mph / brisk
    default: 3.5,
    label: "Walking",
  },

  // ── Stretching / Flexibility ─────────────────────────────────
  stretching: {
    low: 2.3,
    moderate: 2.5,
    high: 3.0,
    default: 2.5,
    label: "Stretching / Flexibility",
  },
  yoga: {
    low: 2.5,
    moderate: 3.0,
    high: 4.0,
    default: 3.0,
    label: "Yoga",
  },
  pilates: {
    low: 3.0,
    moderate: 4.0,
    high: 5.0,
    default: 4.0,
    label: "Pilates",
  },

  // ── Plyometrics / HIIT ───────────────────────────────────────
  plyometrics: {
    low: 6.0,
    moderate: 8.0,
    high: 10.0,
    default: 8.0,
    label: "Plyometrics",
  },
  hiit: {
    low: 8.0,
    moderate: 10.0,
    high: 14.0,
    default: 10.0,
    label: "High-Intensity Interval Training",
  },
  crossfit: {
    low: 8.0,
    moderate: 10.0,
    high: 12.0,
    default: 10.0,
    label: "CrossFit",
  },

  // ── Bodyweight ───────────────────────────────────────────────
  calisthenics: {
    low: 3.5,
    moderate: 5.0,
    high: 8.0,
    default: 5.0,
    label: "Calisthenics / Bodyweight",
  },
  push_ups: {
    low: 3.8,
    moderate: 5.0,
    high: 8.0,
    default: 5.0,
    label: "Push-ups",
  },
  pull_ups: {
    low: 4.0,
    moderate: 6.0,
    high: 8.0,
    default: 6.0,
    label: "Pull-ups",
  },

  // ── Sports ───────────────────────────────────────────────────
  basketball: {
    low: 4.5,
    moderate: 6.5,
    high: 8.0,
    default: 6.5,
    label: "Basketball",
  },
  soccer: {
    low: 5.0,
    moderate: 7.0,
    high: 10.0,
    default: 7.0,
    label: "Soccer/Football",
  },
  tennis: {
    low: 5.0,
    moderate: 7.3,
    high: 8.0,
    default: 7.3,
    label: "Tennis",
  },
  boxing: {
    low: 5.5,
    moderate: 7.8,
    high: 12.8,
    default: 7.8,
    label: "Boxing / Martial arts",
  },
  martial_arts: {
    low: 5.5,
    moderate: 7.8,
    high: 10.3,
    default: 7.8,
    label: "Martial arts",
  },
  rock_climbing: {
    low: 5.0,
    moderate: 8.0,
    high: 11.0,
    default: 8.0,
    label: "Rock climbing",
  },

  // ── Fallback ─────────────────────────────────────────────────
  general: {
    low: 3.0,
    moderate: 5.0,
    high: 7.0,
    default: 5.0,
    label: "General exercise",
  },
};

// ─── Exercise Category → MET Key Mapping ───────────────────────
// Maps exercise DB categories to MET table keys

const CATEGORY_TO_MET = {
  strength: "strength",
  stretching: "stretching",
  plyometrics: "plyometrics",
  strongman: "powerlifting",
  powerlifting: "powerlifting",
  "olympic weightlifting": "olympic_weightlifting",
  cardio: "running",
  "body only": "calisthenics",
};

// ─── Exercise Name Pattern → MET Key ──────────────────────────

const NAME_PATTERNS = [
  { pattern: /squat|deadlift|bench\s*press|overhead\s*press/i, key: "strength" },
  { pattern: /curl|tricep|bicep|extension|fly|raise|row/i, key: "strength" },
  { pattern: /run|sprint|jog/i, key: "running" },
  { pattern: /swim/i, key: "swimming" },
  { pattern: /cycl|bike|spin/i, key: "cycling" },
  { pattern: /row|erg/i, key: "rowing" },
  { pattern: /jump\s*rope|skip/i, key: "jump_rope" },
  { pattern: /elliptical/i, key: "elliptical" },
  { pattern: /stair/i, key: "stair_climbing" },
  { pattern: /walk|hike/i, key: "walking" },
  { pattern: /yoga/i, key: "yoga" },
  { pattern: /pilates/i, key: "pilates" },
  { pattern: /stretch|foam\s*roll/i, key: "stretching" },
  { pattern: /push\s*up|pushup/i, key: "push_ups" },
  { pattern: /pull\s*up|pullup|chin\s*up/i, key: "pull_ups" },
  { pattern: /burpee|box\s*jump|plyo/i, key: "plyometrics" },
  { pattern: /hiit|tabata|circuit/i, key: "hiit" },
  { pattern: /crossfit|wod/i, key: "crossfit" },
  { pattern: /basketball/i, key: "basketball" },
  { pattern: /soccer|football/i, key: "soccer" },
  { pattern: /tennis|racquet/i, key: "tennis" },
  { pattern: /box|punch|kick|martial|karate|judo|bjj|muay/i, key: "boxing" },
  { pattern: /climb|boulder/i, key: "rock_climbing" },
  { pattern: /clean|snatch|jerk/i, key: "olympic_weightlifting" },
];

// ─── MET Resolution ───────────────────────────────────────────

function resolveMET(exerciseName, category, intensity) {
  const intensityKey = (intensity || "moderate").toLowerCase();

  // Try name pattern matching first (most specific)
  for (const { pattern, key } of NAME_PATTERNS) {
    if (pattern.test(exerciseName)) {
      const met = MET_TABLE[key];
      return {
        value: met[intensityKey] || met.default,
        source: key,
        label: met.label,
      };
    }
  }

  // Try category mapping
  if (category) {
    const catKey = CATEGORY_TO_MET[category.toLowerCase()];
    if (catKey && MET_TABLE[catKey]) {
      const met = MET_TABLE[catKey];
      return {
        value: met[intensityKey] || met.default,
        source: catKey,
        label: met.label,
      };
    }
  }

  // Fallback to general
  const general = MET_TABLE.general;
  return {
    value: general[intensityKey] || general.default,
    source: "general",
    label: general.label,
  };
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Estimate calories burned during an exercise session.
 *
 * @param {object} params
 * @param {string} params.exercise - Exercise name or ID
 * @param {number} params.durationMinutes - Duration in minutes
 * @param {number} params.weightKg - Body weight in kg
 * @param {string} [params.intensity="moderate"] - low, moderate, high
 * @param {string} [params.category] - Exercise category (e.g. "strength", "cardio")
 * @returns {object} Caloric expenditure estimate
 */
export function estimateExerciseCalories({
  exercise,
  durationMinutes,
  weightKg,
  intensity = "moderate",
  category,
}) {
  // ── Validate ─────────────────────────────────────────────────
  const errors = [];
  if (!exercise) errors.push("'exercise' is required");
  if (!durationMinutes || durationMinutes <= 0) errors.push("'durationMinutes' must be positive");
  if (!weightKg || weightKg <= 0) errors.push("'weightKg' must be positive");
  if (errors.length) return { error: errors.join("; ") };

  const normalizedIntensity = (intensity || "moderate").toLowerCase();
  if (!["low", "moderate", "high"].includes(normalizedIntensity)) {
    return {
      error: `Invalid intensity: "${intensity}"`,
      validIntensities: ["low", "moderate", "high"],
    };
  }

  // ── Resolve MET ──────────────────────────────────────────────
  const met = resolveMET(exercise, category, normalizedIntensity);
  const durationHours = durationMinutes / 60;

  // ── Core calculation ─────────────────────────────────────────
  // Calories = MET × weight(kg) × duration(hours)
  const caloriesBurned = met.value * weightKg * durationHours;

  // ── Recovery recommendations ─────────────────────────────────
  // Post-exercise protein: 0.25-0.3g per kg BW (ISSN position stand)
  const recoveryProtein = weightKg * 0.3;
  // Post-exercise carbs: ~1.0-1.2g per kg within 30min for glycogen replenishment
  const recoveryCarbs = met.value >= 6 ? weightKg * 1.0 : weightKg * 0.5;
  // Water: ~500-700mL per hour of exercise (ACSM)
  const waterNeeded = durationHours * 600;

  // ── EPOC estimate (Excess Post-Exercise Oxygen Consumption) ──
  // High-intensity exercise can elevate metabolism 6-15% post-exercise
  let epocEstimate = 0;
  if (normalizedIntensity === "high") {
    epocEstimate = caloriesBurned * 0.15;
  } else if (normalizedIntensity === "moderate") {
    epocEstimate = caloriesBurned * 0.06;
  }

  return {
    exercise,
    category: category || met.source,
    metValue: met.value,
    metSource: met.label,
    intensity: normalizedIntensity,
    input: {
      durationMinutes,
      weightKg,
    },
    caloriesBurned: Math.round(caloriesBurned),
    epocEstimate: Math.round(epocEstimate),
    totalWithEpoc: Math.round(caloriesBurned + epocEstimate),
    recovery: {
      protein_g: Math.round(recoveryProtein),
      carbs_g: Math.round(recoveryCarbs),
      water_mL: Math.round(waterNeeded),
      _note: "Post-exercise recovery: protein within 30-60min, carbs within 30min for glycogen. Water during and after.",
    },
    _note: "Calories = MET × bodyweight(kg) × hours. EPOC = post-exercise metabolic elevation. Source: Ainsworth et al. (2011) Compendium of Physical Activities.",
  };
}

/**
 * List all available MET categories.
 */
export function getMetCategories() {
  return {
    categories: Object.entries(MET_TABLE).map(([key, data]) => ({
      key,
      label: data.label,
      metLow: data.low,
      metModerate: data.moderate,
      metHigh: data.high,
    })),
    intensities: ["low", "moderate", "high"],
  };
}
