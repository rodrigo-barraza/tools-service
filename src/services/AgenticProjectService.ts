// ─── Workspace Intelligence ─────────────────────────────────

import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { validatePath } from "./AgenticFileService.ts";
import { resolveAndRouteToAgent, sendRpc } from "./AgentConnectionManager.ts";
import { errorMessage } from "../utilities.ts";
import { WORKSPACE_SKIP_DIRECTORIES } from "@rodrigo-barraza/utilities-library";
import type { ProjectSummaryResult } from "@rodrigo-barraza/utilities-library";
export type { ProjectSummaryResult };

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const README_MAX_CHARS = 800;
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_ENTRIES = 200;

/**
 * Richer result shape. The library type doesn't yet model these fields, so we
 * widen locally rather than misreport (e.g. hardcoded "npm") or drop signal
 * (partial scan counts presented as totals).
 */
type ExtendedProjectSummary = ProjectSummaryResult & {
  packageJsonError?: string;
  packageManagerDeclared?: string;
  truncated?: boolean;
  scanLimitReached?: boolean;
};

/**
 * Determine the package manager from lockfiles (authoritative for what's
 * actually installed), falling back to a declared `packageManager` field, then
 * npm. The workspace default is pnpm, so a hardcoded "npm" is actively harmful.
 */
async function detectPackageManager(
  root: string,
  declared?: string,
): Promise<string> {
  const lockfiles: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, manager] of lockfiles) {
    try {
      await stat(join(root, file));
      return manager;
    } catch {
      // Try next lockfile
    }
  }
  if (declared) {
    // e.g. "pnpm@9.1.0" → "pnpm"
    return declared.split("@")[0] || declared;
  }
  return "npm";
}

// ────────────────────────────────────────────────────────────
// Project Summary
// ────────────────────────────────────────────────────────────



/**
 * Scan a project root and return structured metadata.
 */
export async function agenticProjectSummary(
  projectPath: string,
): Promise<ExtendedProjectSummary> {
  // Agent routing
  const agent = resolveAndRouteToAgent(projectPath);
  if (agent) {
    try {
      return (await sendRpc(agent.id, "project.summary", {
        path: projectPath,
      })) as ProjectSummaryResult;
    } catch (error: unknown) {
      return { error: `Agent RPC failed: ${errorMessage(error)}` };
    }
  }

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

  const result: ExtendedProjectSummary = {
    path: root,
    name: root.split("/").pop(),
  };

  // ── Package.json Analysis ────────────────────────────────
  // Read and parse are handled separately: a MISSING package.json means "not a
  // Node project" (probe Python), but a PRESENT-but-malformed one is still a
  // Node project — reporting it as python/unknown would be a lie.
  let pkgRaw: string | null;
  try {
    pkgRaw = await readFile(join(root, "package.json"), "utf-8");
  } catch {
    pkgRaw = null;
  }

  if (pkgRaw !== null) {
    let packageJson: Record<string, unknown> | null = null;
    try {
      packageJson = JSON.parse(pkgRaw);
    } catch (error: unknown) {
      // Malformed package.json — surface the parse error but keep classifying
      // this as a Node project.
      result.packageJsonError = errorMessage(error);
    }

    const declared =
      packageJson && typeof packageJson.packageManager === "string"
        ? (packageJson.packageManager as string)
        : undefined;
    result.packageManager = await detectPackageManager(root, declared);
    if (declared) result.packageManagerDeclared = declared;

    if (packageJson) {
      result.version = (packageJson.version as string) || null;
      result.description = (packageJson.description as string) || null;
      result.scripts = (packageJson.scripts as Record<string, string>) || {};
      result.dependencies = Object.keys(
        (packageJson.dependencies as Record<string, string>) || {},
      );
      result.devDependencies = Object.keys(
        (packageJson.devDependencies as Record<string, string>) || {},
      );

      // Detect framework from dependencies
      const allDeps: Record<string, string> = {
        ...((packageJson.dependencies as Record<string, string>) || {}),
        ...((packageJson.devDependencies as Record<string, string>) || {}),
      };
      const frameworks: string[] = [];
      if (allDeps["next"]) frameworks.push("next.js");
      if (allDeps["react"]) frameworks.push("react");
      if (allDeps["vue"]) frameworks.push("vue");
      if (allDeps["svelte"]) frameworks.push("svelte");
      if (allDeps["express"]) frameworks.push("express");
      if (allDeps["fastify"]) frameworks.push("fastify");
      if (allDeps["vite"]) frameworks.push("vite");
      if (allDeps["@angular/core"]) frameworks.push("angular");

      result.frameworks = frameworks;
      result.type = (packageJson.type as string) || "commonjs";
    }
  } else {
    // No package.json — check for Python
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
      result.readme =
        content.length > README_MAX_CHARS
          ? content.slice(0, README_MAX_CHARS) + "\n... [truncated]"
          : content;
      break;
    } catch {
      // Try next
    }
  }

  // ── Directory Structure ──────────────────────────────────
  const structure: Record<string, number> = {};
  let totalFiles = 0;
  let totalDirs = 0;
  // Set when a cap stopped the walk before it finished — so the counts below
  // are known to be partial, not project totals.
  let scanLimitReached = false;

  async function scanDir(dir: string, depth: number) {
    if (totalFiles + totalDirs > MAX_SCAN_ENTRIES) {
      scanLimitReached = true;
      return;
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (totalFiles + totalDirs > MAX_SCAN_ENTRIES) {
          scanLimitReached = true;
          break;
        }

        // Skip non-essential dirs
        if (WORKSPACE_SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }

        const relativePath = relative(root, resolve(dir, entry.name));

        if (entry.isDirectory()) {
          totalDirs++;
          // Count children
          let childCount = 0;
          try {
            const children = await readdir(resolve(dir, entry.name));
            childCount = children.length;
            structure[relativePath + "/"] = childCount;
          } catch {
            structure[relativePath + "/"] = 0;
          }
          if (depth + 1 > MAX_SCAN_DEPTH) {
            // Depth cap: children of this directory are not walked, so any
            // non-empty directory at the boundary means counts are partial.
            if (childCount > 0) scanLimitReached = true;
          } else {
            await scanDir(resolve(dir, entry.name), depth + 1);
          }
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
  if (scanLimitReached) {
    result.truncated = true;
    result.scanLimitReached = true;
  }

  // ── Entry Points ─────────────────────────────────────────
  const entryPoints: string[] = [];
  const candidates = [
    "src/app/layout.js",
    "src/app/layout.tsx",
    "src/app/page.js",
    "src/app/page.tsx",
    "src/index.js",
    "src/index.ts",
    "src/index.tsx",
    "src/main.js",
    "src/main.ts",
    "index.js",
    "index.ts",
    "server.js",
    "app.js",
    "main.py",
    "app.py",
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
  const configFiles: string[] = [];
  const configCandidates = [
    "tsconfig.json",
    "jsconfig.json",
    ".eslintrc.js",
    "eslint.config.js",
    ".prettierrc",
    ".prettierrc.js",
    "prettier.config.js",
    "next.config.js",
    "next.config.mjs",
    "vite.config.js",
    "tailwind.config.js",
    "postcss.config.js",
    ".gitignore",
    "Dockerfile",
    "docker-compose.yml",
    "Makefile",
    ".env.example",
    "secrets.example.js",
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
