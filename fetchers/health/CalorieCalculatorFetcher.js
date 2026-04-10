/**
 * Calorie Calculator Fetcher — BMR / TDEE Engine
 *
 * Implements the Mifflin-St Jeor equation (industry gold standard since 1990)
 * for Basal Metabolic Rate, multiplied by Physical Activity Level (PAL)
 * coefficients to derive Total Daily Energy Expenditure.
 *
 * Optionally adjusts for goal-based caloric surplus/deficit and provides
 * evidence-based macronutrient split recommendations.
 *
 * References:
 *   - Mifflin MD et al. (1990) Am J Clin Nutr 51:241-7
 *   - FAO/WHO/UNU PAL multipliers
 *   - ISSN Position Stand on protein (Jäger et al. 2017)
 */

// ─── Activity Level PAL Multipliers ────────────────────────────

const ACTIVITY_MULTIPLIERS = {
  sedentary: { factor: 1.2, label: "Sedentary (little or no exercise)" },
  light: { factor: 1.375, label: "Lightly active (1-3 days/week)" },
  moderate: { factor: 1.55, label: "Moderately active (3-5 days/week)" },
  active: { factor: 1.725, label: "Very active (6-7 days/week)" },
  very_active: { factor: 1.9, label: "Extra active (2x/day or physical job)" },
};

// ─── Goal Adjustments ──────────────────────────────────────────

const GOAL_ADJUSTMENTS = {
  maintain: { delta: 0, label: "Maintenance (isocaloric)" },
  cut: { delta: -500, label: "Fat loss (~0.45 kg/week deficit)" },
  aggressive_cut: { delta: -750, label: "Aggressive cut (~0.68 kg/week deficit)" },
  lean_bulk: { delta: 250, label: "Lean bulk (~0.23 kg/week surplus)" },
  bulk: { delta: 500, label: "Bulk (~0.45 kg/week surplus)" },
};

// ─── Macro Split Presets (% of total calories) ─────────────────

const MACRO_PRESETS = {
  balanced: { protein: 0.30, carbs: 0.40, fat: 0.30, label: "Balanced (30/40/30)" },
  high_protein: { protein: 0.40, carbs: 0.30, fat: 0.30, label: "High Protein (40/30/30)" },
  keto: { protein: 0.25, carbs: 0.05, fat: 0.70, label: "Ketogenic (25/5/70)" },
  low_fat: { protein: 0.30, carbs: 0.50, fat: 0.20, label: "Low Fat (30/50/20)" },
  zone: { protein: 0.30, carbs: 0.40, fat: 0.30, label: "Zone Diet (30/40/30)" },
};

// ─── Mifflin-St Jeor BMR ──────────────────────────────────────

