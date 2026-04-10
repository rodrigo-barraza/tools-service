# EFSA & WHO Nutritional Standards — Comprehensive Research

> **Scope:** Healthy adults aged 19–50 (male & female), matching the `digest_nutrient_requirement.csv` taxonomy.
> **Date Compiled:** 2026-04-10
> **CSV Authority Keys:** `EFSA`, `WHO`

---

## 1. Authority Overview

### 1.1 EFSA — European Food Safety Authority

EFSA publishes **Dietary Reference Values (DRVs)**, completed across a multi-year project finalized in 2019, with UL updates through 2024–2025.

| Term | Definition | US DRI Equivalent |
|------|-----------|-------------------|
| **PRI** (Population Reference Intake) | Covers 97.5% of population | RDA |
| **AR** (Average Requirement) | Meets 50% of population | EAR |
| **AI** (Adequate Intake) | Observed intake assumed adequate (used when PRI cannot be set) | AI |
| **RI** (Reference Intake range) | % of total energy for macronutrients | AMDR |
| **UL** (Tolerable Upper Intake Level) | Maximum chronic daily intake without adverse effects | UL |

**Primary Source:** EFSA Journal — *Dietary Reference Values for Nutrients: Summary Report* (e15121, 2017; updated through 2025)

### 1.2 WHO/FAO — World Health Organization / Food and Agriculture Organization

WHO uses **Recommended Nutrient Intakes (RNIs)** from the joint expert consultation report *Vitamin and Mineral Requirements in Human Nutrition* (2nd edition, 2004), supplemented by standalone WHO guidelines on sodium, potassium, sugars, and fats (2012–2024).

| Term | Definition | US DRI Equivalent |
|------|-----------|-------------------|
| **RNI** (Recommended Nutrient Intake) | Covers 97.5% of population | RDA |
| **Safe Intake** | Used where RNI data is insufficient | AI |
| **GUIDELINE** | Population-level dietary target (e.g., sugar <%E) | Dietary Guidelines |

**Primary Source:** WHO/FAO (2004) ISBN 9241546123; WHO Guidelines on Sodium (2012), Potassium (2012), Sugars (2015), Fats (2023)

---

## 2. Macronutrients

### 2.1 Protein

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI_multiplier_per_kg | 0.83 | 0.83 | g |
| **WHO** | RNI_pct_range_low | 10 | 10 | %kcal |
| **WHO** | RNI_pct_range_high | 15 | 15 | %kcal |

> EFSA notes intakes up to 2× PRI are generally safe for healthy active adults; no formal UL set.

### 2.2 Carbohydrate

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | RI_low_pct | 45 | 45 | %kcal |
| **EFSA** | RI_high_pct | 60 | 60 | %kcal |
| **WHO** | GUIDELINE_low_pct | 40 | 40 | %kcal |
| **WHO** | GUIDELINE_high_pct | 70 | 70 | %kcal |

### 2.3 Total Lipid (Fat)

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | RI_low_pct | 20 | 20 | %kcal |
| **EFSA** | RI_high_pct | 35 | 35 | %kcal |
| **WHO** | GUIDELINE_max_pct | 30 | 30 | %kcal |

### 2.4 Fiber

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 25 | 25 | g |
| **WHO** | GUIDELINE_min | 25 | 25 | g |

### 2.5 Water

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 2500 | 2000 | mL |
| **WHO** | — | Not formally set | — | — |

> WHO does not set a universal water RNI; national guidelines apply.

### 2.6 Sugar (Free/Added)

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | GUIDELINE_alap | — | — | as low as possible |
| **WHO** | GUIDELINE_max_pct | 10 | 10 | %kcal |
| **WHO** | CONDITIONAL_max_pct | 5 | 5 | %kcal |

> EFSA (2022): No UL could be set for added/free sugars — risk increases linearly across all intake levels. Recommendation is "as low as possible."

### 2.7 Saturated Fat

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | GUIDELINE_alap | — | — | as low as possible |
| **WHO** | GUIDELINE_max_pct | 10 | 10 | %kcal |

### 2.8 Trans Fat

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | GUIDELINE_alap | — | — | as low as possible |
| **WHO** | GUIDELINE_max_pct | 1 | 1 | %kcal |

---

## 3. Essential Fatty Acids

### 3.1 Linoleic Acid (LA, n-6) — `c18_d2_n6_cis_cis`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI_pct | 4 | 4 | %kcal |
| **WHO** | GUIDELINE_range | 6–11 | 6–11 | %kcal |

