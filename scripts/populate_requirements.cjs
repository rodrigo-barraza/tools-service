const fs = require('fs');
const path = require('path');

const HEADERS = ['nutrient_id', 'species', 'demographic_life_stage', 'authority', 'metric', 'value_numeric', 'unit'];
const ROWS = [];

function add(nutrient_id, species, life_stage, authority, metric, value, unit) {
  ROWS.push([nutrient_id, species, life_stage, authority, metric, value, unit].join(','));
}

// ═══════════════════════════════════════════════════════════════
// HELPER SHORTHAND FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function h(ls, id, metric, val, unit) { add(id, 'human', ls, 'US_DRI', metric, val, unit); }

// Human adult helpers (keep backward compat)
function humanM(id, metric, val, unit) { h('adult_male', id, metric, val, unit); }
function humanF(id, metric, val, unit) { h('adult_female', id, metric, val, unit); }
function humanMF(id, metric, valM, valF, unit) { humanM(id, metric, valM, unit); humanF(id, metric, valF, unit); }
function humanBoth(id, metric, val, unit) { humanM(id, metric, val, unit); humanF(id, metric, val, unit); }

// Pet helpers
function dogM(id, metric, val, unit) { add(id, 'canine', 'adult_maintenance', 'AAFCO', metric, val, unit); }
function catM(id, metric, val, unit) { add(id, 'feline', 'adult_maintenance', 'AAFCO', metric, val, unit); }
function dogG(id, metric, val, unit) { add(id, 'canine', 'growth_reproduction', 'AAFCO', metric, val, unit); }
function catG(id, metric, val, unit) { add(id, 'feline', 'growth_reproduction', 'AAFCO', metric, val, unit); }

// Bulk helper: add same nutrient across multiple life stages with different values
function humanLifeStages(id, metric, unit, valueMap) {
  for (const [ls, val] of Object.entries(valueMap)) {
    h(ls, id, metric, val, unit);
  }
}

// ═══════════════════════════════════════════════════════════════
// HUMAN LIFE STAGE KEYS:
//   infant_0_6   infant_7_12
//   child_1_3    child_4_8
//   male_9_13    male_14_18    adult_male     male_51_70    male_71_plus
//   female_9_13  female_14_18  adult_female   female_51_70  female_71_plus
//   pregnant     lactating
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// SECTION 1: MACRONUTRIENTS
// ═══════════════════════════════════════════════════════════════

// -- Protein --
// Infants/children use fixed RDA; adults use per-kg multiplier
humanLifeStages('protein', 'AI', 'g', { infant_0_6: 9.1, infant_7_12: 11 });
humanLifeStages('protein', 'RDA', 'g', { child_1_3: 13, child_4_8: 19, male_9_13: 34, male_14_18: 52, female_9_13: 34, female_14_18: 46, pregnant: 71, lactating: 71 });
humanBoth('protein', 'RDA_multiplier_per_kg', 0.8, 'g');
humanLifeStages('protein', 'RDA_multiplier_per_kg', 'g', { male_51_70: 0.8, male_71_plus: 0.8, female_51_70: 0.8, female_71_plus: 0.8 });

// -- Carbohydrate --
humanLifeStages('carbohydrate', 'AI', 'g', { infant_0_6: 60, infant_7_12: 95 });
humanLifeStages('carbohydrate', 'RDA', 'g', { child_1_3: 130, child_4_8: 130, male_9_13: 130, male_14_18: 130, female_9_13: 130, female_14_18: 130, pregnant: 175, lactating: 210 });
humanBoth('carbohydrate', 'RDA', 130, 'g');
humanBoth('carbohydrate', 'AMDR_low_pct', 45, '%kcal');
humanBoth('carbohydrate', 'AMDR_high_pct', 65, '%kcal');

// -- Total Fat / Lipid --
humanLifeStages('lipid', 'AI', 'g', { infant_0_6: 31, infant_7_12: 30 });
humanBoth('lipid', 'AMDR_low_pct', 20, '%kcal');
humanBoth('lipid', 'AMDR_high_pct', 35, '%kcal');
dogM('lipid', 'MIN_per_1000kcal', 13.75, 'g'); dogG('lipid', 'MIN_per_1000kcal', 21.3, 'g');
catM('lipid', 'MIN_per_1000kcal', 22.5, 'g');  catG('lipid', 'MIN_per_1000kcal', 22.5, 'g');

// -- Fiber --
humanLifeStages('fiber', 'AI', 'g', {
  child_1_3: 19, child_4_8: 25,
  male_9_13: 31, male_14_18: 38, adult_male: 38, male_51_70: 30, male_71_plus: 30,
  female_9_13: 26, female_14_18: 26, adult_female: 25, female_51_70: 21, female_71_plus: 21,
  pregnant: 28, lactating: 29
});

// -- Water --
humanLifeStages('water', 'AI', 'mL', {
  infant_0_6: 700, infant_7_12: 800,
  child_1_3: 1300, child_4_8: 1700,
  male_9_13: 2400, male_14_18: 3300, adult_male: 3700, male_51_70: 3700, male_71_plus: 3700,
  female_9_13: 2100, female_14_18: 2300, adult_female: 2700, female_51_70: 2700, female_71_plus: 2700,
  pregnant: 3000, lactating: 3800
});

