/**
 * Hydration Fetcher — Estimated Water Requirement Calculator
 *
 * Context-aware water intake calculator based on body weight,
 * activity level, climate, exercise, and special conditions.
 *
 * References:
 *   - ACSM Fluid Replacement Guidelines (2007)
 *   - IOM Dietary Reference Intakes for Water (2005)
 *   - Sawka MN et al., Exercise and Fluid Replacement (2007)
 */

// ─── Base Water Multipliers (mL per kg body weight) ────────────

const BASE_MULTIPLIERS = {
  sedentary: 30,   // ~30 mL/kg — WHO/EFSA baseline
  light: 33,       // light activity
  moderate: 35,    // moderate activity
  active: 40,      // vigorous activity
  very_active: 45, // athlete / labor-intensive
};

// ─── Climate Temperature Adjustments ───────────────────────────

function climateAdjustment(tempCelsius) {
  if (tempCelsius === null || tempCelsius === undefined) return 0;
  if (tempCelsius <= 10) return -200;   // Cold — less sweat loss
  if (tempCelsius <= 20) return 0;      // Temperate — baseline
  if (tempCelsius <= 30) return 300;    // Warm — moderate increase
  if (tempCelsius <= 35) return 500;    // Hot — significant increase
  return 750;                            // Extreme heat — maximum adjustment
}

// ─── Altitude Adjustment ───────────────────────────────────────
// Above 2500m, increased respiratory water loss + diuresis

function altitudeAdjustment(altitudeM) {
  if (!altitudeM || altitudeM < 2500) return 0;
  if (altitudeM < 3500) return 500;
  return 1000;
}

// ─── Exercise Fluid Replacement ────────────────────────────────
// ACSM: 400-800 mL/hour of exercise depending on intensity and sweat rate

function exerciseFluid(durationMinutes, intensity) {
  if (!durationMinutes || durationMinutes <= 0) return 0;

  const rates = {
    low: 400,      // mL per hour
    moderate: 600,
    high: 800,
  };

  const rate = rates[intensity || "moderate"] || 600;
  return (durationMinutes / 60) * rate;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Calculate daily water intake recommendation.
 *
 * @param {object} params
 * @param {number} params.weightKg - Body weight in kilograms
 * @param {string} [params.activityLevel="moderate"] - Activity level
 * @param {number} [params.climateTemp] - Ambient temperature in °C
 * @param {number} [params.exerciseMinutes] - Daily exercise duration in minutes
 * @param {string} [params.exerciseIntensity="moderate"] - Exercise intensity
 * @param {number} [params.altitudeM] - Altitude in meters above sea level
 * @param {boolean} [params.pregnant=false] - Pregnancy
 * @param {boolean} [params.breastfeeding=false] - Breastfeeding
 * @param {number} [params.caffeineIntakeMg] - Caffeine consumed (mild diuretic)
 * @returns {object} Detailed hydration recommendation
 */
export function calculateHydrationNeeds({
  weightKg,
  activityLevel = "moderate",
  climateTemp,
  exerciseMinutes,
  exerciseIntensity = "moderate",
  altitudeM,
  pregnant = false,
  breastfeeding = false,
  caffeineIntakeMg,
}) {
  // ── Validate ─────────────────────────────────────────────────
  if (!weightKg || weightKg <= 0) {
    return { error: "'weightKg' must be a positive number" };
  }

  const normalizedActivity = (activityLevel || "moderate")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const multiplier = BASE_MULTIPLIERS[normalizedActivity];
  if (!multiplier) {
    return {
      error: `Unknown activityLevel: "${activityLevel}"`,
      validLevels: Object.keys(BASE_MULTIPLIERS),
    };
  }

  // ── Base calculation ─────────────────────────────────────────
  const baseIntake = weightKg * multiplier;

  // ── Adjustments ──────────────────────────────────────────────
  const climateAdj = climateAdjustment(climateTemp);
  const altitudeAdj = altitudeAdjustment(altitudeM);
  const exerciseAdj = exerciseFluid(exerciseMinutes, exerciseIntensity);
  const pregnancyAdj = pregnant ? 300 : 0;  // IOM: +300 mL/day during pregnancy
  const lactationAdj = breastfeeding ? 700 : 0; // IOM: +700 mL/day during lactation
  const caffeineAdj = caffeineIntakeMg ? Math.round(caffeineIntakeMg * 0.5) : 0; // ~50% of caffeine volume as diuretic offset

  const totalIntake = baseIntake + climateAdj + altitudeAdj + exerciseAdj + pregnancyAdj + lactationAdj + caffeineAdj;

  // ── Timing distribution ──────────────────────────────────────
  const waking = totalIntake - exerciseAdj;
  const timing = {
    morning: Math.round(waking * 0.25),
    midday: Math.round(waking * 0.30),
    afternoon: Math.round(waking * 0.25),
    evening: Math.round(waking * 0.20),
  };

  if (exerciseMinutes > 0) {
    // ACSM: 500 mL 2h pre-exercise, rest during/after
    timing.preExercise = Math.min(500, Math.round(exerciseAdj * 0.3));
    timing.duringExercise = Math.round(exerciseAdj * 0.5);
    timing.postExercise = Math.round(exerciseAdj * 0.2);
  }

  return {
    input: {
      weightKg,
      activityLevel: normalizedActivity,
      climateTemp: climateTemp ?? null,
      exerciseMinutes: exerciseMinutes || 0,
      exerciseIntensity: exerciseIntensity || "moderate",
      altitudeM: altitudeM ?? null,
      pregnant,
      breastfeeding,
      caffeineIntakeMg: caffeineIntakeMg ?? null,
    },
    recommendation: {
      totalMl: Math.round(totalIntake),
      totalLiters: Number((totalIntake / 1000).toFixed(1)),
      totalCups: Math.round(totalIntake / 237), // 1 US cup = ~237 mL
    },
    breakdown: {
      baseMl: Math.round(baseIntake),
      climateAdjMl: climateAdj,
      altitudeAdjMl: altitudeAdj,
      exerciseAdjMl: Math.round(exerciseAdj),
      pregnancyAdjMl: pregnancyAdj,
      lactationAdjMl: lactationAdj,
      caffeineOffsetMl: caffeineAdj,
    },
    timing,
    _note: "Base: weight(kg) × activity multiplier. Adjustments per ACSM/IOM guidelines. Exercise fluid: 400-800 mL/hour. Timing is approximate — listen to thirst cues.",
  };
}