### 3.2 Alpha-Linolenic Acid (ALA, n-3) — `c18_d3_n3_cis_cis_cis`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI_pct | 0.5 | 0.5 | %kcal |
| **WHO** | GUIDELINE_range | 0.5–2 | 0.5–2 | %kcal |

### 3.3 EPA — `c20_d5_n3`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI (EPA+DHA combined) | 250 | 250 | mg |
| **WHO** | RECOMMENDATION (EPA+DHA) | 250 | 250 | mg |

### 3.4 DHA — `c22_d6_n3`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI (included in EPA+DHA) | 250 | 250 | mg |
| **WHO** | RECOMMENDATION (included in EPA+DHA) | 250 | 250 | mg |

> Both EFSA and WHO set 250 mg/day EPA+DHA combined for cardiovascular health.

---

## 4. Fat-Soluble Vitamins

### 4.1 Vitamin A — `vitamin_a`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 750 | 650 | mcg RE |
| **EFSA** | UL (preformed retinol) | 3000 | 3000 | mcg RE |
| **WHO** | Safe_Intake | 600 | 500 | mcg RE |

> WHO uses "recommended safe intakes" rather than formal RNI. Conversion: 1 mcg retinol = 1 RE; 1 mcg β-carotene = 0.167 mcg RE.

### 4.2 Vitamin D — `vitamin_d`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 15 | 15 | mcg |
| **EFSA** | UL | 100 | 100 | mcg |
| **WHO** | RNI | 5 | 5 | mcg |

> WHO (2004) value of 5 mcg (200 IU) is widely considered outdated. Many national authorities have moved to 10–15 mcg. EFSA's 15 mcg AI (600 IU) aligns with the US DRI RDA.

### 4.3 Vitamin E (α-tocopherol) — `alpha_tocopherol`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 13 | 11 | mg |
| **EFSA** | UL | 300 | 300 | mg |
| **WHO** | Safe_Intake | 10 | 7.5 | mg |

> EFSA UL of 300 mg updated in 2024. Does not apply to individuals on anticoagulant/antiplatelet therapy.

### 4.4 Vitamin K (Phylloquinone) — `phylloquinone`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 70 | 70 | mcg |
| **WHO** | RNI (1 mcg/kg BW) | 65 | 55 | mcg |

> EFSA: No UL established for vitamin K. WHO derives from 1 mcg per kg body weight using standard reference weights (65 kg male, 55 kg female).

---

## 5. Water-Soluble Vitamins

### 5.1 Vitamin C — `vitamin_c`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 110 | 95 | mg |
| **WHO** | RNI | 45 | 45 | mg |

> EFSA: No UL established (insufficient data). WHO value is considerably lower, based on scurvy prevention + metabolic turnover.

### 5.2 Thiamin (B1) — `thiamin`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 0.1 mg/MJ | 0.1 mg/MJ | mg/MJ |
| **EFSA** | PRI (approx. at ~10 MJ) | 1.0 | 0.8 | mg |
| **WHO** | RNI | 1.2 | 1.1 | mg |

> EFSA expresses thiamin requirement relative to energy intake (0.1 mg per MJ). Approximate absolute values depend on individual energy needs (~8–10 MJ/day).

### 5.3 Riboflavin (B2) — `riboflavin`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 1.6 | 1.6 | mg |
| **WHO** | RNI | 1.3 | 1.1 | mg |

### 5.4 Niacin (B3) — `niacin`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 1.6 mg NE/MJ | 1.6 mg NE/MJ | mg NE/MJ |
| **EFSA** | PRI (approx. at ~10 MJ) | 16 | 13 | mg NE |
| **EFSA** | UL (supplemental nicotinic acid) | 10 | 10 | mg |
| **EFSA** | UL (supplemental nicotinamide) | 900 | 900 | mg |
| **WHO** | RNI | 16 | 14 | mg NE |

> NE = Niacin Equivalents (1 mg NE = 1 mg niacin = 60 mg tryptophan). EFSA UL applies to supplemental forms only, not dietary niacin.

### 5.5 Pantothenic Acid (B5) — `vitamin_b5`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 5 | 5 | mg |
| **WHO** | Safe_Intake | 5 | 5 | mg |

### 5.6 Vitamin B6 — `vitamin_b6`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 1.7 | 1.6 | mg |
| **EFSA** | UL | 12 | 12 | mg |
| **WHO** | RNI | 1.3 | 1.3 | mg |

