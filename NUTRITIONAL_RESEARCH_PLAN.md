# Comprehensive Nutritional Requirements Research Plan

## Objective
To aggregate, normalize, and document the precise nutritional requirements (micro and macronutrients) for the average adult male and female, strictly integrating global standards.

## 1. Demographic Baseline
- **Target Audience:** Average healthy adult male and female.
- **Age Bracket:** 19–50 years old (to exclude adolescents and senior-specific variations).
- **Exclusions:** Pregnancy, lactation, and clinical morbidities.

## 2. Scope of Nutrients

### Macronutrients
| Nutrient | Category | Target Metrics |
|----------|----------|----------------|
| **Protein** | Essential | Total g/day, Essential Amino Acids, % AMDR |
| **Fats** | Energy/Structural | Saturated (%), MUFA (%), PUFA (%), Omega-3, Omega-6, Trans (%) |
| **Carbohydrates** | Energy | Total g/day, Dietary Fiber, Free/Added Sugars (%), % AMDR |
| **Water** | Hydration | Total liters/day |

### Micronutrients (Vitamins)
| Nutrient | Type | Target Metrics (Unit) |
|----------|------|-----------------------|
| Vitamin A | Fat-Soluble | mcg RAE |
| Vitamin C | Water-Soluble | mg |
| Vitamin D | Fat-Soluble | mcg (or IU converted) |
| Vitamin E | Fat-Soluble | mg alpha-tocopherol |
| Vitamin K | Fat-Soluble | mcg |
| B1 (Thiamine) | Water-Soluble | mg |
| B2 (Riboflavin) | Water-Soluble | mg |
| B3 (Niacin) | Water-Soluble | mg NE |
| B5 (Pantothenic Acid) | Water-Soluble | mg |
| B6 | Water-Soluble | mg |
| B7 (Biotin) | Water-Soluble | mcg |
| B9 (Folate) | Water-Soluble | mcg DFE |
| B12 (Cobalamin) | Water-Soluble | mcg |

### Minerals & Trace Elements
| Nutrient | Category | Target Metrics (Unit) |
|----------|----------|-----------------------|
| Calcium | Macromineral | mg |
| Phosphorus | Macromineral | mg |
| Magnesium | Macromineral | mg |
| Sodium | Macromineral | mg |
| Potassium | Macromineral | mg |
| Chloride | Macromineral | mg |
| Iron | Trace Mineral | mg |
| Zinc | Trace Mineral | mg |
| Iodine | Trace Mineral | mcg |
| Selenium | Trace Mineral | mcg |
| Copper | Trace Mineral | mcg |
| Manganese | Trace Mineral | mg |
| Fluoride | Trace Mineral | mg |

## 3. Targeted Global Standards

This research will extract precise figures from three primary global health authorities. For each nutrient, we must establish the base requirement and upper toxicity limits (where applicable).

