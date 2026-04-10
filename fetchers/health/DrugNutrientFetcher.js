/**
 * Drug-Nutrient Interaction Fetcher — DNI Screening Engine
 *
 * Provides drug-nutrient interaction (DNI) screening using a
 * curated static dataset derived from NIH ODS, FDA labeling
 * data, and pharmacological literature.
 *
 * References:
 *   - NIH Office of Dietary Supplements — Fact Sheets
 *   - Boullata & Armenti, Handbook of Drug-Nutrient Interactions (2010)
 *   - Natural Medicines Comprehensive Database
 */

// ─── Drug-Nutrient Interaction Database ────────────────────────
// Curated from pharmacological literature and FDA labeling data.
// Each entry: { drug pattern, nutrient, effect, severity, recommendation }

const INTERACTION_DB = [
  // ── Statins ──────────────────────────────────────────────────
  { drugPattern: /statin|atorvastatin|simvastatin|rosuvastatin|lovastatin|pravastatin/i, nutrient: "coenzyme_q10", effect: "depletion", severity: "moderate", description: "Statins inhibit HMG-CoA reductase, which is also required for CoQ10 synthesis. May cause muscle pain/weakness.", recommendation: "Consider CoQ10 supplementation (100-200mg/day)" },
  { drugPattern: /statin|atorvastatin|simvastatin|rosuvastatin|lovastatin|pravastatin/i, nutrient: "vitamin_d", effect: "depletion", severity: "minor", description: "Some evidence statins may reduce vitamin D levels.", recommendation: "Monitor vitamin D levels; supplement if deficient" },
  { drugPattern: /statin|atorvastatin|simvastatin/i, nutrient: "grapefruit", effect: "interaction", severity: "major", description: "Grapefruit inhibits CYP3A4, dramatically increasing statin blood levels and risk of rhabdomyolysis.", recommendation: "Avoid grapefruit and grapefruit juice entirely" },

  // ── Metformin ────────────────────────────────────────────────
  { drugPattern: /metformin/i, nutrient: "cyanocobalamin", effect: "depletion", severity: "major", description: "Metformin reduces vitamin B12 absorption by up to 30%. Long-term use can cause clinically significant B12 deficiency.", recommendation: "Monitor B12 annually. Supplement with 1000mcg/day B12." },
  { drugPattern: /metformin/i, nutrient: "folate", effect: "depletion", severity: "moderate", description: "Metformin may reduce folate absorption.", recommendation: "Consider folate supplementation (400-800mcg/day)" },
  { drugPattern: /metformin/i, nutrient: "magnesium", effect: "depletion", severity: "minor", description: "Some evidence of reduced magnesium levels with chronic metformin use.", recommendation: "Include magnesium-rich foods or supplement if deficient" },

  // ── PPIs (Proton Pump Inhibitors) ────────────────────────────
  { drugPattern: /omeprazole|pantoprazole|lansoprazole|esomeprazole|rabeprazole|ppi/i, nutrient: "magnesium", effect: "depletion", severity: "major", description: "Long-term PPI use (>1 year) can cause hypomagnesemia. FDA issued warning in 2011.", recommendation: "Monitor magnesium levels. Consider magnesium supplementation." },
  { drugPattern: /omeprazole|pantoprazole|lansoprazole|esomeprazole|rabeprazole|ppi/i, nutrient: "cyanocobalamin", effect: "depletion", severity: "moderate", description: "PPIs reduce stomach acid needed for B12 absorption from food.", recommendation: "Monitor B12 levels annually. Consider sublingual B12." },
  { drugPattern: /omeprazole|pantoprazole|lansoprazole|esomeprazole|rabeprazole|ppi/i, nutrient: "calcium", effect: "absorption_block", severity: "moderate", description: "Reduced stomach acid impairs calcium absorption, increasing fracture risk.", recommendation: "Use calcium citrate (not carbonate). Take between meals." },
  { drugPattern: /omeprazole|pantoprazole|lansoprazole|esomeprazole|rabeprazole|ppi/i, nutrient: "iron", effect: "absorption_block", severity: "moderate", description: "Reduced stomach acid impairs non-heme iron absorption.", recommendation: "Monitor iron levels. Take iron supplements between meals with vitamin C." },

  // ── Diuretics ────────────────────────────────────────────────
  { drugPattern: /furosemide|lasix|bumetanide|torsemide|loop\s*diuretic/i, nutrient: "potassium", effect: "depletion", severity: "major", description: "Loop diuretics cause significant potassium wasting. Can lead to hypokalemia, cardiac arrhythmias.", recommendation: "Monitor potassium levels closely. Eat potassium-rich foods (bananas, potatoes, spinach)." },
  { drugPattern: /furosemide|lasix|bumetanide|torsemide|loop\s*diuretic/i, nutrient: "magnesium", effect: "depletion", severity: "major", description: "Loop diuretics increase renal magnesium excretion.", recommendation: "Monitor magnesium. Supplement with 200-400mg/day." },
  { drugPattern: /furosemide|lasix|bumetanide|torsemide|loop\s*diuretic/i, nutrient: "calcium", effect: "depletion", severity: "moderate", description: "Loop diuretics increase calcium excretion.", recommendation: "Monitor calcium and bone density. Supplement as needed." },
  { drugPattern: /furosemide|lasix|bumetanide|torsemide|loop\s*diuretic/i, nutrient: "thiamin", effect: "depletion", severity: "moderate", description: "Loop diuretics increase thiamin excretion, especially in heart failure patients.", recommendation: "Consider thiamin supplementation (50-100mg/day)" },
  { drugPattern: /hydrochlorothiazide|chlorthalidone|hctz|thiazide/i, nutrient: "potassium", effect: "depletion", severity: "moderate", description: "Thiazide diuretics cause moderate potassium loss.", recommendation: "Eat potassium-rich foods. Monitor levels." },
  { drugPattern: /hydrochlorothiazide|chlorthalidone|hctz|thiazide/i, nutrient: "magnesium", effect: "depletion", severity: "moderate", description: "Thiazides increase magnesium excretion.", recommendation: "Monitor magnesium levels." },
  { drugPattern: /spironolactone|eplerenone|amiloride|triamterene/i, nutrient: "potassium", effect: "enhancement", severity: "major", description: "Potassium-sparing diuretics can cause hyperkalemia. DANGEROUS with potassium supplements.", recommendation: "AVOID potassium supplements. Limit high-potassium foods. Monitor levels." },

  // ── Antibiotics ──────────────────────────────────────────────
  { drugPattern: /tetracycline|doxycycline|minocycline/i, nutrient: "calcium", effect: "interaction", severity: "major", description: "Calcium chelates tetracyclines, reducing absorption by up to 50%.", recommendation: "Take tetracycline 2 hours before or 4 hours after calcium/dairy." },
  { drugPattern: /tetracycline|doxycycline|minocycline/i, nutrient: "iron", effect: "interaction", severity: "major", description: "Iron chelates tetracyclines, dramatically reducing drug absorption.", recommendation: "Separate by 2-4 hours." },
  { drugPattern: /tetracycline|doxycycline|minocycline/i, nutrient: "magnesium", effect: "interaction", severity: "moderate", description: "Magnesium chelates tetracyclines.", recommendation: "Separate by 2-4 hours." },
  { drugPattern: /ciprofloxacin|levofloxacin|moxifloxacin|fluoroquinolone/i, nutrient: "calcium", effect: "interaction", severity: "major", description: "Calcium chelates fluoroquinolones, reducing absorption.", recommendation: "Take fluoroquinolone 2 hours before or 6 hours after calcium." },
  { drugPattern: /ciprofloxacin|levofloxacin|moxifloxacin|fluoroquinolone/i, nutrient: "iron", effect: "interaction", severity: "major", description: "Iron chelates fluoroquinolones.", recommendation: "Separate by 2-6 hours." },

  // ── Anticonvulsants ──────────────────────────────────────────
  { drugPattern: /phenytoin|dilantin|carbamazepine|tegretol|valproic|depakote|phenobarbital/i, nutrient: "folate", effect: "depletion", severity: "major", description: "Anticonvulsants significantly deplete folate. Critical during pregnancy (neural tube defects).", recommendation: "Supplement with 1-5mg folic acid daily. Essential before/during pregnancy." },
  { drugPattern: /phenytoin|dilantin|carbamazepine|tegretol|phenobarbital/i, nutrient: "vitamin_d", effect: "depletion", severity: "major", description: "These anticonvulsants accelerate vitamin D metabolism, leading to deficiency and osteomalacia.", recommendation: "Monitor 25-OH-D levels. Supplement with 1000-4000 IU/day." },
  { drugPattern: /phenytoin|dilantin|carbamazepine|tegretol|phenobarbital/i, nutrient: "calcium", effect: "depletion", severity: "moderate", description: "Secondary to vitamin D depletion, calcium absorption is impaired.", recommendation: "Supplement calcium (1000-1500mg/day) with vitamin D." },
  { drugPattern: /valproic|depakote/i, nutrient: "carnitine", effect: "depletion", severity: "moderate", description: "Valproate depletes carnitine, potentially causing hepatotoxicity.", recommendation: "Consider L-carnitine supplementation (50mg/kg/day)" },

  // ── ACE Inhibitors / ARBs ────────────────────────────────────
  { drugPattern: /lisinopril|enalapril|ramipril|captopril|ace\s*inhibitor/i, nutrient: "potassium", effect: "enhancement", severity: "major", description: "ACE inhibitors reduce potassium excretion. Risk of hyperkalemia.", recommendation: "Monitor potassium closely. Avoid potassium supplements and salt substitutes." },
  { drugPattern: /lisinopril|enalapril|ramipril|captopril|ace\s*inhibitor/i, nutrient: "zinc", effect: "depletion", severity: "minor", description: "ACE inhibitors may increase zinc excretion.", recommendation: "Monitor zinc levels if on long-term therapy." },

  // ── Corticosteroids ──────────────────────────────────────────
  { drugPattern: /prednisone|prednisolone|dexamethasone|hydrocortisone|methylprednisolone|corticosteroid/i, nutrient: "calcium", effect: "depletion", severity: "major", description: "Corticosteroids reduce calcium absorption and increase excretion, causing osteoporosis.", recommendation: "Supplement calcium (1000-1500mg/day) + vitamin D (1000-2000 IU/day)" },
  { drugPattern: /prednisone|prednisolone|dexamethasone|hydrocortisone|methylprednisolone|corticosteroid/i, nutrient: "vitamin_d", effect: "depletion", severity: "major", description: "Corticosteroids impair vitamin D metabolism.", recommendation: "Supplement with 1000-2000 IU/day vitamin D." },
  { drugPattern: /prednisone|prednisolone|dexamethasone|hydrocortisone|methylprednisolone|corticosteroid/i, nutrient: "potassium", effect: "depletion", severity: "moderate", description: "Corticosteroids cause potassium wasting.", recommendation: "Eat potassium-rich foods. Monitor levels." },
  { drugPattern: /prednisone|prednisolone|dexamethasone|hydrocortisone|methylprednisolone|corticosteroid/i, nutrient: "chromium", effect: "depletion", severity: "minor", description: "Corticosteroids increase chromium excretion.", recommendation: "Consider chromium supplementation if on long-term steroids." },

  // ── Thyroid Medications ──────────────────────────────────────
  { drugPattern: /levothyroxine|synthroid|thyroid/i, nutrient: "calcium", effect: "absorption_block", severity: "major", description: "Calcium reduces levothyroxine absorption by up to 40%.", recommendation: "Take levothyroxine 4 hours apart from calcium supplements." },
  { drugPattern: /levothyroxine|synthroid|thyroid/i, nutrient: "iron", effect: "absorption_block", severity: "major", description: "Iron reduces levothyroxine absorption.", recommendation: "Separate by 4 hours." },
  { drugPattern: /levothyroxine|synthroid|thyroid/i, nutrient: "fiber", effect: "absorption_block", severity: "moderate", description: "High fiber can reduce levothyroxine absorption.", recommendation: "Maintain consistent fiber intake. Take thyroid meds on empty stomach." },

  // ── Warfarin / Blood Thinners ────────────────────────────────
  { drugPattern: /warfarin|coumadin/i, nutrient: "phylloquinone", effect: "interaction", severity: "major", description: "Vitamin K directly antagonizes warfarin's anticoagulant mechanism. Variable intake destabilizes INR.", recommendation: "Maintain CONSISTENT vitamin K intake. Don't suddenly increase/decrease green vegetables." },
  { drugPattern: /warfarin|coumadin/i, nutrient: "vitamin_e", effect: "enhancement", severity: "moderate", description: "High-dose vitamin E (>400 IU) may enhance warfarin's anticoagulant effect.", recommendation: "Limit supplemental vitamin E to <400 IU/day." },
  { drugPattern: /warfarin|coumadin/i, nutrient: "omega_3", effect: "enhancement", severity: "moderate", description: "High-dose fish oil (>3g/day) may enhance bleeding risk with warfarin.", recommendation: "Limit fish oil supplements. Monitor INR." },

  // ── Oral Contraceptives ──────────────────────────────────────
  { drugPattern: /oral\s*contraceptive|birth\s*control|ethinyl\s*estradiol/i, nutrient: "vitamin_b6", effect: "depletion", severity: "moderate", description: "OCs may deplete vitamin B6, contributing to mood changes.", recommendation: "Consider B6 supplementation (25-50mg/day)" },
  { drugPattern: /oral\s*contraceptive|birth\s*control|ethinyl\s*estradiol/i, nutrient: "folate", effect: "depletion", severity: "moderate", description: "OCs may reduce folate levels. Critical if discontinuing for pregnancy.", recommendation: "Supplement with 400-800mcg folic acid daily." },
  { drugPattern: /oral\s*contraceptive|birth\s*control|ethinyl\s*estradiol/i, nutrient: "magnesium", effect: "depletion", severity: "minor", description: "OCs may reduce magnesium levels.", recommendation: "Include magnesium-rich foods." },
  { drugPattern: /oral\s*contraceptive|birth\s*control|ethinyl\s*estradiol/i, nutrient: "zinc", effect: "depletion", severity: "minor", description: "OCs may reduce zinc levels.", recommendation: "Include zinc-rich foods." },

  // ── NSAIDs ───────────────────────────────────────────────────
  { drugPattern: /ibuprofen|naproxen|aspirin|indomethacin|nsaid|diclofenac|celecoxib/i, nutrient: "iron", effect: "depletion", severity: "moderate", description: "NSAIDs can cause GI bleeding, leading to iron loss.", recommendation: "Monitor iron/ferritin if on chronic NSAID therapy." },
  { drugPattern: /ibuprofen|naproxen|aspirin|indomethacin|nsaid|diclofenac|celecoxib/i, nutrient: "folate", effect: "depletion", severity: "minor", description: "Some NSAIDs may interfere with folate metabolism.", recommendation: "Maintain adequate folate intake." },

  // ── Lithium ──────────────────────────────────────────────────
  { drugPattern: /lithium/i, nutrient: "sodium", effect: "interaction", severity: "major", description: "Low sodium intake increases lithium toxicity (lithium and sodium compete for renal reabsorption).", recommendation: "Maintain consistent sodium intake. Never go on a low-sodium diet without consulting prescriber." },
  { drugPattern: /lithium/i, nutrient: "caffeine", effect: "interaction", severity: "moderate", description: "Caffeine increases lithium excretion. Sudden change in caffeine intake can alter lithium levels.", recommendation: "Maintain consistent caffeine intake." },
  { drugPattern: /lithium/i, nutrient: "iodine", effect: "interaction", severity: "moderate", description: "Lithium concentrates in the thyroid. Excess iodine may worsen lithium-induced hypothyroidism.", recommendation: "Monitor thyroid function. Avoid excess iodine supplements." },

  // ── MAOIs ────────────────────────────────────────────────────
  { drugPattern: /maoi|phenelzine|tranylcypromine|isocarboxazid|selegiline/i, nutrient: "tyramine", effect: "interaction", severity: "major", description: "MAOIs prevent tyramine breakdown. Foods high in tyramine (aged cheese, wine, fermented foods) can cause hypertensive crisis.", recommendation: "STRICTLY AVOID aged cheese, cured meats, red wine, soy sauce, fermented foods." },

  // ── SSRIs ────────────────────────────────────────────────────
  { drugPattern: /fluoxetine|sertraline|paroxetine|citalopram|escitalopram|ssri/i, nutrient: "sodium", effect: "depletion", severity: "moderate", description: "SSRIs can cause SIADH (hyponatremia), especially in elderly patients.", recommendation: "Monitor sodium levels, especially in first weeks of therapy." },

  // ── Bisphosphonates ──────────────────────────────────────────
  { drugPattern: /alendronate|risedronate|ibandronate|zoledronic|bisphosphonate/i, nutrient: "calcium", effect: "absorption_block", severity: "major", description: "Calcium blocks bisphosphonate absorption if taken within 30 minutes.", recommendation: "Take bisphosphonate on empty stomach with plain water, 30-60min before any food or calcium." },
  { drugPattern: /alendronate|risedronate|ibandronate|zoledronic|bisphosphonate/i, nutrient: "iron", effect: "absorption_block", severity: "moderate", description: "Iron blocks bisphosphonate absorption.", recommendation: "Separate by at least 2 hours." },
];