> EFSA updated UL in 2023 from 25 mg to 12 mg based on new evidence on peripheral neuropathy.

### 5.7 Folate (B9) — `folate`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 330 | 330 | mcg DFE |
| **EFSA** | UL (supplemental folic acid) | 1000 | 1000 | mcg |
| **WHO** | RNI | 400 | 400 | mcg DFE |

> DFE = Dietary Folate Equivalents. UL applies to supplemental folic acid only.

### 5.8 Vitamin B12 (Cobalamin) — `cyanocobalamin`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 4.0 | 4.0 | mcg |
| **WHO** | RNI | 2.4 | 2.4 | mcg |

> EFSA sets AI (not PRI) at 4.0 mcg — notably higher than US DRI RDA (2.4 mcg) and WHO RNI (2.4 mcg).

### 5.9 Biotin (B7)

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 40 | 40 | mcg |
| **WHO** | — | Not established | — | — |

> Not currently tracked in `digest_nutrient_requirement.csv`. WHO 2004 did not set a specific RNI for biotin.

### 5.10 Choline — `choline`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 400 | 400 | mg |
| **WHO** | — | Not established | — | — |

> EFSA sets a single AI for all adults (400 mg). No UL established. WHO 2004 did not set an RNI.

---

## 6. Minerals — Macrominerals

### 6.1 Calcium — `calcium`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI (≥25 yrs) | 950 | 950 | mg |
| **EFSA** | UL | 2500 | 2500 | mg |
| **WHO** | RNI | 1000 | 1000 | mg |

### 6.2 Phosphorus — `phosphorus`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 550 | 550 | mg |
| **WHO** | — | Not formally set | — | — |

> EFSA derived the AI from a Ca:P molar ratio of 1.4:1. WHO (2004) did not set an independent RNI for phosphorus.

### 6.3 Magnesium — `magnesium`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 350 | 300 | mg |
| **EFSA** | UL (supplements only) | 250 | 250 | mg |
| **WHO** | RNI | 260 | 220 | mg |

> EFSA UL of 250 mg applies only to supplemental/fortified magnesium, not total dietary intake.

### 6.4 Sodium — `sodium`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 2000 | 2000 | mg |
| **WHO** | GUIDELINE_max | 2000 | 2000 | mg |

> WHO: <2000 mg sodium/day (equiv. <5 g salt/day). EFSA AI of 2000 mg; no formal UL set.

### 6.5 Potassium — `potassium`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 3500 | 3500 | mg |
| **WHO** | GUIDELINE_min | 3510 | 3510 | mg |

> WHO (2012 guideline): ≥3510 mg/day for cardiovascular health.

---

## 7. Minerals — Trace Elements

### 7.1 Iron — `iron`

| Authority | Metric | Male | Female | Unit | Notes |
|-----------|--------|------|--------|------|-------|
| **EFSA** | PRI | 11 | 16 | mg | Female value is for premenopausal; postmenopausal = 11 mg |
| **EFSA** | Safe_Level (UL-like) | 40 | 40 | mg | 2024 update; not a formal UL |
| **WHO** | RNI (15% bioavailability) | 9 | 26 | mg | Premenopausal female; highly diet-dependent |
| **WHO** | RNI (12% bioavailability) | 11 | 32 | mg | — |
| **WHO** | RNI (10% bioavailability) | 14 | 39 | mg | — |
| **WHO** | RNI (5% bioavailability) | 27 | 78 | mg | — |

> Iron requirements are extremely bioavailability-dependent. For CSV ingestion, the 15% bioavailability row is the default (typical mixed Western diet).

### 7.2 Zinc — `zinc`

| Authority | Metric | Male | Female | Unit | Notes |
|-----------|--------|------|--------|------|-------|
| **EFSA** | PRI (low phytate, 300 mg/d) | 9.4 | 7.5 | mg | — |
| **EFSA** | PRI (high phytate, 1200 mg/d) | 16.3 | 12.7 | mg | — |
| **EFSA** | UL | 25 | 25 | mg | — |
| **WHO** | RNI (high bioavailability) | 4.2 | 3.0 | mg | — |
| **WHO** | RNI (moderate bioavailability) | 7.0 | 4.9 | mg | — |
| **WHO** | RNI (low bioavailability) | 14.0 | 9.8 | mg | — |

> For CSV ingestion, EFSA low-phytate and WHO high-bioavailability are used as defaults for typical Western diets.

