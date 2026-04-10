const fs = require('fs');

const csv = fs.readFileSync('/home/rodrigo/development/sun/digest/database/data/digest_nutrient.csv', 'utf8');
const lines = csv.split('\n').filter(Boolean);

let aminoAcids = [];
let carbohydrates = [];
let fats = [];
let vitamins = [];
let minerals = [];
let sterols = [];
let other = [];

// Skip header
for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 8) continue;
    const id = cols[0];
    const name = cols[2] !== '' ? cols[2] : id.replace(/_/g, ' ');
    const type = cols[7];
    
    let line = `| **${name}** (\`${id}\`) | All | [Pending Extraction] | [Pending Extraction] | [Pending Extraction] |`;
    
    if (type.includes('amino acid')) {
        aminoAcids.push(line);
    } else if (type.includes('carbohydrate') || name.toLowerCase().includes('fructose') || name.toLowerCase().includes('sugar') || name.toLowerCase().includes('fiber')) {
        carbohydrates.push(line);
    } else if (type.includes('fatty acid') || type.includes('fat') || name.toLowerCase().includes('fat') || id.startsWith('c0') || id.startsWith('c1') || id.startsWith('c2')) {
        fats.push(line);
    } else if (type.includes('vitamin') || id.includes('tocopherol') || id.includes('carotene') || id.includes('calciferol') || id.includes('folic') || id.includes('retinol') || id.includes('riboflavin') || id.includes('thiamin') || id.includes('niacin') || id.includes('phylloquinone') || id.includes('menaquinone') || id.includes('lutein') || id.includes('lycopene') || id.includes('choline') || id.includes('cobalamin') || id.includes('folate')) {
        vitamins.push(line);
    } else if (type.includes('mineral') || ['calcium', 'copper', 'fluoride', 'iron', 'magnesium', 'manganese', 'phosphorus', 'potassium', 'selenium', 'sodium', 'zinc'].includes(id)) {
        minerals.push(line);
    } else if (type.includes('sterol') || id.includes('sterol') || id.includes('cholesterol')) {
        sterols.push(line);
    } else {
        if (!['lipid', 'carbohydrate', 'protein', 'mineral'].includes(id)) {
             other.push(line);
        }
    }
}

const md = `## 5. Extracted Numeric Requirements (Comprehensive Digest Mapping)

*(Note: Data extraction fetchers will populate the [Pending Extraction] fields based on the respective standard definitions. If a standard does not define a requirement, it will be marked "Not Mandated" or "As low as possible")*

### 5.1 Carbohydrates & Sugars
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
${carbohydrates.join('\n')}

### 5.2 Amino Acids
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
${aminoAcids.join('\n')}

### 5.3 Detailed Lipids & Fatty Acids
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
${fats.join('\n')}

### 5.4 Vitamers & Vitamins
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
${vitamins.join('\n')}

### 5.5 Minerals & Trace Elements
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
${minerals.join('\n')}

### 5.6 Sterols & Other Compounds
| Nutrient & Key | Demographic | US/AAFCO/NRC | EU/FEDIAF | Global/WHO/Other |
|----------------|-------------|--------------|-----------|------------------|
${sterols.join('\n')}
${other.join('\n')}
`;

fs.writeFileSync('/home/rodrigo/development/sun/tools-api/scratch_tables.md', md);