// Pet protein
dogM('protein', 'MIN_per_1000kcal', 45.0, 'g'); dogG('protein', 'MIN_per_1000kcal', 56.3, 'g');
catM('protein', 'MIN_per_1000kcal', 65.0, 'g'); catG('protein', 'MIN_per_1000kcal', 75.0, 'g');

// ═══════════════════════════════════════════════════════════════
// SECTION 2: AMINO ACIDS
// ═══════════════════════════════════════════════════════════════

// Human adults: per-kg multiplier (mg/kg/day) — WHO/IOM values
const humanAA = { histidine: 14, isoleucine: 19, leucine: 42, lysine: 38, methionine: 19, phenylalanine: 33, threonine: 20, tryptophan: 5, valine: 24 };
for (const [id, val] of Object.entries(humanAA)) {
  for (const ls of ['adult_male', 'adult_female', 'male_51_70', 'male_71_plus', 'female_51_70', 'female_71_plus']) {
    h(ls, id, 'RDA_multiplier_per_kg', val, 'mg');
  }
}
// Conditionally essential
for (const ls of ['adult_male', 'adult_female', 'male_51_70', 'male_71_plus', 'female_51_70', 'female_71_plus']) {
  h(ls, 'cystine', 'RDA_multiplier_per_kg', 4.1, 'mg');
  h(ls, 'tyrosine', 'RDA_multiplier_per_kg', 14, 'mg');
}

// Canine AAFCO Adult Maintenance (g/1000kcal)
const canineAA_maint = { arginine: 1.28, histidine: 0.48, isoleucine: 0.95, leucine: 1.70, lysine: 0.88, methionine: 0.83, phenylalanine: 1.28, threonine: 1.05, tryptophan: 0.35, valine: 1.23, cystine: 0.25, tyrosine: 0.58 };
for (const [id, val] of Object.entries(canineAA_maint)) { dogM(id, 'MIN_per_1000kcal', val, 'g'); }

// Canine AAFCO Growth & Reproduction (g/1000kcal)
const canineAA_growth = { arginine: 2.50, histidine: 1.10, isoleucine: 1.25, leucine: 2.25, lysine: 1.63, methionine: 0.88, phenylalanine: 1.50, threonine: 1.25, tryptophan: 0.38, valine: 1.38, cystine: 0.75, tyrosine: 1.00 };
for (const [id, val] of Object.entries(canineAA_growth)) { dogG(id, 'MIN_per_1000kcal', val, 'g'); }

// Feline AAFCO Adult Maintenance (g/1000kcal)
const felineAA_maint = { arginine: 2.60, histidine: 0.78, isoleucine: 1.30, leucine: 3.13, lysine: 0.83, methionine: 0.53, phenylalanine: 1.20, threonine: 1.83, tryptophan: 0.40, valine: 1.55, taurine: 0.50, cystine: 0.28, tyrosine: 1.00 };
for (const [id, val] of Object.entries(felineAA_maint)) { catM(id, 'MIN_per_1000kcal', val, 'g'); }

// Feline AAFCO Growth & Reproduction (g/1000kcal)
const felineAA_growth = { arginine: 3.13, histidine: 0.78, isoleucine: 1.30, leucine: 3.13, lysine: 2.68, methionine: 0.53, phenylalanine: 1.20, threonine: 1.83, tryptophan: 0.63, valine: 1.55, taurine: 0.50, cystine: 0.28, tyrosine: 1.20 };
for (const [id, val] of Object.entries(felineAA_growth)) { catG(id, 'MIN_per_1000kcal', val, 'g'); }