1. **US Dietary Reference Intakes (DRIs) - NIH & National Academies**
   - **RDA:** Recommended Dietary Allowance (covers 97-98% pop.)
   - **AI:** Adequate Intake (used when RDA isn't available)
   - **UL:** Tolerable Upper Intake Level

2. **EU Dietary Reference Values (DRVs) - EFSA**
   - **PRI:** Population Reference Intake (equivalent to US RDA)
   - **AI:** Adequate Intake
   - **UL:** Tolerable Upper Intake Level

3. **Global Guidelines (WHO/FAO)**
   - **RNI:** Recommended Nutrient Intake
   - **Upper Limits:** Where uniquely specified globally

4. **Additional Regional Authorities (For scalable plug-and-play)**
   - **UK SACN:** RNI (Reference Nutrient Intake) and Safe Intakes.
   - **Australia/NZ NRV (NHMRC):** RDI (Recommended Dietary Intake) and SDT (Suggested Dietary Target for chronic disease prevention).
   - **Japan DRIs (MHLW):** RDA, AI, and precise DG (Dietary Goals to avoid lifestyle diseases).

5. **Cross-Species Expansion (Future-Proofing)**
   - To support pets or livestock natively, we will adopt models from authorities like **AAFCO** (Association of American Feed Control Officials) and **NRC** (National Research Council), measuring typically via Dry Matter (DM) or kg-metabolic-weight minimums.

## 4. Proposed Database Architecture
Once the values are fully extracted and standardized under section 5, the data will be seeded into `tools-api` using the following generic JSON structure.

```json
{
  "nutrientId": "vitamin_d",
  "name": "Vitamin D",
  "type": "micronutrient",
  "subType": "vitamin_fat_soluble",
  "unit": "mcg",
  "species": "human",
  "requirements": {
    "adult_male": {
      "US_DRI": { "RDA": 15, "UL": 100 },
      "EFSA": { "AI": 15, "UL": 100 },
      "WHO": { "RNI": 5 },
      "UK_SACN": { "RNI": 10 },
      "AUS_NZ_NRV": { "AI": 5, "UL": 80 },
      "JAPAN_DRI": { "AI": 8.5 }
    },
    "adult_female": {
      "US_DRI": { "RDA": 15, "UL": 100 },
      "EFSA": { "AI": 15, "UL": 100 },
      "WHO": { "RNI": 5 },
      "UK_SACN": { "RNI": 10 },
      "AUS_NZ_NRV": { "AI": 5, "UL": 80 },
      "JAPAN_DRI": { "AI": 8.5 }
    }
  }
}
```

*Example for Cross-Species Plug-and-Play (e.g., Dog):*
```json
{
  "nutrientId": "vitamin_d",
  "name": "Vitamin D",
  "type": "micronutrient",
  "subType": "vitamin_fat_soluble",
  "unit": "mcg",
  "species": "canine",
  "requirements": {
    "adult_maintenance": {
      "AAFCO": { "minimum_DM": 12.5, "maximum_DM": 75 },
      "NRC": { "recommended": 13.6 }
    }
  }
}
```

## 5. Extracted Numeric Requirements (Comprehensive Digest Mapping)

*(Note: Data extraction fetchers will populate the [Pending Extraction] fields based on the respective standard definitions. If a standard does not define a requirement, it will be marked "Not Mandated" or "As low as possible")*

### 5.1 Carbohydrates & Sugars
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
| **fiber** (`fiber`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **fructose** (`fructose`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **galactose** (`galactose`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **glucose** (`glucose`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **lactose** (`lactose`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **maltose** (`maltose`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **starch** (`starch`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **sucrose** (`sucrose`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **sugar** (`sugar`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |

### 5.2 Amino Acids
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
| **alanine** (`alanine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **arginine** (`arginine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **aspartic acid** (`aspartic_acid`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **betaine** (`betaine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **cystine** (`cystine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **glutamic acid** (`glutamic_acid`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **glycine** (`glycine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **histidine** (`histidine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **hydroxyproline** (`hydroxyproline`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **isoleucine** (`isoleucine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **leucine** (`leucine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **lysine** (`lysine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **methionine** (`methionine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **phenylalanine** (`phenylalanine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **proline** (`proline`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **serine** (`serine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **threonine** (`threonine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **tryptophan** (`tryptophan`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **tyrosine** (`tyrosine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **valine** (`valine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |

### 5.3 Detailed Lipids & Fatty Acids
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
| **saturated fat** (`saturated_fat`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **trans fat** (`trans_fat`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **trans monoenoic fat** (`trans_monoenoic_fat`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **trans polyenoic fat** (`trans_polyenoic_fat`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Butyric acid** (`c04_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Caproic acid** (`c06_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Caprylic acid** (`c08_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **capric acid** (`c10_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **lauric acid** (`c12_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Tridecylic acid** (`c13_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **myristic acid** (`c14_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Myristoleic Acid** (`c14_d1`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Pentadecylic acid** (`c15_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Ginkgolic acid ** (`c15_d1`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **palmitic acid** (`c16_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **palmitoleic acid** (`c16_d1_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **palmitelaidic acid ** (`c16_d1_trans`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **hexadecenoic acid** (`c16_d1_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **margaric acid** (`c17_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **heptadecenoic acid** (`c17_d1`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Stearidonic acid** (`c18_d4`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **stearic acid** (`c18_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **octadecenoic acid** (`c18_d1_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **oleic acid** (`c18_d1_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **elaidic acid** (`c18_d1_trans`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **conjugated linoleic acid** (`c18_d2_cla`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **octadecadienoic acid (mixed isomers)** (`c18_d2_mixed`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **linoleic acid** (`c18_d2_n6_cis_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **rumenic acid** (`c18_d2_trans`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **linolelaidic acid** (`c18_d2_trans_trans`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **octadecadienoic acid** (`c18_d2_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **octadecatrienoic acid (mixed isomers)** (`c18_d3_i`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **alpha-linolenic acid** (`c18_d3_n3_cis_cis_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **gamma-linolenic acid** (`c18_d3_n6_cis_cis_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **octadecatrienoic acid** (`c18_d3_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **arachidic acid** (`c20_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Eicosenoic acid** (`c20_d1`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Eicosadienoic acid** (`c20_d2_n6_cis_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Eicosatrienoic acid** (`c20_d3_n3`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Dihomo-gamma-linolenic acid** (`c20_d3_n6`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **eicosatrienoic acid** (`c20_d3_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Arachidonic acid ** (`c20_d4_n6`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **eicosatetraenoic acid** (`c20_d4_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Eicosapentaenoic acid** (`c20_d5_n3`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Heneicosapentaenoic acid** (`c21_d5_n3`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **behenic acid** (`c22_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **erucic acid** (`c22_d1_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **brassidic acid** (`c22_d1_trans`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **docosenoic acid** (`c22_d1_undifferentiated`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Adrenic acid** (`c22_d4`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Docosapentaenoic acid** (`c22_d5_n3`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Docosahexaenoic acid** (`c22_d6_n3`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **lignoceric acid** (`c24_d0`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **Nervonic acid** (`c24_d1_cis`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **monounsaturated fat** (`monounsaturated_fat`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **polyunsaturated fat** (`polyunsaturated_fat`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |

### 5.4 Vitamers & Vitamins
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
| **vitamin a (alpha carotene)** (`alpha_carotene`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (alpha tocopherol)** (`alpha_tocopherol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (alpha tocotrienol)** (`alpha_tocotrienol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin c (ascorbic acid)** (`ascorbic_acid`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin a (beta carotene)** (`beta_carotene`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin a (beta cryptoxanthin)** (`beta_cryptoxanthin`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (beta tocopherol)** (`beta_tocopherol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (beta tocotrienol)** (`beta_tocotrienol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin d3 (cholecalciferol)** (`cholecalciferol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b4 (choline)** (`choline`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b12 (cyanocobalamin)** (`cyanocobalamin`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (delta tocopherol)** (`delta_tocopherol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (delta tocotrienol)** (`delta_tocotrienol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin k hydrogenated (dihydrophylloquinone)** (`dihydrophylloquinone`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin d2 (ergocalciferol)** (`ergocalciferol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b9 (folate)** (`folate`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b9 (folic acid)** (`folic_acid`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (gamma tocopherol)** (`gamma_tocopherol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin e (gamma tocotrienol)** (`gamma_tocotrienol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **lutein and zeaxanthin** (`lutein_and_zeaxanthin`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **lycopene** (`lycopene`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin k2 (menaquinone-4)** (`menaquinone_4`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin k1 (phylloquinone)** (`phylloquinone`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin a (retinol)** (`retinol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b2 (riboflavin)** (`riboflavin`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b1 (thiamin)** (`thiamin`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin a (all vitamers)** (`vitamin_a`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b3 (niacin)** (`niacin`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b5 (pantothenic acid)** (`vitamin_b5`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin d (all vitamers)** (`vitamin_d`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |

### 5.5 Minerals & Trace Elements
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
| **calcium** (`calcium`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **copper** (`copper`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **fluoride** (`fluoride`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **iron** (`iron`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **magnesium** (`magnesium`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **manganese** (`manganese`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **phosphorus** (`phosphorus`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **potassium** (`potassium`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **selenium** (`selenium`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **sodium** (`sodium`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **zinc** (`zinc`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |

### 5.6 Sterols & Other Compounds
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
| **beta sitosterol** (`beta_sitosterol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **campesterol** (`campesterol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **cholesterol** (`cholesterol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **phytosterol** (`phytosterol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **stigmasterol** (`stigmasterol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **ethanol** (`ethanol`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **caffeine** (`caffeine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **theobromine** (`theobromine`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **vitamin b6 (all vitamers)** (`vitamin_b6`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
| **water** (`water`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |
