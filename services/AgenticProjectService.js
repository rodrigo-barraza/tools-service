// ============================================================
// Agentic Project Service — Workspace Intelligence
// ============================================================
// Extracts project metadata from workspace directories so
// the agent can understand project structure, framework,
// and configuration in a single tool call.
// ============================================================

import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { validatePath } from "./AgenticFileService.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const README_MAX_CHARS = 800;
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_ENTRIES = 200;


// ────────────────────────────────────────────────────────────
// Project Summary
// ────────────────────────────────────────────────────────────

/**
 * Scan a project root and return structured metadata.
 *
 * @param {string} projectPath - Absolute path to the project root
 * @returns {Promise<object>}
 */
export async function agenticProjectSummary(projectPath) {
  const validation = validatePath(projectPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const root = validation.resolved;

  try {
    const stats = await stat(root);
    if (!stats.isDirectory()) {
      return { error: `'${root}' is not a directory` };
    }
  } catch {
    return { error: `Directory not found: ${root}` };
  }

  const result = {
    path: root,
    name: root.split("/").pop(),
  };

  // ── Package.json Analysis ────────────────────────────────
  try {
    const pkgRaw = await readFile(join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw);

    result.packageManager = "npm";
    result.version = pkg.version || null;
    result.description = pkg.description || null;
    result.scripts = pkg.scripts || {};
    result.dependencies = Object.keys(pkg.dependencies || {});
    result.devDependencies = Object.keys(pkg.devDependencies || {});

    // Detect framework from dependencies
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const frameworks = [];
    if (allDeps["next"]) frameworks.push("next.js");
    if (allDeps["react"]) frameworks.push("react");
    if (allDeps["vue"]) frameworks.push("vue");
    if (allDeps["svelte"]) frameworks.push("svelte");
    if (allDeps["express"]) frameworks.push("express");
    if (allDeps["fastify"]) frameworks.push("fastify");
    if (allDeps["vite"]) frameworks.push("vite");
    if (allDeps["@angular/core"]) frameworks.push("angular");

    result.frameworks = frameworks;
    result.type = pkg.type || "commonjs";
  } catch {
    // Not a Node.js project — check for Python
    try {
      await stat(join(root, "pyproject.toml"));
      result.packageManager = "python (pyproject.toml)";
    } catch {
      try {
        await stat(join(root, "requirements.txt"));
        result.packageManager = "python (pip)";
      } catch {
        result.packageManager = null;
      }
    }
  }

  // ── README ───────────────────────────────────────────────
  for (const name of ["README.md", "readme.md", "README.txt", "README"]) {
    try {
      const content = await readFile(join(root, name), "utf-8");
      result.readme = content.length > README_MAX_CHARS
        ? content.slice(0, README_MAX_CHARS) + "\n... [truncated]"
        : content;
      break;
    } catch {
      // Try next
    }
  }

  // ── Directory Structure ──────────────────────────────────
  const structure = {};
  let totalFiles = 0;
  let totalDirs = 0;

  async function scanDir(dir, depth) {
    if (depth > MAX_SCAN_DEPTH || totalFiles + totalDirs > MAX_SCAN_ENTRIES) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (totalFiles + totalDirs > MAX_SCAN_ENTRIES) break;

        // Skip non-essential dirs
        if (entry.name === "node_modules" || entry.name === ".git" ||
            entry.name === ".next" || entry.name === "__pycache__" ||
            entry.name === "dist" || entry.name === "build" ||
            entry.name === ".cache") {
          continue;
        }

        const relPath = relative(root, resolve(dir, entry.name));

        if (entry.isDirectory()) {
          totalDirs++;
          // Count children
          try {
            const children = await readdir(resolve(dir, entry.name));
            structure[relPath + "/"] = children.length;
          } catch {
            structure[relPath + "/"] = 0;
          }
          await scanDir(resolve(dir, entry.name), depth + 1);
        } else {
          totalFiles++;
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  await scanDir(root, 0);
  result.structure = structure;
  result.totalFiles = totalFiles;
  result.totalDirectories = totalDirs;

  // ── Entry Points ─────────────────────────────────────────
  const entryPoints = [];
  const candidates = [
    "src/app/layout.js", "src/app/layout.tsx", "src/app/page.js", "src/app/page.tsx",
    "src/index.js", "src/index.ts", "src/index.tsx",
    "src/main.js", "src/main.ts",
    "index.js", "index.ts", "server.js", "app.js",
    "main.py", "app.py",
  ];

  for (const candidate of candidates) {
    try {
      await stat(join(root, candidate));
      entryPoints.push(candidate);
    } catch {
      // Not found
    }
  }
  result.entryPoints = entryPoints;

  // ── Config Files ─────────────────────────────────────────
  const configFiles = [];
  const configCandidates = [
    "tsconfig.json", "jsconfig.json", ".eslintrc.js", "eslint.config.js",
    ".prettierrc", ".prettierrc.js", "prettier.config.js",
    "next.config.js", "next.config.mjs", "vite.config.js",
    "tailwind.config.js", "postcss.config.js",
    ".gitignore", "Dockerfile", "docker-compose.yml",
    "Makefile", ".env.example", "secrets.example.js",
  ];

  for (const name of configCandidates) {
    try {
      await stat(join(root, name));
      configFiles.push(name);
    } catch {
      // Not found
    }
  }
  result.configFiles = configFiles;

  return result;
}
