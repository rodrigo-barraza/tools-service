// ─── Atomic Commit Splitting ────────────────────────────────
// Given a dirty worktree, group the changed files into independent commit
// sets and propose ordered commits; on confirm, execute them with `git -C`.
// Two-step propose/confirm — never auto-commits on the first call.
//
// Grouping heuristics (pure, unit-tested):
//   1. Import/require edges between changed files → connected components.
//   2. Remaining singletons merge with changed files in the same directory.
//   3. Source commits are ordered before test-only, then docs-only commits.
//   4. Lockfiles are excluded from analysis and appended to the commit that
//      carries their manifest (package.json → pnpm-lock.yaml, etc.).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { validatePath } from "./AgenticFileService.ts";
import logger from "../logger.ts";

// ── git runner ───────────────────────────────────────────────

interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", ["-C", cwd, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) =>
      resolvePromise({ code: code ?? 1, stdout, stderr }),
    );
    child.on("error", (spawnError) =>
      resolvePromise({ code: 127, stdout: "", stderr: spawnError.message }),
    );
  });
}

// ── Classification ───────────────────────────────────────────

export type FileKind = "source" | "test" | "docs" | "lockfile";

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
]);

/** Manifest whose commit a given lockfile should ride with. */
const LOCKFILE_TO_MANIFEST: Record<string, string[]> = {
  "package-lock.json": ["package.json"],
  "pnpm-lock.yaml": ["package.json"],
  "yarn.lock": ["package.json"],
  "bun.lockb": ["package.json"],
  "Cargo.lock": ["Cargo.toml"],
  "poetry.lock": ["pyproject.toml"],
  "uv.lock": ["pyproject.toml"],
  "Pipfile.lock": ["Pipfile"],
  "composer.lock": ["composer.json"],
  "Gemfile.lock": ["Gemfile"],
  "go.sum": ["go.mod"],
};

export function classifyFile(relativePath: string): FileKind {
  const name = basename(relativePath);
  if (LOCKFILE_NAMES.has(name)) return "lockfile";
  if (
    /(^|\/)__tests__\//.test(relativePath) ||
    /(^|\/)tests?\//.test(relativePath) ||
    /\.(test|spec)\.[jt]sx?$/.test(name) ||
    /_test\.(go|py|rs)$/.test(name) ||
    /^test_.*\.py$/.test(name)
  ) {
    return "test";
  }
  if (/\.(md|mdx|rst|txt)$/i.test(name) || /(^|\/)docs?\//.test(relativePath)) {
    return "docs";
  }
  return "source";
}

// ── Import extraction ────────────────────────────────────────

const IMPORT_PATTERNS = [
  /import\s[^'"]*['"]([^'"]+)['"]/g, // ES imports
  /require\(\s*['"]([^'"]+)['"]\s*\)/g, // CJS
  /from\s+([\w.]+)\s+import\s/g, // Python
  /^\s*import\s+([\w.]+)\s*$/gm, // Python bare import
];

/** Extract raw import specifiers from file content (JS/TS/Python-ish). */
export function extractImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/**
 * Resolve a specifier from `importer` to a repo-relative changed file, if it
 * names one. Handles relative JS/TS paths (with or without extension) and
 * dotted Python modules.
 */
function resolveSpecifier(
  importer: string,
  specifier: string,
  changedSet: Set<string>,
): string | null {
  if (specifier.startsWith(".")) {
    const base = join(dirname(importer), specifier).replace(/\\/g, "/");
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      `${base}.py`,
      base.replace(/\.(js|mjs)$/, ".ts"),
      `${base}/index.ts`,
      `${base}/index.js`,
      `${base}/__init__.py`,
    ];
    for (const candidate of candidates) {
      const normalized = candidate.replace(/\/\.\//g, "/");
      if (changedSet.has(normalized)) return normalized;
    }
    return null;
  }
  // Python dotted module → path
  if (/^[\w.]+$/.test(specifier) && specifier.includes(".")) {
    const asPath = specifier.replace(/\./g, "/");
    for (const candidate of [`${asPath}.py`, `${asPath}/__init__.py`]) {
      if (changedSet.has(candidate)) return candidate;
    }
  }
  return null;
}

// ── Grouping (pure, unit-tested) ─────────────────────────────

export interface ChangedFileInfo {
  /** Repo-relative path. */
  path: string;
  /** Porcelain status, e.g. "M", "A", "D", "??". */
  status: string;
  kind: FileKind;
}

export interface CommitGroup {
  files: string[];
  kinds: FileKind[];
  message: string;
}

interface UnionFind {
  find(item: string): string;
  union(a: string, b: string): void;
}

function createUnionFind(items: string[]): UnionFind {
  const parent = new Map<string, string>(items.map((item) => [item, item]));
  function find(item: string): string {
    let root = item;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(item, root);
    return root;
  }
  return {
    find,
    union(a: string, b: string) {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootB, rootA);
    },
  };
}