// ─── Search Helpers ────────────────────────────────────────────

function normalizeSearch(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Check for drug-nutrient interactions.
 *
 * @param {object} params
 * @param {string} params.drug - Drug name (brand or generic)
 * @param {string} [params.nutrients] - Comma-separated nutrients to check (optional — all if omitted)
 * @returns {object} Interaction report
 */
export function checkDrugNutrientInteractions({ drug, nutrients }) {
  if (!drug) {
    return { error: "'drug' parameter is required (e.g. 'metformin', 'lisinopril', 'omeprazole')" };
  }

  const normalizedDrug = normalizeSearch(drug);

  // Filter nutrients if specified
  const nutrientFilter = nutrients
    ? nutrients.split(",").map((n) => normalizeSearch(n)).filter(Boolean)
    : null;

  // Find matching interactions
  const matches = INTERACTION_DB.filter((entry) => {
    if (!entry.drugPattern.test(drug) && !entry.drugPattern.test(normalizedDrug)) {
      return false;
    }
    if (nutrientFilter) {
      const entryNutrient = normalizeSearch(entry.nutrient);
      return nutrientFilter.some(
        (n) => entryNutrient.includes(n) || n.includes(entryNutrient),
      );
    }
    return true;
  });

  // Sort by severity
  const severityOrder = { major: 0, moderate: 1, minor: 2 };
  matches.sort(
    (a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99),
  );

  const severityIcon = { major: "🔴", moderate: "🟡", minor: "🟢" };

  return {
    drug,
    interactionCount: matches.length,
    interactions: matches.map((m) => ({
      nutrient: m.nutrient,
      effect: m.effect,
      severity: m.severity,
      icon: severityIcon[m.severity] || "⚪",
      description: m.description,
      recommendation: m.recommendation,
    })),
    _disclaimer: "This is an informational screening tool based on known pharmacological interactions. Always consult a pharmacist or physician for medical decisions. This tool does not replace professional medical advice.",
    _sources: "NIH ODS Fact Sheets, Boullata & Armenti (2010) Handbook of Drug-Nutrient Interactions, FDA Drug Labeling",
  };
}

/**
 * List all drug classes covered by the interaction database.
 */
export function getDrugInteractionCategories() {
  const drugClasses = new Set();
  const nutrients = new Set();

  for (const entry of INTERACTION_DB) {
    // Extract a readable drug class from the pattern
    const patternStr = entry.drugPattern.source;
    const firstDrug = patternStr.split("|")[0].replace(/\\/g, "");
    drugClasses.add(firstDrug);
    nutrients.add(entry.nutrient);
  }

  return {
    totalInteractions: INTERACTION_DB.length,
    drugClassesCovered: [...drugClasses].sort(),
    nutrientsCovered: [...nutrients].sort(),
    severityLevels: [
      { key: "major", icon: "🔴", description: "Clinically significant — may require dose adjustment or avoidance" },
      { key: "moderate", icon: "🟡", description: "Monitor and manage — supplementation may be needed" },
      { key: "minor", icon: "🟢", description: "Low risk — awareness recommended" },
    ],
    effectTypes: [
      { key: "depletion", description: "Drug depletes nutrient levels over time" },
      { key: "absorption_block", description: "Drug or nutrient blocks absorption of the other" },
      { key: "interaction", description: "Drug and nutrient interact (timing/dosing matters)" },
      { key: "enhancement", description: "Nutrient enhances drug effect (risk of toxicity)" },
    ],
  };
}