### 7.3 Copper — `copper`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 1.6 | 1.3 | mg |
| **EFSA** | UL | 5 | 5 | mg |
| **WHO** | — | Not formally set (2004) | — | — |

### 7.4 Selenium — `selenium`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 70 | 70 | mcg |
| **EFSA** | UL | 255 | 255 | mcg |
| **WHO** | RNI | 34 | 26 | mcg |

### 7.5 Iodine — `iodine`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | PRI | 150 | 150 | mcg |
| **EFSA** | UL | 600 | 600 | mcg |
| **WHO** | RNI | 150 | 150 | mcg |

### 7.6 Manganese — `manganese`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 3.0 | 3.0 | mg |
| **EFSA** | Safe_Level | 8 | 8 | mg |
| **WHO** | — | Not formally set | — | — |

### 7.7 Fluoride — `fluoride`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 3.4 | 2.9 | mg |
| **EFSA** | UL | 7 | 7 | mg |
| **WHO** | — | Not formally set | — | — |

> EFSA AI is based on 0.05 mg/kg body weight (68 kg male, 58 kg female reference weights).

### 7.8 Molybdenum

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | AI | 65 | 65 | mcg |
| **EFSA** | UL | 600 | 600 | mcg |
| **WHO** | — | Not formally set | — | — |

> Not currently tracked in `digest_nutrient_requirement.csv`. Could be added as a future nutrient_id.

### 7.9 Chromium

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | — | No DRV set | — | — |
| **WHO** | — | Not formally set | — | — |

> EFSA concluded insufficient data to set any DRV. Not tracked in CSV.

---

## 8. Amino Acids (WHO/FAO Scoring Pattern)

WHO/FAO (2007, *Protein and Amino Acid Requirements in Human Nutrition*) established amino acid scoring patterns for adults, expressed as mg per kg body weight per day:

| Amino Acid | `nutrient_id` | WHO Requirement (mg/kg/day) |
|------------|---------------|-----------------------------|
| Histidine | `histidine` | 10 |
| Isoleucine | `isoleucine` | 20 |
| Leucine | `leucine` | 39 |
| Lysine | `lysine` | 30 |
| Methionine + Cystine (SAA) | `methionine` + `cystine` | 15 (combined) |
| Phenylalanine + Tyrosine (AAA) | `phenylalanine` + `tyrosine` | 25 (combined) |
| Threonine | `threonine` | 15 |
| Tryptophan | `tryptophan` | 4 |
| Valine | `valine` | 26 |

> EFSA has not set independent PRI values for individual amino acids. They endorse the WHO/FAO scoring pattern approach.

---

## 9. Sterols & Other Compounds

### 9.1 Cholesterol — `cholesterol`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | GUIDELINE_alap | — | — | as low as possible |
| **WHO** | GUIDELINE | 300 | 300 | mg |

> EFSA: "as low as possible" within a nutritionally adequate diet. WHO maintains the legacy 300 mg/day guideline.

### 9.2 Caffeine — `caffeine`

| Authority | Metric | Male | Female | Unit |
|-----------|--------|------|--------|------|
| **EFSA** | Safe_Level | 400 | 400 | mg |
| **WHO** | — | No formal guideline | — | — |

> EFSA (2015): Single doses up to 200 mg and habitual daily intake of 400 mg do not raise safety concerns for non-pregnant adults.

---

## 10. Key Differences: EFSA vs WHO vs US DRI

| Nutrient | US DRI (RDA/AI) | EFSA (PRI/AI) | WHO (RNI) | Notable Divergence |
|----------|----------------|---------------|-----------|-------------------|
| **Vitamin A** (M) | 900 mcg RAE | 750 mcg RE | 600 mcg RE | WHO lowest |
| **Vitamin C** (M) | 90 mg | 110 mg | 45 mg | WHO significantly lower |
| **Vitamin D** | 15 mcg | 15 mcg (AI) | 5 mcg | WHO outdated |
| **Vitamin B12** | 2.4 mcg | 4.0 mcg (AI) | 2.4 mcg | EFSA highest |
| **Folate** | 400 mcg DFE | 330 mcg DFE | 400 mcg DFE | EFSA lowest |
| **Calcium** | 1000 mg | 950 mg | 1000 mg | EFSA slightly lower |
| **Iron** (F) | 18 mg | 16 mg | 26 mg (15% bioav.) | WHO highest (bioavailability-corrected) |
| **Zinc** (M) | 11 mg | 9.4–16.3 mg | 4.2–14.0 mg | Both EFSA/WHO are diet-dependent |
| **Selenium** | 55 mcg | 70 mcg | 34 mcg | Huge variance; EFSA highest |
| **Magnesium** (M) | 400 mg | 350 mg | 260 mg | WHO lowest |
| **Protein** | 0.8 g/kg | 0.83 g/kg | 10–15 %kcal | WHO uses energy % |