function calculateBMR(sex, weightKg, heightCm, ageYears) {
  // Mifflin-St Jeor (1990):
  //   Male:   10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) + 5
  //   Female: 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) - 161
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "female" ? base - 161 : base + 5;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Calculate BMR, TDEE, and macronutrient targets.
 *
 * @param {object} params
 * @param {string} params.sex - "male" or "female"
 * @param {number} params.weightKg - Body weight in kilograms
 * @param {number} params.heightCm - Height in centimeters
 * @param {number} params.ageYears - Age in years
 * @param {string} [params.activityLevel="moderate"] - Activity level
 * @param {string} [params.goal="maintain"] - Caloric goal
 * @param {string} [params.macroSplit="balanced"] - Macronutrient split preset
 * @param {number} [params.bodyFatPct] - Optional body fat % for lean mass calc
 * @returns {object} Complete caloric and macro analysis
 */
export function calculateCaloricNeeds({
  sex,
  weightKg,
  heightCm,
  ageYears,
  activityLevel = "moderate",
  goal = "maintain",
  macroSplit = "balanced",
  bodyFatPct,
}) {
  // ── Validate required inputs ─────────────────────────────────
  const errors = [];
  if (!sex || !["male", "female"].includes(sex.toLowerCase())) {
    errors.push("'sex' must be 'male' or 'female'");
  }
  if (!weightKg || weightKg <= 0) {
    errors.push("'weightKg' must be a positive number");
  }
  if (!heightCm || heightCm <= 0) {
    errors.push("'heightCm' must be a positive number");
  }
  if (!ageYears || ageYears <= 0) {
    errors.push("'ageYears' must be a positive number");
  }
  if (errors.length) {
    return { error: errors.join("; ") };
  }

  const normalizedSex = sex.toLowerCase();
  const normalizedActivity = (activityLevel || "moderate").toLowerCase().replace(/[\s-]+/g, "_");
  const normalizedGoal = (goal || "maintain").toLowerCase().replace(/[\s-]+/g, "_");
  const normalizedSplit = (macroSplit || "balanced").toLowerCase().replace(/[\s-]+/g, "_");

  // ── Resolve activity multiplier ──────────────────────────────
  const activity = ACTIVITY_MULTIPLIERS[normalizedActivity];
  if (!activity) {
    return {
      error: `Unknown activityLevel: "${activityLevel}"`,
      validLevels: Object.keys(ACTIVITY_MULTIPLIERS),
    };
  }

  // ── Resolve goal adjustment ──────────────────────────────────
  const goalAdj = GOAL_ADJUSTMENTS[normalizedGoal];
  if (!goalAdj) {
    return {
      error: `Unknown goal: "${goal}"`,
      validGoals: Object.keys(GOAL_ADJUSTMENTS),
    };
  }

  // ── Resolve macro split ──────────────────────────────────────
  const split = MACRO_PRESETS[normalizedSplit];
  if (!split) {
    return {
      error: `Unknown macroSplit: "${macroSplit}"`,
      validSplits: Object.keys(MACRO_PRESETS),
    };
  }

  // ── Core calculations ────────────────────────────────────────
  const bmr = calculateBMR(normalizedSex, weightKg, heightCm, ageYears);
  const tdee = bmr * activity.factor;
  const caloricTarget = tdee + goalAdj.delta;

  // ── Macro breakdown (grams) ──────────────────────────────────
  // Protein: 4 kcal/g, Carbs: 4 kcal/g, Fat: 9 kcal/g
  const proteinKcal = caloricTarget * split.protein;
  const carbsKcal = caloricTarget * split.carbs;
  const fatKcal = caloricTarget * split.fat;

  const macros = {
    protein: {
      grams: Math.round(proteinKcal / 4),
      kcal: Math.round(proteinKcal),
      pct: Math.round(split.protein * 100),
      perKgBodyweight: Number((proteinKcal / 4 / weightKg).toFixed(1)),
    },
    carbohydrates: {
      grams: Math.round(carbsKcal / 4),
      kcal: Math.round(carbsKcal),
      pct: Math.round(split.carbs * 100),
    },
    fat: {
      grams: Math.round(fatKcal / 9),
      kcal: Math.round(fatKcal),
      pct: Math.round(split.fat * 100),
    },
  };

  // ── Optional body composition ────────────────────────────────
  let bodyComposition = null;
  if (bodyFatPct && bodyFatPct > 0 && bodyFatPct < 100) {
    const fatMass = weightKg * (bodyFatPct / 100);
    const leanMass = weightKg - fatMass;
    bodyComposition = {
      bodyFatPct,
      fatMassKg: Number(fatMass.toFixed(1)),
      leanMassKg: Number(leanMass.toFixed(1)),
      proteinPerKgLean: Number((macros.protein.grams / leanMass).toFixed(1)),
    };
  }

  // ── BMI (informational) ──────────────────────────────────────
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  let bmiCategory;
  if (bmi < 18.5) bmiCategory = "Underweight";
  else if (bmi < 25) bmiCategory = "Normal weight";
  else if (bmi < 30) bmiCategory = "Overweight";
  else bmiCategory = "Obese";

  return {
    _method: "Mifflin-St Jeor (1990)",
    input: {
      sex: normalizedSex,
      weightKg,
      heightCm,
      ageYears,
      activityLevel: activity.label,
      goal: goalAdj.label,
      macroSplit: split.label,
    },
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    caloricTarget: Math.round(caloricTarget),
    caloricAdjustment: goalAdj.delta,
    macros,
    bodyComposition,
    bmi: {
      value: Number(bmi.toFixed(1)),
      category: bmiCategory,
    },
    _note: "BMR via Mifflin-St Jeor equation. TDEE = BMR × PAL factor. Macro grams derived from caloric target using 4/4/9 kcal per gram for protein/carbs/fat respectively.",
  };
}

/**
 * Return available options for dropdowns/discovery.
 */
export function getCaloricNeedsOptions() {
  return {
    activityLevels: Object.entries(ACTIVITY_MULTIPLIERS).map(([k, v]) => ({
      key: k,
      label: v.label,
      factor: v.factor,
    })),
    goals: Object.entries(GOAL_ADJUSTMENTS).map(([k, v]) => ({
      key: k,
      label: v.label,
      dailyDelta: v.delta,
    })),
    macroSplits: Object.entries(MACRO_PRESETS).map(([k, v]) => ({
      key: k,
      label: v.label,
      protein: v.protein,
      carbs: v.carbs,
      fat: v.fat,
    })),
  };
}
