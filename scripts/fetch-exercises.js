import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const url = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
  console.log(`Downloading exercises from ${url}...`);
  const response = await fetch(url);
  const data = await response.json();

  console.log(`Downloaded ${data.length} exercises.`);

  const outputPath = path.join(
    __dirname,
    "../fetchers/health/data/digest_exercises.csv"
  );

  const headers = [
    "id",
    "name",
    "force",
    "level",
    "mechanic",
    "equipment",
    "category",
    "primary_muscles",
    "secondary_muscles",
    "instructions"
  ];

  function escapeCSV(val) {
    if (val === null || val === undefined) return "";
    let str = String(val);
    if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  const lines = [headers.join(",")];

  for (const ex of data) {
    const row = [
      escapeCSV(ex.id),
      escapeCSV(ex.name),
      escapeCSV(ex.force),
      escapeCSV(ex.level),
      escapeCSV(ex.mechanic),
      escapeCSV(ex.equipment),
      escapeCSV(ex.category),
      escapeCSV((ex.primaryMuscles || []).join("|")),
      escapeCSV((ex.secondaryMuscles || []).join("|")),
      escapeCSV((ex.instructions || []).join(" "))
    ];
    lines.push(row.join(","));
  }

  fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(`Wrote ${lines.length - 1} exercises to ${outputPath}`);
}

main().catch(console.error);