---

## 11. CSV Ingestion Notes

### Recommended `authority` values:
- `EFSA` — European Food Safety Authority
- `WHO` — World Health Organization / FAO

### Recommended `metric` values for new rows:
| Metric | When to use |
|--------|-------------|
| `PRI` | EFSA Population Reference Intake (equivalent to RDA) |
| `AI` | Adequate Intake (both EFSA and WHO) |
| `UL` | Tolerable Upper Intake Level |
| `Safe_Level` | EFSA "safe level of intake" when UL cannot be set (e.g., iron) |
| `RNI` | WHO Recommended Nutrient Intake |
| `Safe_Intake` | WHO "recommended safe intake" (e.g., vitamin A) |
| `RI_low_pct` | EFSA Reference Intake range lower bound |
| `RI_high_pct` | EFSA Reference Intake range upper bound |
| `GUIDELINE_max_pct` | Population-wide max % energy guideline |
| `GUIDELINE_min` | Population-wide minimum absolute guideline |
| `GUIDELINE_max` | Population-wide maximum absolute guideline |
| `GUIDELINE_alap` | "As low as possible" recommendation |
| `PRI_multiplier_per_kg` | Per-kg body weight PRI (protein) |
| `RNI_multiplier_per_kg` | Per-kg body weight RNI (amino acids) |

### Bioavailability-conditional nutrients:
For **iron** and **zinc**, the CSV should use the default assumptions:
- Iron: 15% bioavailability (typical mixed Western diet)
- Zinc: EFSA low-phytate (300 mg/day phytate) / WHO high-bioavailability

Additional bioavailability tiers can be encoded by appending to the `demographic_life_stage` field (e.g., `adult_male_low_bioavail`).

### Nutrients NOT tracked in current CSV that could be added:
| Nutrient | EFSA Value | WHO Value |
|----------|-----------|-----------|
| Biotin (B7) | AI: 40 mcg | Not set |
| Molybdenum | AI: 65 mcg, UL: 600 mcg | Not set |
| Chloride | AI: 3100 mg | Not set |
| Chromium | Not set | Not set |

---

## 12. Source Bibliography

1. **EFSA (2017)** — *Dietary Reference Values for Nutrients: Summary Report*. EFSA Supporting Publication e15121. [efsa.europa.eu](https://www.efsa.europa.eu/en/efsajournal/pub/e14121)
2. **EFSA (2024)** — *Updated Tolerable Upper Intake Levels for Iron, Vitamin B6, Vitamin D, Vitamin E, Manganese, Selenium*. Various Scientific Opinions. [efsa.europa.eu](https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values)
3. **WHO/FAO (2004)** — *Vitamin and Mineral Requirements in Human Nutrition* (2nd edition). ISBN 9241546123. [who.int](https://www.who.int/publications/i/item/9241546123)
4. **WHO/FAO (2007)** — *Protein and Amino Acid Requirements in Human Nutrition*. WHO Technical Report Series 935.
5. **WHO (2012)** — *Guideline: Sodium Intake for Adults and Children*. [who.int](https://www.who.int/publications/i/item/9789241504836)
6. **WHO (2012)** — *Guideline: Potassium Intake for Adults and Children*. [who.int](https://www.who.int/publications/i/item/9789241504829)
7. **WHO (2015)** — *Guideline: Sugars Intake for Adults and Children*. [who.int](https://www.who.int/publications/i/item/9789241549028)
8. **WHO (2023)** — *Total Fat Intake for the Prevention of Unhealthy Weight Gain in Adults and Children*. WHO Guideline.
9. **EFSA (2022)** — *Scientific Opinion on the Tolerable Upper Intake Level for Dietary Sugars*. EFSA Journal.
10. **EFSA (2015)** — *Scientific Opinion on Dietary Reference Values for Phosphorus*. EFSA Journal 13(7):4185.
11. **EFSA (2015)** — *Scientific Opinion on Dietary Reference Values for Iron*. EFSA Journal 13(10):4254.