// Non-essential amino acids (compositional only, no DRI)
for (const aa of ['alanine', 'aspartic_acid', 'glutamic_acid', 'glycine', 'proline', 'serine', 'hydroxyproline', 'betaine']) {
  humanBoth(aa, 'NO_DRI', 0, 'n/a');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: VITAMINS — ALL LIFE STAGES
// ═══════════════════════════════════════════════════════════════

// -- Vitamin A --
humanLifeStages('vitamin_a', 'AI', 'mcg RAE', { infant_0_6: 400, infant_7_12: 500 });
humanLifeStages('vitamin_a', 'RDA', 'mcg RAE', {
  child_1_3: 300, child_4_8: 400,
  male_9_13: 600, male_14_18: 900, adult_male: 900, male_51_70: 900, male_71_plus: 900,
  female_9_13: 600, female_14_18: 700, adult_female: 700, female_51_70: 700, female_71_plus: 700,
  pregnant: 770, lactating: 1300
});
humanBoth('vitamin_a', 'UL', 3000, 'mcg RAE');

// -- Vitamin C --
humanLifeStages('vitamin_c', 'AI', 'mg', { infant_0_6: 40, infant_7_12: 50 });
humanLifeStages('vitamin_c', 'RDA', 'mg', {
  child_1_3: 15, child_4_8: 25,
  male_9_13: 45, male_14_18: 75, adult_male: 90, male_51_70: 90, male_71_plus: 90,
  female_9_13: 45, female_14_18: 65, adult_female: 75, female_51_70: 75, female_71_plus: 75,
  pregnant: 85, lactating: 120
});
humanBoth('vitamin_c', 'UL', 2000, 'mg');
humanBoth('ascorbic_acid', 'NO_DRI', 0, 'n/a');

// -- Vitamin D --
humanLifeStages('vitamin_d', 'AI', 'mcg', { infant_0_6: 10, infant_7_12: 10 });
humanLifeStages('vitamin_d', 'RDA', 'mcg', {
  child_1_3: 15, child_4_8: 15,
  male_9_13: 15, male_14_18: 15, adult_male: 15, male_51_70: 15, male_71_plus: 20,
  female_9_13: 15, female_14_18: 15, adult_female: 15, female_51_70: 15, female_71_plus: 20,
  pregnant: 15, lactating: 15
});
humanBoth('vitamin_d', 'UL', 100, 'mcg');
humanBoth('cholecalciferol', 'NO_DRI', 0, 'n/a');
humanBoth('ergocalciferol', 'NO_DRI', 0, 'n/a');

// -- Vitamin E (alpha-tocopherol) --
humanLifeStages('alpha_tocopherol', 'AI', 'mg', { infant_0_6: 4, infant_7_12: 5 });
humanLifeStages('alpha_tocopherol', 'RDA', 'mg', {
  child_1_3: 6, child_4_8: 7,
  male_9_13: 11, male_14_18: 15, adult_male: 15, male_51_70: 15, male_71_plus: 15,
  female_9_13: 11, female_14_18: 15, adult_female: 15, female_51_70: 15, female_71_plus: 15,
  pregnant: 15, lactating: 19
});
humanBoth('alpha_tocopherol', 'UL', 1000, 'mg');
for (const ve of ['beta_tocopherol', 'gamma_tocopherol', 'delta_tocopherol', 'alpha_tocotrienol', 'beta_tocotrienol', 'gamma_tocotrienol', 'delta_tocotrienol']) {
  humanBoth(ve, 'NO_DRI', 0, 'n/a');
}

// -- Vitamin K --
humanLifeStages('phylloquinone', 'AI', 'mcg', {
  infant_0_6: 2.0, infant_7_12: 2.5,
  child_1_3: 30, child_4_8: 55,
  male_9_13: 60, male_14_18: 75, adult_male: 120, male_51_70: 120, male_71_plus: 120,
  female_9_13: 60, female_14_18: 75, adult_female: 90, female_51_70: 90, female_71_plus: 90,
  pregnant: 90, lactating: 90
});
humanBoth('menaquinone_4', 'NO_DRI', 0, 'n/a');
humanBoth('dihydrophylloquinone', 'NO_DRI', 0, 'n/a');

// -- Thiamin (B1) --
humanLifeStages('thiamin', 'AI', 'mg', { infant_0_6: 0.2, infant_7_12: 0.3 });
humanLifeStages('thiamin', 'RDA', 'mg', {
  child_1_3: 0.5, child_4_8: 0.6,
  male_9_13: 0.9, male_14_18: 1.2, adult_male: 1.2, male_51_70: 1.2, male_71_plus: 1.2,
  female_9_13: 0.9, female_14_18: 1.0, adult_female: 1.1, female_51_70: 1.1, female_71_plus: 1.1,
  pregnant: 1.4, lactating: 1.4
});

// -- Riboflavin (B2) --
humanLifeStages('riboflavin', 'AI', 'mg', { infant_0_6: 0.3, infant_7_12: 0.4 });
humanLifeStages('riboflavin', 'RDA', 'mg', {
  child_1_3: 0.5, child_4_8: 0.6,
  male_9_13: 0.9, male_14_18: 1.3, adult_male: 1.3, male_51_70: 1.3, male_71_plus: 1.3,
  female_9_13: 0.9, female_14_18: 1.0, adult_female: 1.1, female_51_70: 1.1, female_71_plus: 1.1,
  pregnant: 1.4, lactating: 1.6
});

// -- Niacin (B3) --
humanLifeStages('niacin', 'AI', 'mg NE', { infant_0_6: 2, infant_7_12: 4 });
humanLifeStages('niacin', 'RDA', 'mg NE', {
  child_1_3: 6, child_4_8: 8,
  male_9_13: 12, male_14_18: 16, adult_male: 16, male_51_70: 16, male_71_plus: 16,
  female_9_13: 12, female_14_18: 14, adult_female: 14, female_51_70: 14, female_71_plus: 14,
  pregnant: 18, lactating: 17
});
humanBoth('niacin', 'UL', 35, 'mg');

// -- Pantothenic Acid (B5) --
humanLifeStages('vitamin_b5', 'AI', 'mg', {
  infant_0_6: 1.7, infant_7_12: 1.8,
  child_1_3: 2, child_4_8: 3,
  male_9_13: 4, male_14_18: 5, adult_male: 5, male_51_70: 5, male_71_plus: 5,
  female_9_13: 4, female_14_18: 5, adult_female: 5, female_51_70: 5, female_71_plus: 5,
  pregnant: 6, lactating: 7
});

// -- Vitamin B6 --
humanLifeStages('vitamin_b6', 'AI', 'mg', { infant_0_6: 0.1, infant_7_12: 0.3 });
humanLifeStages('vitamin_b6', 'RDA', 'mg', {
  child_1_3: 0.5, child_4_8: 0.6,
  male_9_13: 1.0, male_14_18: 1.3, adult_male: 1.3, male_51_70: 1.7, male_71_plus: 1.7,
  female_9_13: 1.0, female_14_18: 1.2, adult_female: 1.3, female_51_70: 1.5, female_71_plus: 1.5,
  pregnant: 1.9, lactating: 2.0
});
humanBoth('vitamin_b6', 'UL', 100, 'mg');

// -- Folate (B9) --
humanLifeStages('folate', 'AI', 'mcg DFE', { infant_0_6: 65, infant_7_12: 80 });
humanLifeStages('folate', 'RDA', 'mcg DFE', {
  child_1_3: 150, child_4_8: 200,
  male_9_13: 300, male_14_18: 400, adult_male: 400, male_51_70: 400, male_71_plus: 400,
  female_9_13: 300, female_14_18: 400, adult_female: 400, female_51_70: 400, female_71_plus: 400,
  pregnant: 600, lactating: 500
});
humanBoth('folate', 'UL', 1000, 'mcg');
humanBoth('folic_acid', 'NO_DRI', 0, 'n/a');

// -- Vitamin B12 (cyanocobalamin) --
humanLifeStages('cyanocobalamin', 'AI', 'mcg', { infant_0_6: 0.4, infant_7_12: 0.5 });
humanLifeStages('cyanocobalamin', 'RDA', 'mcg', {
  child_1_3: 0.9, child_4_8: 1.2,
  male_9_13: 1.8, male_14_18: 2.4, adult_male: 2.4, male_51_70: 2.4, male_71_plus: 2.4,
  female_9_13: 1.8, female_14_18: 2.4, adult_female: 2.4, female_51_70: 2.4, female_71_plus: 2.4,
  pregnant: 2.6, lactating: 2.8
});

// -- Choline --
humanLifeStages('choline', 'AI', 'mg', {
  infant_0_6: 125, infant_7_12: 150,
  child_1_3: 200, child_4_8: 250,
  male_9_13: 375, male_14_18: 550, adult_male: 550, male_51_70: 550, male_71_plus: 550,
  female_9_13: 375, female_14_18: 400, adult_female: 425, female_51_70: 425, female_71_plus: 425,
  pregnant: 450, lactating: 550
});
humanBoth('choline', 'UL', 3500, 'mg');

// -- Carotenoids & phytonutrients (no DRI) --
humanBoth('retinol', 'NO_DRI', 0, 'n/a');
humanBoth('alpha_carotene', 'NO_DRI', 0, 'n/a');
humanBoth('beta_carotene', 'NO_DRI', 0, 'n/a');
humanBoth('beta_cryptoxanthin', 'NO_DRI', 0, 'n/a');
humanBoth('lutein_and_zeaxanthin', 'NO_DRI', 0, 'n/a');
humanBoth('lycopene', 'NO_DRI', 0, 'n/a');

// Pet Vitamins — Adult Maintenance
dogM('vitamin_a', 'MIN_per_1000kcal', 1250, 'IU'); dogM('vitamin_a', 'MAX_per_1000kcal', 62500, 'IU');
dogM('vitamin_d', 'MIN_per_1000kcal', 125, 'IU');  dogM('vitamin_d', 'MAX_per_1000kcal', 750, 'IU');
dogM('alpha_tocopherol', 'MIN_per_1000kcal', 12.5, 'IU');
dogM('thiamin', 'MIN_per_1000kcal', 0.56, 'mg'); dogM('riboflavin', 'MIN_per_1000kcal', 1.30, 'mg');
dogM('niacin', 'MIN_per_1000kcal', 3.40, 'mg');  dogM('vitamin_b5', 'MIN_per_1000kcal', 3.0, 'mg');
dogM('vitamin_b6', 'MIN_per_1000kcal', 0.38, 'mg'); dogM('folate', 'MIN_per_1000kcal', 0.054, 'mg');
dogM('cyanocobalamin', 'MIN_per_1000kcal', 0.007, 'mg'); dogM('choline', 'MIN_per_1000kcal', 340, 'mg');

catM('vitamin_a', 'MIN_per_1000kcal', 1250, 'IU'); catM('vitamin_a', 'MAX_per_1000kcal', 83000, 'IU');
catM('vitamin_d', 'MIN_per_1000kcal', 70, 'IU');   catM('vitamin_d', 'MAX_per_1000kcal', 750, 'IU');
catM('alpha_tocopherol', 'MIN_per_1000kcal', 7.5, 'IU');
catM('thiamin', 'MIN_per_1000kcal', 1.40, 'mg'); catM('riboflavin', 'MIN_per_1000kcal', 1.00, 'mg');
catM('niacin', 'MIN_per_1000kcal', 15.0, 'mg');  catM('vitamin_b5', 'MIN_per_1000kcal', 1.44, 'mg');
catM('vitamin_b6', 'MIN_per_1000kcal', 1.00, 'mg'); catM('folate', 'MIN_per_1000kcal', 0.20, 'mg');
catM('cyanocobalamin', 'MIN_per_1000kcal', 0.005, 'mg'); catM('choline', 'MIN_per_1000kcal', 600, 'mg');

// Pet Vitamins — Growth & Reproduction
dogG('vitamin_a', 'MIN_per_1000kcal', 1250, 'IU'); dogG('vitamin_a', 'MAX_per_1000kcal', 62500, 'IU');
dogG('vitamin_d', 'MIN_per_1000kcal', 125, 'IU');  dogG('vitamin_d', 'MAX_per_1000kcal', 750, 'IU');
dogG('alpha_tocopherol', 'MIN_per_1000kcal', 12.5, 'IU');
dogG('thiamin', 'MIN_per_1000kcal', 0.56, 'mg'); dogG('riboflavin', 'MIN_per_1000kcal', 1.30, 'mg');
dogG('niacin', 'MIN_per_1000kcal', 3.40, 'mg');  dogG('vitamin_b5', 'MIN_per_1000kcal', 3.0, 'mg');
dogG('vitamin_b6', 'MIN_per_1000kcal', 0.38, 'mg'); dogG('folate', 'MIN_per_1000kcal', 0.054, 'mg');
dogG('cyanocobalamin', 'MIN_per_1000kcal', 0.007, 'mg'); dogG('choline', 'MIN_per_1000kcal', 340, 'mg');

catG('vitamin_a', 'MIN_per_1000kcal', 1663, 'IU');
catG('vitamin_d', 'MIN_per_1000kcal', 70, 'IU');   catG('vitamin_d', 'MAX_per_1000kcal', 750, 'IU');
catG('alpha_tocopherol', 'MIN_per_1000kcal', 7.5, 'IU');
catG('thiamin', 'MIN_per_1000kcal', 1.40, 'mg'); catG('riboflavin', 'MIN_per_1000kcal', 1.00, 'mg');
catG('niacin', 'MIN_per_1000kcal', 15.0, 'mg');  catG('vitamin_b5', 'MIN_per_1000kcal', 1.44, 'mg');
catG('vitamin_b6', 'MIN_per_1000kcal', 1.00, 'mg'); catG('folate', 'MIN_per_1000kcal', 0.20, 'mg');
catG('cyanocobalamin', 'MIN_per_1000kcal', 0.005, 'mg'); catG('choline', 'MIN_per_1000kcal', 600, 'mg');

// ═══════════════════════════════════════════════════════════════
// SECTION 4: MINERALS — ALL LIFE STAGES
// ═══════════════════════════════════════════════════════════════

// -- Calcium --
humanLifeStages('calcium', 'AI', 'mg', { infant_0_6: 200, infant_7_12: 260 });
humanLifeStages('calcium', 'RDA', 'mg', {
  child_1_3: 700, child_4_8: 1000,
  male_9_13: 1300, male_14_18: 1300, adult_male: 1000, male_51_70: 1000, male_71_plus: 1200,
  female_9_13: 1300, female_14_18: 1300, adult_female: 1000, female_51_70: 1200, female_71_plus: 1200,
  pregnant: 1000, lactating: 1000
});
humanBoth('calcium', 'UL', 2500, 'mg');

// -- Phosphorus --
humanLifeStages('phosphorus', 'AI', 'mg', { infant_0_6: 100, infant_7_12: 275 });
humanLifeStages('phosphorus', 'RDA', 'mg', {
  child_1_3: 460, child_4_8: 500,
  male_9_13: 1250, male_14_18: 1250, adult_male: 700, male_51_70: 700, male_71_plus: 700,
  female_9_13: 1250, female_14_18: 1250, adult_female: 700, female_51_70: 700, female_71_plus: 700,
  pregnant: 700, lactating: 700
});
humanBoth('phosphorus', 'UL', 4000, 'mg');

// -- Magnesium --
humanLifeStages('magnesium', 'AI', 'mg', { infant_0_6: 30, infant_7_12: 75 });
humanLifeStages('magnesium', 'RDA', 'mg', {
  child_1_3: 80, child_4_8: 130,
  male_9_13: 240, male_14_18: 410, adult_male: 400, male_51_70: 420, male_71_plus: 420,
  female_9_13: 240, female_14_18: 360, adult_female: 310, female_51_70: 320, female_71_plus: 320,
  pregnant: 350, lactating: 310
});
humanBoth('magnesium', 'UL', 350, 'mg'); // supplemental form only

// -- Sodium --
humanLifeStages('sodium', 'AI', 'mg', {
  infant_0_6: 110, infant_7_12: 370,
  child_1_3: 1000, child_4_8: 1200,
  male_9_13: 1500, male_14_18: 1500, adult_male: 1500, male_51_70: 1500, male_71_plus: 1500,
  female_9_13: 1500, female_14_18: 1500, adult_female: 1500, female_51_70: 1500, female_71_plus: 1500,
  pregnant: 1500, lactating: 1500
});
humanBoth('sodium', 'UL', 2300, 'mg');

// -- Potassium --
humanLifeStages('potassium', 'AI', 'mg', {
  infant_0_6: 400, infant_7_12: 860,
  child_1_3: 2000, child_4_8: 2300,
  male_9_13: 2500, male_14_18: 3000, adult_male: 3400, male_51_70: 3400, male_71_plus: 3400,
  female_9_13: 2300, female_14_18: 2300, adult_female: 2600, female_51_70: 2600, female_71_plus: 2600,
  pregnant: 2900, lactating: 2800
});

// -- Iron --
humanLifeStages('iron', 'AI', 'mg', { infant_0_6: 0.27, infant_7_12: 11 });
humanLifeStages('iron', 'RDA', 'mg', {
  child_1_3: 7, child_4_8: 10,
  male_9_13: 8, male_14_18: 11, adult_male: 8, male_51_70: 8, male_71_plus: 8,
  female_9_13: 8, female_14_18: 15, adult_female: 18, female_51_70: 8, female_71_plus: 8,
  pregnant: 27, lactating: 9
});
humanBoth('iron', 'UL', 45, 'mg');

// -- Zinc --
humanLifeStages('zinc', 'AI', 'mg', { infant_0_6: 2, infant_7_12: 3 });
humanLifeStages('zinc', 'RDA', 'mg', {
  child_1_3: 3, child_4_8: 5,
  male_9_13: 8, male_14_18: 11, adult_male: 11, male_51_70: 11, male_71_plus: 11,
  female_9_13: 8, female_14_18: 9, adult_female: 8, female_51_70: 8, female_71_plus: 8,
  pregnant: 11, lactating: 12
});
humanBoth('zinc', 'UL', 40, 'mg');

// -- Copper --
humanLifeStages('copper', 'AI', 'mcg', { infant_0_6: 200, infant_7_12: 220 });
humanLifeStages('copper', 'RDA', 'mcg', {
  child_1_3: 340, child_4_8: 440,
  male_9_13: 700, male_14_18: 890, adult_male: 900, male_51_70: 900, male_71_plus: 900,
  female_9_13: 700, female_14_18: 890, adult_female: 900, female_51_70: 900, female_71_plus: 900,
  pregnant: 1000, lactating: 1300
});
humanBoth('copper', 'UL', 10000, 'mcg');

// -- Selenium --
humanLifeStages('selenium', 'AI', 'mcg', { infant_0_6: 15, infant_7_12: 20 });
humanLifeStages('selenium', 'RDA', 'mcg', {
  child_1_3: 20, child_4_8: 30,
  male_9_13: 40, male_14_18: 55, adult_male: 55, male_51_70: 55, male_71_plus: 55,
  female_9_13: 40, female_14_18: 55, adult_female: 55, female_51_70: 55, female_71_plus: 55,
  pregnant: 60, lactating: 70
});
humanBoth('selenium', 'UL', 400, 'mcg');

// -- Iodine --
humanLifeStages('iodine', 'AI', 'mcg', { infant_0_6: 110, infant_7_12: 130 });
humanLifeStages('iodine', 'RDA', 'mcg', {
  child_1_3: 90, child_4_8: 90,
  male_9_13: 120, male_14_18: 150, adult_male: 150, male_51_70: 150, male_71_plus: 150,
  female_9_13: 120, female_14_18: 150, adult_female: 150, female_51_70: 150, female_71_plus: 150,
  pregnant: 220, lactating: 290
});
humanBoth('iodine', 'UL', 1100, 'mcg');

// -- Manganese --
humanLifeStages('manganese', 'AI', 'mg', {
  infant_0_6: 0.003, infant_7_12: 0.6,
  child_1_3: 1.2, child_4_8: 1.5,
  male_9_13: 1.9, male_14_18: 2.2, adult_male: 2.3, male_51_70: 2.3, male_71_plus: 2.3,
  female_9_13: 1.6, female_14_18: 1.6, adult_female: 1.8, female_51_70: 1.8, female_71_plus: 1.8,
  pregnant: 2.0, lactating: 2.6
});
humanBoth('manganese', 'UL', 11, 'mg');

// -- Fluoride --
humanLifeStages('fluoride', 'AI', 'mg', {
  infant_0_6: 0.01, infant_7_12: 0.5,
  child_1_3: 0.7, child_4_8: 1.0,
  male_9_13: 2.0, male_14_18: 3.0, adult_male: 4, male_51_70: 4, male_71_plus: 4,
  female_9_13: 2.0, female_14_18: 3.0, adult_female: 3, female_51_70: 3, female_71_plus: 3,
  pregnant: 3, lactating: 3
});
humanBoth('fluoride', 'UL', 10, 'mg');

// Pet Minerals — Adult Maintenance
dogM('calcium', 'MIN_per_1000kcal', 1.25, 'g'); dogM('calcium', 'MAX_per_1000kcal', 6.25, 'g');
dogM('phosphorus', 'MIN_per_1000kcal', 1.00, 'g'); dogM('phosphorus', 'MAX_per_1000kcal', 4.00, 'g');
dogM('potassium', 'MIN_per_1000kcal', 1.50, 'g'); dogM('sodium', 'MIN_per_1000kcal', 0.20, 'g');
dogM('magnesium', 'MIN_per_1000kcal', 0.15, 'g');
dogM('iron', 'MIN_per_1000kcal', 10.0, 'mg'); dogM('iron', 'MAX_per_1000kcal', 750, 'mg');
dogM('zinc', 'MIN_per_1000kcal', 20.0, 'mg'); dogM('zinc', 'MAX_per_1000kcal', 250, 'mg');
dogM('copper', 'MIN_per_1000kcal', 1.83, 'mg');
dogM('selenium', 'MIN_per_1000kcal', 0.088, 'mg'); dogM('selenium', 'MAX_per_1000kcal', 0.50, 'mg');
dogM('iodine', 'MIN_per_1000kcal', 0.25, 'mg'); dogM('iodine', 'MAX_per_1000kcal', 2.75, 'mg');
dogM('manganese', 'MIN_per_1000kcal', 1.25, 'mg');

catM('calcium', 'MIN_per_1000kcal', 1.50, 'g'); catM('phosphorus', 'MIN_per_1000kcal', 1.25, 'g');
catM('potassium', 'MIN_per_1000kcal', 1.50, 'g'); catM('sodium', 'MIN_per_1000kcal', 0.50, 'g');
catM('magnesium', 'MIN_per_1000kcal', 0.10, 'g');
catM('iron', 'MIN_per_1000kcal', 20.0, 'mg'); catM('zinc', 'MIN_per_1000kcal', 18.7, 'mg');
catM('copper', 'MIN_per_1000kcal', 1.25, 'mg');
catM('selenium', 'MIN_per_1000kcal', 0.075, 'mg');
catM('iodine', 'MIN_per_1000kcal', 0.45, 'mg'); catM('iodine', 'MAX_per_1000kcal', 2.25, 'mg');
catM('manganese', 'MIN_per_1000kcal', 1.90, 'mg');

// Pet Minerals — Growth & Reproduction
dogG('calcium', 'MIN_per_1000kcal', 3.00, 'g'); dogG('calcium', 'MAX_per_1000kcal', 7.00, 'g');
dogG('phosphorus', 'MIN_per_1000kcal', 2.50, 'g'); dogG('phosphorus', 'MAX_per_1000kcal', 4.00, 'g');
dogG('potassium', 'MIN_per_1000kcal', 1.50, 'g'); dogG('sodium', 'MIN_per_1000kcal', 0.75, 'g');
dogG('magnesium', 'MIN_per_1000kcal', 0.10, 'g');
dogG('iron', 'MIN_per_1000kcal', 22.0, 'mg'); dogG('zinc', 'MIN_per_1000kcal', 25.0, 'mg');
dogG('copper', 'MIN_per_1000kcal', 3.05, 'mg');
dogG('selenium', 'MIN_per_1000kcal', 0.088, 'mg');
dogG('iodine', 'MIN_per_1000kcal', 0.25, 'mg'); dogG('iodine', 'MAX_per_1000kcal', 2.75, 'mg');
dogG('manganese', 'MIN_per_1000kcal', 1.75, 'mg');

catG('calcium', 'MIN_per_1000kcal', 2.50, 'g'); catG('phosphorus', 'MIN_per_1000kcal', 2.00, 'g');
catG('potassium', 'MIN_per_1000kcal', 1.50, 'g'); catG('sodium', 'MIN_per_1000kcal', 0.50, 'g');
catG('magnesium', 'MIN_per_1000kcal', 0.10, 'g');
catG('iron', 'MIN_per_1000kcal', 20.0, 'mg'); catG('zinc', 'MIN_per_1000kcal', 18.7, 'mg');
catG('copper', 'MIN_per_1000kcal', 1.25, 'mg');
catG('selenium', 'MIN_per_1000kcal', 0.075, 'mg');
catG('iodine', 'MIN_per_1000kcal', 0.45, 'mg');
catG('manganese', 'MIN_per_1000kcal', 1.90, 'mg');

// ═══════════════════════════════════════════════════════════════
// SECTION 5: LIPIDS & FATTY ACIDS
// ═══════════════════════════════════════════════════════════════

// Essential FAs
humanLifeStages('c18_d2_n6_cis_cis', 'AI', 'g', {
  infant_0_6: 4.4, infant_7_12: 4.6,
  child_1_3: 7, child_4_8: 10,
  male_9_13: 12, male_14_18: 16, adult_male: 17, male_51_70: 14, male_71_plus: 14,
  female_9_13: 10, female_14_18: 11, adult_female: 12, female_51_70: 11, female_71_plus: 11,
  pregnant: 13, lactating: 13
});
humanLifeStages('c18_d3_n3_cis_cis_cis', 'AI', 'g', {
  infant_0_6: 0.5, infant_7_12: 0.5,
  child_1_3: 0.7, child_4_8: 0.9,
  male_9_13: 1.2, male_14_18: 1.6, adult_male: 1.6, male_51_70: 1.6, male_71_plus: 1.6,
  female_9_13: 1.0, female_14_18: 1.1, adult_female: 1.1, female_51_70: 1.1, female_71_plus: 1.1,
  pregnant: 1.4, lactating: 1.3
});

// EPA + DHA (no formal DRI but widely recommended)
humanBoth('c20_d5_n3', 'RECOMMENDATION', 250, 'mg');
humanBoth('c22_d6_n3', 'RECOMMENDATION', 250, 'mg');

// Pet essential FAs
dogM('c18_d2_n6_cis_cis', 'MIN_per_1000kcal', 2.80, 'g');
dogG('c18_d2_n6_cis_cis', 'MIN_per_1000kcal', 3.25, 'g');
catM('c18_d2_n6_cis_cis', 'MIN_per_1000kcal', 1.40, 'g');
catG('c18_d2_n6_cis_cis', 'MIN_per_1000kcal', 1.40, 'g');
catM('c20_d4_n6', 'MIN_per_1000kcal', 0.05, 'g'); catG('c20_d4_n6', 'MIN_per_1000kcal', 0.05, 'g');
catM('c20_d5_n3', 'MIN_per_1000kcal', 0.015, 'g'); catG('c20_d5_n3', 'MIN_per_1000kcal', 0.015, 'g');
catM('c22_d6_n3', 'MIN_per_1000kcal', 0.015, 'g'); catG('c22_d6_n3', 'MIN_per_1000kcal', 0.015, 'g');

// All other fatty acids: compositional only
const compositionalFA = [
  'c04_d0','c06_d0','c08_d0','c10_d0','c12_d0','c13_d0','c14_d0','c15_d0','c16_d0','c17_d0','c18_d0','c20_d0','c22_d0','c24_d0',
  'c14_d1','c15_d1','c16_d1_cis','c16_d1_trans','c16_d1_undifferentiated','c17_d1','c18_d1_cis','c18_d1_trans','c18_d1_undifferentiated',
  'c20_d1','c22_d1_cis','c22_d1_trans','c22_d1_undifferentiated','c24_d1_cis',
  'c18_d2_cla','c18_d2_mixed','c18_d2_trans','c18_d2_trans_trans','c18_d2_undifferentiated',
  'c18_d3_i','c18_d3_undifferentiated','c18_d4','c18_d3_n6_cis_cis_cis',
  'c20_d2_n6_cis_cis','c20_d3_n3','c20_d3_n6','c20_d3_undifferentiated','c20_d4_undifferentiated',
  'c21_d5_n3','c22_d4','c22_d5_n3',
  'saturated_fat','monounsaturated_fat','polyunsaturated_fat','trans_fat','trans_monoenoic_fat','trans_polyenoic_fat',
];
for (const fa of compositionalFA) { humanBoth(fa, 'NO_DRI', 0, 'n/a'); }

// ═══════════════════════════════════════════════════════════════
// SECTION 6: STEROLS
// ═══════════════════════════════════════════════════════════════
humanBoth('cholesterol', 'GUIDELINE', 300, 'mg');
humanBoth('phytosterol', 'RECOMMENDATION', 2000, 'mg');
humanBoth('beta_sitosterol', 'NO_DRI', 0, 'n/a');
humanBoth('campesterol', 'NO_DRI', 0, 'n/a');
humanBoth('stigmasterol', 'NO_DRI', 0, 'n/a');

// ═══════════════════════════════════════════════════════════════
// SECTION 7: CARBOHYDRATE SUBTYPES
// ═══════════════════════════════════════════════════════════════
humanBoth('sugar', 'GUIDELINE_max_pct', 10, '%kcal');
for (const carb of ['fructose','galactose','glucose','lactose','maltose','starch','sucrose']) {
  humanBoth(carb, 'NO_DRI', 0, 'n/a');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8: OTHER & TOXICITIES
// ═══════════════════════════════════════════════════════════════
add('caffeine', 'canine', 'adult_maintenance', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('caffeine', 'canine', 'growth_reproduction', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('caffeine', 'feline', 'adult_maintenance', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('caffeine', 'feline', 'growth_reproduction', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('theobromine', 'canine', 'adult_maintenance', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('theobromine', 'canine', 'growth_reproduction', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('theobromine', 'feline', 'adult_maintenance', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
add('theobromine', 'feline', 'growth_reproduction', 'AAFCO', 'TOXIC_MAX', 0, 'mg');
humanBoth('caffeine', 'GUIDELINE', 400, 'mg');
humanBoth('theobromine', 'NO_DRI', 0, 'n/a');
humanBoth('ethanol', 'NO_DRI', 0, 'n/a');
humanBoth('mineral', 'NO_DRI', 0, 'n/a');

// ═══════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════

const csvContent = HEADERS.join(',') + '\n' + ROWS.join('\n') + '\n';
const outPath = path.join(__dirname, '..', '..', 'digest', 'database', 'data', 'digest_nutrient_requirement.csv');
fs.writeFileSync(outPath, csvContent);

// Coverage report
const nutrientPath = path.join(__dirname, '..', '..', 'digest', 'database', 'data', 'digest_nutrient.csv');
const nutrientRaw = fs.readFileSync(nutrientPath, 'utf-8');
const allIds = nutrientRaw.split('\n').slice(1).filter(l => l.trim()).map(l => l.split(',')[0].trim());
const coveredIds = new Set(ROWS.map(r => r.split(',')[0]));
const missing = allIds.filter(id => !coveredIds.has(id));

// Life stage coverage
const lifeStages = new Set(ROWS.map(r => r.split(',')[2]));

console.log(`✅ Generated ${ROWS.length} rules across ${coveredIds.size} unique nutrients`);
console.log(`📊 Nutrient coverage: ${coveredIds.size}/${allIds.length} (${((coveredIds.size/allIds.length)*100).toFixed(1)}%)`);
console.log(`🧬 Life stages: ${lifeStages.size} → ${[...lifeStages].sort().join(', ')}`);
if (missing.length) {
  console.log(`⚠️  Missing ${missing.length}: ${missing.join(', ')}`);
} else {
  console.log(`🎉 FULL NUTRIENT COVERAGE`);
}