function summarizeFiles(files: string[]): string {
  const names = files.map((file) => basename(file).replace(/\.[^.]+$/, ""));
  const shown = [...new Set(names)].slice(0, 3).join(", ");
  const extra = names.length > 3 ? ` (+${names.length - 3} more)` : "";
  return `${shown}${extra}`;
}

function groupMessage(files: string[], kinds: FileKind[]): string {
  const kindSet = new Set(kinds);
  if (kindSet.size === 1 && kindSet.has("docs")) {
    return `docs: update ${summarizeFiles(files)}`;
  }
  if (kindSet.size === 1 && kindSet.has("test")) {
    return `test: update ${summarizeFiles(files)}`;
  }
  const directories = [
    ...new Set(files.map((file) => dirname(file).split("/")[0])),
  ];
  const area =
    directories.length === 1 && directories[0] !== "."
      ? `${directories[0]}: `
      : "";
  return `feat: ${area}update ${summarizeFiles(files)}`;
}

/**
 * Group changed files into independent, ordered commit sets.
 * `importEdges` are [from, to] pairs between repo-relative changed paths.
 */
export function groupChangedFiles(
  files: ChangedFileInfo[],
  importEdges: Array<[string, string]>,
): CommitGroup[] {
  const lockfiles = files.filter((file) => file.kind === "lockfile");
  const analyzed = files.filter((file) => file.kind !== "lockfile");
  const kindByPath = new Map(analyzed.map((file) => [file.path, file.kind]));

  const unionFind = createUnionFind(analyzed.map((file) => file.path));

  // 1. Import/dependency edges
  for (const [from, to] of importEdges) {
    if (kindByPath.has(from) && kindByPath.has(to)) unionFind.union(from, to);
  }

  // 2. Path proximity: singletons join other changed files in their directory
  const membersByRoot = new Map<string, string[]>();
  for (const file of analyzed) {
    const root = unionFind.find(file.path);
    membersByRoot.set(root, [...(membersByRoot.get(root) ?? []), file.path]);
  }
  const byDirectory = new Map<string, string[]>();
  for (const file of analyzed) {
    const directory = dirname(file.path);
    byDirectory.set(directory, [
      ...(byDirectory.get(directory) ?? []),
      file.path,
    ]);
  }
  for (const [, members] of membersByRoot) {
    if (members.length !== 1) continue;
    const lonely = members[0];
    const neighbors = byDirectory.get(dirname(lonely)) ?? [];
    const neighbor = neighbors.find((candidate) => candidate !== lonely);
    if (neighbor) unionFind.union(neighbor, lonely);
  }

  // Collect final components
  const componentsByRoot = new Map<string, string[]>();
  for (const file of analyzed) {
    const root = unionFind.find(file.path);
    componentsByRoot.set(root, [
      ...(componentsByRoot.get(root) ?? []),
      file.path,
    ]);
  }

  const groups: CommitGroup[] = [...componentsByRoot.values()].map(
    (memberFiles) => {
      const sorted = [...memberFiles].sort();
      const kinds = sorted.map((file) => kindByPath.get(file)!);
      return { files: sorted, kinds, message: groupMessage(sorted, kinds) };
    },
  );

  // 3. Order: source-bearing groups first, then test-only, then docs-only.
  const rank = (group: CommitGroup): number => {
    const kindSet = new Set(group.kinds);
    if (kindSet.has("source")) return 0;
    if (kindSet.has("test")) return 1;
    return 2;
  };
  groups.sort(
    (a, b) => rank(a) - rank(b) || a.files[0].localeCompare(b.files[0]),
  );

  // 4. Lockfiles ride with their manifest's commit (or the first group)
  for (const lockfile of lockfiles) {
    const manifests = LOCKFILE_TO_MANIFEST[basename(lockfile.path)] ?? [];
    const lockfileDirectory = dirname(lockfile.path);
    const host =
      groups.find((group) =>
        group.files.some(
          (file) =>
            manifests.includes(basename(file)) &&
            dirname(file) === lockfileDirectory,
        ),
      ) ??
      groups.find((group) =>
        group.files.some((file) => manifests.includes(basename(file))),
      ) ??
      groups[0];
    if (host) {
      host.files.push(lockfile.path);
      host.kinds.push("lockfile");
    } else {
      groups.push({
        files: [lockfile.path],
        kinds: ["lockfile"],
        message: `chore: update ${basename(lockfile.path)}`,
      });
    }
  }

  return groups;
}

// ── Proposals ────────────────────────────────────────────────

interface CommitSplitProposal {
  id: string;
  repoPath: string;
  groups: CommitGroup[];
  createdAt: number;
}

const proposals = new Map<string, CommitSplitProposal>();
const PROPOSAL_TTL_MS = 10 * 60 * 1000;

function pruneProposals(): void {
  const now = Date.now();
  for (const [id, proposal] of proposals) {
    if (now - proposal.createdAt > PROPOSAL_TTL_MS) proposals.delete(id);
  }
}

