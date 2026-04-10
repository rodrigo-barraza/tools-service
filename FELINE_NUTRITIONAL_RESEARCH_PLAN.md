# Feline Comprehensive Nutritional Requirements Research Plan

## Objective
To aggregate, normalize, and document the precise nutritional requirements (micro and macronutrients) for the average adult domestic cat, strictly integrating global veterinary and pet food industry standards.

## 1. Demographic Baseline
- **Target Audience:** Average healthy adult cat (Feline).
- **Life Stage:** Adult Maintenance (excluding kittens/growth, pregnancy, and lactation).
- **Nuance by Weight vs. Energy:** Unlike humans, feline nutritional requirements are typically standardized relative to the metabolic energy of the diet (per 1,000 kcal of Metabolizable Energy [ME]) or per kg of Dry Matter (DM) diet, rather than purely by kg of body weight. Energy needs themselves are scaled by "Metabolic Body Weight" (BW^0.67). We will document the requirements per 1,000 kcal ME for best precision, alongside reference adult weights (e.g., 4kg - 5kg averages).

## 2. Scope of Nutrients

### Macronutrients & Amino Acids
| Nutrient | Category | Target Metrics |
|----------|----------|----------------|
| **Protein (Total)** | Essential | g / 1000 kcal ME, Minimum % Dry Matter |
| **Arginine** | Essential Amino Acid | g / 1000 kcal ME |
| **Taurine** | Essential Amino Acid | g / 1000 kcal ME (crucial for obligate carnivores) |
| **Methionine + Cystine** | Essential Amino Acid | g / 1000 kcal ME |
| **Total Fat** | Energy/Structural| g / 1000 kcal ME |
| **Linoleic Acid** | Essential Fatty Acid| g / 1000 kcal ME |
| **Arachidonic Acid** | Essential Fatty Acid| g / 1000 kcal ME |
| **Carbohydrates** | Energy | (Felines have no strict minimum biological requirement) |
| **Water** | Hydration | ml per kcal ingested / daily volume |

### Micronutrients (Vitamins)
| Nutrient | Type | Target Metrics (Unit per 1000 kcal ME) |
|----------|------|--------------------------------------|
| Vitamin A | Fat-Soluble | IU or RAE |
| Vitamin D | Fat-Soluble | IU or mcg |
| Vitamin E | Fat-Soluble | IU or mg |
| Vitamin K | Fat-Soluble | mg (Usually synthesized by gut bacteria, but noted) |
| Thiamine (B1) | Water-Soluble | mg |
| Riboflavin (B2) | Water-Soluble | mg |
| Niacin (B3) | Water-Soluble | mg |
| Pantothenic Acid (B5) | Water-Soluble | mg |
| Pyridoxine (B6) | Water-Soluble | mg |
| Folic Acid (B9) | Water-Soluble | mg |
| Cobalamin (B12) | Water-Soluble | mg |
| Choline | Water-Soluble | mg |

### Minerals & Trace Elements
| Nutrient | Category | Target Metrics (Unit per 1000 kcal ME) |
|----------|----------|----------------------------------------|
| Calcium | Macromineral | g |
| Phosphorus | Macromineral | g |
| Potassium | Macromineral | g |
| Sodium | Macromineral | g |
| Chloride | Macromineral | g |
| Magnesium | Macromineral | g |
| Iron | Trace Mineral | mg |
| Copper | Trace Mineral | mg |
| Manganese | Trace Mineral | mg |
| Zinc | Trace Mineral | mg |
| Iodine | Trace Mineral | mg |
| Selenium | Trace Mineral | mg |

## 3. Targeted Global Standards

This research will extract precise figures from three primary global guidelines:

1. **NRC (National Research Council) - 2006**
   - Offers the strictest scientific base using purified diets. Provides Minimal Requirement (MR), Adequate Intake (AI), Recommended Allowance (RA), and Safe Upper Limit (SUL). We will target **RA**.

2. **AAFCO (Association of American Feed Control Officials) - US Standard**
   - Formulated for commercial diets considering ingredient digestibility. Provides Minimums and Maximums.

3. **FEDIAF (European Pet Food Industry Federation) - EU Standard**
   - Provides comprehensive, frequently updated nutritional guidelines for commercial pet foods. Provides Minimum Recommendations and Nutritional Maximums.

## 4. Proposed Database Architecture
The data will be structured in JSON for insertion into `tools-api`. Since feline requirements do not drastically diverge by gender (unlike human RDAs), but do pivot strictly around energy density, the structure will reflect this distinction.

```json
{
  "nutrientId": "taurine",
  "name": "Taurine",
  "type": "macronutrient",
  "subType": "amino_acid",
  "unit": "g_per_1000_kcal",
  "requirements": {
    "adult_maintenance": {
      "NRC": { "RA": 0.1, "SUL": null },
      "AAFCO": { "MIN": 0.25 /* Dry */, "MAX": null },
      "FEDIAF": { "MIN": 0.50, "MAX": null }
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