async function collectChangedFiles(
  repoPath: string,
): Promise<{ files: ChangedFileInfo[] } | { error: string }> {
  // --untracked-files=all: expand untracked DIRECTORIES into their files —
  // the default collapses a new directory to "?? dir/", which would make the
  // grouping heuristic reason about directory entries instead of files.
  const status = await runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repoPath,
  );
  if (status.code !== 0) {
    return { error: `git status failed: ${status.stderr.trim() || status.stdout.trim()}` };
  }
  const files: ChangedFileInfo[] = [];
  for (const line of status.stdout.split("\n")) {
    if (!line.trim()) continue;
    const statusCode = line.slice(0, 2).trim();
    let relativePath = line.slice(3).trim();
    // Renames: "R  old -> new" — commit the new path
    const renameArrow = relativePath.indexOf(" -> ");
    if (renameArrow !== -1) relativePath = relativePath.slice(renameArrow + 4);
    relativePath = relativePath.replace(/^"|"$/g, "");
    files.push({
      path: relativePath,
      status: statusCode,
      kind: classifyFile(relativePath),
    });
  }
  return { files };
}

async function buildImportEdges(
  repoPath: string,
  files: ChangedFileInfo[],
): Promise<Array<[string, string]>> {
  const changedSet = new Set(files.map((file) => file.path));
  const edges: Array<[string, string]> = [];
  for (const file of files) {
    if (file.kind === "lockfile") continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(file.path)) continue;
    if (file.status === "D") continue;
    let content: string;
    try {
      content = await readFile(resolve(repoPath, file.path), "utf-8");
    } catch {
      continue;
    }
    for (const specifier of extractImportSpecifiers(content)) {
      const target = resolveSpecifier(file.path, specifier, changedSet);
      if (target && target !== file.path) edges.push([file.path, target]);
    }
  }
  return edges;
}

// ── Public entry point ───────────────────────────────────────

interface CommitSplitParams {
  action: "propose" | "confirm";
  path: string;
  proposalId?: string;
}

export async function agenticCommitSplit({
  action,
  path,
  proposalId,
}: CommitSplitParams) {
  pruneProposals();

  const validation = validatePath(path);
  if (!validation.safe) {
    return { error: validation.error };
  }
  const repoPath = validation.resolved;

  if (action === "propose") {
    const collected = await collectChangedFiles(repoPath);
    if ("error" in collected) return collected;
    if (collected.files.length === 0) {
      return { error: "The worktree is clean — nothing to commit." };
    }

    const edges = await buildImportEdges(repoPath, collected.files);
    const groups = groupChangedFiles(collected.files, edges);

    const proposal: CommitSplitProposal = {
      id: randomUUID().slice(0, 8),
      repoPath,
      groups,
      createdAt: Date.now(),
    };
    proposals.set(proposal.id, proposal);

    return {
      proposalId: proposal.id,
      repoPath,
      commitCount: groups.length,
      commits: groups.map((group, index) => ({
        order: index + 1,
        message: group.message,
        files: group.files,
      })),
      message:
        "Proposal only — nothing was committed. Review the sets (edit messages by re-proposing after changes if needed) and call again with action='confirm' and this proposalId to execute.",
    };
  }

  if (action === "confirm") {
    if (!proposalId || typeof proposalId !== "string") {
      return { error: "'proposalId' is required for confirm (from a prior propose)" };
    }
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.repoPath !== repoPath) {
      return {
        error: `No pending proposal '${proposalId}' for this repo. Proposals expire after ${PROPOSAL_TTL_MS / 60000} minutes — call propose again.`,
      };
    }

    // Drift check: every proposed file must still be dirty.
    const collected = await collectChangedFiles(repoPath);
    if ("error" in collected) return collected;
    const stillDirty = new Set(collected.files.map((file) => file.path));
    const missing = proposal.groups
      .flatMap((group) => group.files)
      .filter((file) => !stillDirty.has(file));
    if (missing.length > 0) {
      proposals.delete(proposalId);
      return {
        error: `The worktree changed since the proposal: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""} no longer dirty. Re-propose.`,
        code: "proposal_drift",
      };
    }

    proposals.delete(proposalId);

    const executed: Array<Record<string, unknown>> = [];
    for (const group of proposal.groups) {
      const add = await runGit(["add", "-A", "--", ...group.files], repoPath);
      if (add.code !== 0) {
        return {
          error: `git add failed for [${group.files.join(", ")}]: ${add.stderr.trim()}`,
          executed,
        };
      }
      const commit = await runGit(["commit", "-m", group.message], repoPath);
      if (commit.code !== 0) {
        return {
          error: `git commit failed for [${group.files.join(", ")}]: ${(commit.stderr + commit.stdout).trim()}`,
          executed,
        };
      }
      const sha = await runGit(["rev-parse", "--short", "HEAD"], repoPath);
      executed.push({
        message: group.message,
        files: group.files,
        sha: sha.stdout.trim(),
      });
      logger.info(
        `[CommitSplit] Committed ${group.files.length} file(s): ${group.message}`,
      );
    }

    return { repoPath, committed: executed.length, commits: executed };
  }

  return {
    error: `Unknown action '${String(action)}'. Supported: propose, confirm.`,
  };
}
