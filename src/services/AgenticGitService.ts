// ─── VCS Introspection for AI Coding Loops ──────────────────

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { validatePath } from "./AgenticFileService.ts";
import { WORKTREE_DIR } from "../config.ts";
import { resolveAndRouteToAgent, sendRpc } from "./AgentConnectionManager.ts";

import type {
  GitFileChange,
  GitStatusResult,
  GitDiffResult,
  GitLogResult,
  GitCommit,
} from "@rodrigo-barraza/utilities-library";
export type { GitFileChange, GitStatusResult, GitDiffResult, GitLogResult, GitCommit };

export interface GitWorktreeCreateResult {
  worktreePath?: string;
  /** The branch as created — callers store THIS name, never their own. */
  branch?: string;
  repoPath?: string;
  error?: string;
}

export interface GitWorktreeRemoveResult {
  removed?: string;
  branch?: string | null;
  branchDeleted?: boolean;
  /** Why a (non-forced) branch delete was refused; the worktree is gone. */
  branchError?: string;
  /** True when nothing was removed because it would have lost work. */
  kept?: boolean;
  error?: string;
}

export interface GitWorktreeCommitResult {
  branch?: string;
  /** False when the worktree had nothing to commit. */
  committed?: boolean;
  commit?: string;
  error?: string;
}

export interface GitWorktreeMergeResult {
  merged?: string;
  into?: string;
  output?: string;
  /**
   * Set on a refused merge. "conflict": the branches conflict, and the merge
   * was aborted so the target tree is as it was. "local-changes": uncommitted
   * work in the target tree would be overwritten, so git never started.
   */
  reason?: "conflict" | "local-changes";
  conflictingFiles?: string[];
  error?: string;
}

// ── Worktree diff contract ─────────────────────────────────
// Consumed by prism-service's sub-agent merge-back. prism-service keeps its
// own copy of these types (src/types/orchestrator.ts), and both repos pin the
// same fixture: tests/fixtures/worktree-diff-contract.json.

export type WorktreeFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed";

export interface WorktreeDiffFile {
  path: string;
  status: WorktreeFileStatus;
  /** Source path of a rename or copy. */
  previousPath?: string;
}

export interface WorktreeDiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

/** What `branch` changed since it left `base` (`git diff base...branch`). */
export interface WorktreeDiff {
  branch: string;
  base: string;
  files: WorktreeDiffFile[];
  patch: string;
  stats: WorktreeDiffStats;
  /** The patch hit the output cap; `files` and `stats` are still complete. */
  patchTruncated?: boolean;
}

export type GitWorktreeDiffResult = WorktreeDiff | { error: string };

export interface GitWorktreeCleanupResult {
  pruned?: boolean;
  cleanedDirs?: number;
  error?: string;
}

// Agent routing helper
async function tryAgentRoute(
  method: string,
  params: Record<string, unknown>,
  targetPath: string,
): Promise<unknown> {
  const agent = resolveAndRouteToAgent(targetPath);
  if (!agent) return null;
  try {
    return await sendRpc(agent.id, method, params);
  } catch (error: unknown) {
    return { error: `Agent RPC failed: ${errorMessage(error)}` };
  }
}

import {
  AGENT_GIT_TIMEOUT_MS as GIT_TIMEOUT_MS,
  AGENT_GIT_MAX_OUTPUT_BYTES as MAX_OUTPUT_BYTES,
} from "../constants.ts";
import { errorMessage } from "../utilities.ts";

interface GitRunResult {
  stdout: string;
  stderr: string;
  error?: string;
  exitCode?: number | null;
  truncated?: boolean;
}

/**
 * Reject values that git would interpret as an option flag. An LLM-supplied
 * `ref` or `file` beginning with `-` (e.g. `--output=/etc/x`) can otherwise be
 * smuggled into the git argument vector and write arbitrary files while the
 * command still reports "(no changes)". Callers must surface the returned
 * message as a teaching error.
 */
function rejectOptionLikeArg(value: string, label: string): string | null {
  if (value.startsWith("-")) {
    return `git ${label} must not start with '-'`;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Internal Git Runner
// ────────────────────────────────────────────────────────────

async function runGit(args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise<GitRunResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let truncated = false;
    let settled = false;

    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        LANG: "C.UTF-8",
      },
      detached: false,
    });

    if (child.stdin) {
      child.stdin.end();
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutLength >= MAX_OUTPUT_BYTES) {
          truncated = true;
          return;
        }
        stdoutChunks.push(chunk);
        stdoutLength += chunk.length;
        if (stdoutLength > MAX_OUTPUT_BYTES) truncated = true;
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrLength < MAX_OUTPUT_BYTES) {
          stderrChunks.push(chunk);
          stderrLength += chunk.length;
        }
      });
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        resolve({
          stdout: "",
          stderr: "",
          error: `Git command timed out after ${GIT_TIMEOUT_MS}ms`,
        });
      }
    }, GIT_TIMEOUT_MS);

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (code !== 0) {
        resolve({
          stdout,
          stderr,
          error: stderr.trim() || `Git exited with code ${code}`,
          exitCode: code,
          ...(truncated && { truncated }),
        });
        return;
      }

      // A >512KB diff/log used to be silently cut — the caller (an LLM) would
      // read partial output as complete. Mark it, and append a visible marker.
      resolve({
        stdout: truncated ? stdout + "\n... [output truncated]" : stdout,
        stderr: stderr.trim(),
        ...(truncated && { truncated }),
      });
    });

    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: "",
          stderr: "",
          error: `Git process error: ${error.message}`,
        });
      }
    });
  });
}

// ────────────────────────────────────────────────────────────
// Git Status
// ────────────────────────────────────────────────────────────

/**
 * Get git status for a repository.
 */
export async function agenticGitStatus(
  repoPath: string,
): Promise<(GitStatusResult & { detached?: boolean }) | { error: string; path?: string }> {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "git.status",
    { path: repoPath },
    repoPath,
  );
  if (agentResult) return agentResult as GitStatusResult;

  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error || "Invalid path" };
  }

  const cwd = validation.resolved;

  // Get branch info
  const branchResult = await runGit(["branch", "--show-current"], cwd);
  if (branchResult.error) {
    return { error: branchResult.error, path: cwd };
  }

  let branch = branchResult.stdout.trim();

  // Detached HEAD: `git branch --show-current` yields empty. Fall back to the
  // short commit hash so the response isn't a misleading empty branch name.
  let detached = false;
  if (!branch) {
    const headResult = await runGit(["rev-parse", "--short", "HEAD"], cwd);
    if (!headResult.error) {
      branch = headResult.stdout.trim();
      detached = true;
    }
  }

  // Get status
  const statusResult = await runGit(
    ["status", "--short", "--branch", "--untracked-files=all"],
    cwd,
  );
  if (statusResult.error) {
    return { error: statusResult.error, path: cwd };
  }

  const lines = statusResult.stdout.trim().split("\n").filter(Boolean);
  const branchLine = lines[0] || "";
  const fileLines = lines.slice(1);

  // Parse ahead/behind from branch line (## main...origin/main [ahead 2, behind 1])
  const aheadMatch = branchLine.match(/ahead (\d+)/);
  const behindMatch = branchLine.match(/behind (\d+)/);

  // Parse file changes
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: string[] = [];

  for (const line of fileLines) {
    const stagingStatus = line[0]; // staging area
    const workingTreeStatus = line[1]; // working tree
    const file = line.slice(3);

    if (stagingStatus === "?" && workingTreeStatus === "?") {
      untracked.push(file);
    } else {
      if (stagingStatus !== " " && stagingStatus !== "?") {
        staged.push({ status: stagingStatus, file });
      }
      if (workingTreeStatus !== " " && workingTreeStatus !== "?") {
        unstaged.push({ status: workingTreeStatus, file });
      }
    }
  }

  return {
    path: cwd,
    branch,
    ...(detached && { detached: true }),
    ahead: aheadMatch ? parseInt(aheadMatch[1]) : 0,
    behind: behindMatch ? parseInt(behindMatch[1]) : 0,
    staged,
    unstaged,
    untracked,
    totalChanges: staged.length + unstaged.length + untracked.length,
    clean:
      staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  };
}

// ────────────────────────────────────────────────────────────
// Git Diff
// ────────────────────────────────────────────────────────────

interface DiffOptions {
  staged?: boolean;
  path?: string;
  ref?: string;
}

/**
 * Get git diff output.
 */
export async function agenticGitDiff(
  repoPath: string,
  { staged = false, path: filePath, ref }: DiffOptions = {},
): Promise<GitDiffResult & { truncated?: boolean }> {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "git.diff",
    { path: repoPath, staged, filePath, ref },
    repoPath,
  );
  if (agentResult) return agentResult as GitDiffResult;

  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const cwd = validation.resolved;
  const args = ["diff", "--stat", "--patch"];

  if (staged) args.push("--cached");
  if (ref) {
    const refError = rejectOptionLikeArg(ref, "ref");
    if (refError) return { error: refError };
    args.push(ref);
  }
  args.push("--");
  if (filePath) {
    const fileError = rejectOptionLikeArg(filePath, "file");
    if (fileError) return { error: fileError };
    // Resolve a relative `file` against the validated repo path — not the
    // workspace root — so the diff targets a file inside THIS repo.
    const fileInput = filePath.startsWith("/") ? filePath : join(cwd, filePath);
    const fileValidation = validatePath(fileInput);
    if (!fileValidation.safe) {
      return { error: fileValidation.error };
    }
    args.push(fileValidation.resolved);
  }

  const result = await runGit(args, cwd);
  if (result.error) {
    return { error: result.error, path: cwd };
  }

  const diff = result.stdout;
  const hasChanges = diff.trim().length > 0;

  // Parse stat summary from beginning of output
  const additions = (diff.match(/^\+[^+]/gm) || []).length;
  const deletions = (diff.match(/^-[^-]/gm) || []).length;

  return {
    path: cwd,
    staged,
    ...(filePath && { file: filePath }),
    ...(ref && { ref }),
    hasChanges,
    additions,
    deletions,
    ...(result.truncated && { truncated: true }),
    diff: hasChanges ? diff : "(no changes)",
  };
}

// ────────────────────────────────────────────────────────────
// Git Log
// ────────────────────────────────────────────────────────────

interface LogOptions {
  limit?: number;
  author?: string;
  since?: string;
  path?: string;
}

/**
 * Get git log.
 */
const DEFAULT_LOG_LIMIT = 20;

export async function agenticGitLog(
  repoPath: string,
  { limit = DEFAULT_LOG_LIMIT, author, since, path: filePath }: LogOptions = {},
): Promise<GitLogResult & { appliedLimit?: number; truncated?: boolean }> {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "git.log",
    { path: repoPath, limit, author, since, filePath },
    repoPath,
  );
  if (agentResult) return agentResult as GitLogResult;

  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const cwd = validation.resolved;
  // Route coercion is best-effort; a NaN limit would become `-n NaN`. Fall back
  // to the default, then clamp to a sane range and echo the value actually used.
  const requestedLimit = Number.isFinite(limit) ? limit : DEFAULT_LOG_LIMIT;
  const clampedLimit = Math.min(Math.max(requestedLimit, 1), 100);

  // Use a structured format for reliable parsing
  const separator = "<<<COMMIT>>>";
  const formatString = `${separator}%H|%h|%an|%ae|%ai|%s`;
  const args = ["log", `--format=${formatString}`, `-n`, String(clampedLimit)];

  if (author) args.push(`--author=${author}`);
  if (since) args.push(`--since=${since}`);

  if (filePath) {
    const fileError = rejectOptionLikeArg(filePath, "file");
    if (fileError) return { error: fileError };
    // Resolve relative paths against the repo path arg, not the workspace root.
    const fileInput = filePath.startsWith("/") ? filePath : join(cwd, filePath);
    const fileValidation = validatePath(fileInput);
    if (!fileValidation.safe) {
      return { error: fileValidation.error };
    }
    args.push("--", fileValidation.resolved);
  }

  const result = await runGit(args, cwd);
  if (result.error) {
    return { error: result.error, path: cwd };
  }

  const commits: GitCommit[] = result.stdout
    .split(separator)
    .filter((s: string) => s.trim())
    .map((entry: string) => {
      const parts = entry.trim().split("|");
      return {
        hash: parts[0] || "",
        shortHash: parts[1] || "",
        author: parts[2] || "",
        email: parts[3] || "",
        date: parts[4] || "",
        message: parts.slice(5).join("|") || "",
      };
    });

  return {
    path: cwd,
    totalCommits: commits.length,
    appliedLimit: clampedLimit,
    ...(author && { author }),
    ...(since && { since }),
    ...(result.truncated && { truncated: true }),
    commits,
  };
}

// ────────────────────────────────────────────────────────────
// Git Worktree Operations (for Coordinator Mode)
// ────────────────────────────────────────────────────────────

const WORKTREE_BASE = WORKTREE_DIR?.trim() || "/tmp/prism-worktrees";

/** Used only when the repo has no identity, so a commit or merge commit can land. */
const FALLBACK_IDENTITY = { name: "Prism sub-agent", email: "prism@localhost" };

async function identityArgs(cwd: string): Promise<string[]> {
  const args: string[] = [];
  for (const key of ["name", "email"] as const) {
    const configured = await runGit(["config", `user.${key}`], cwd);
    if (configured.error || !configured.stdout.trim()) {
      args.push("-c", `user.${key}=${FALLBACK_IDENTITY[key]}`);
    }
  }
  return args;
}

/**
 * `git check-ref-format --branch` is git's own rule for a branch name. A name
 * that is not a valid ref is rejected, never rewritten: rewriting it (the old
 * `/` → `_`) handed the caller back a different branch than it asked for.
 */
async function validateBranchName(
  branchName: string,
  cwd: string,
): Promise<string | null> {
  const optionLike = rejectOptionLikeArg(branchName, "branch name");
  if (optionLike) return optionLike;
  const check = await runGit(["check-ref-format", "--branch", branchName], cwd);
  // --branch expands `@{-N}` to another branch; demand the name come back as given.
  if (check.error || check.stdout.trim() !== branchName) {
    return `Invalid branch name '${branchName}': git check-ref-format rejects it (no spaces, '..', '~', '^', ':', '?', '*', '[', '\\', '@{', and no leading '-' or trailing '/', '.' or '.lock').`;
  }
  return null;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Find `worktreePath` among the repo's linked worktrees (never the main one).
 * Everything that writes to a worktree goes through this, so a request can
 * only touch a worktree git itself registered for that repo.
 */
async function findLinkedWorktree(
  repoCwd: string,
  worktreePath: string,
): Promise<WorktreeEntry | { error: string }> {
  const list = await runGit(["worktree", "list", "--porcelain"], repoCwd);
  if (list.error) return { error: list.error };

  const entries: WorktreeEntry[] = list.stdout
    .split(/\n\n+/)
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split("\n");
      const path = (lines.find((l) => l.startsWith("worktree ")) || "").slice(9);
      const ref = (lines.find((l) => l.startsWith("branch ")) || "").slice(7);
      return { path, branch: ref ? ref.replace(/^refs\/heads\//, "") : null };
    });

  const wanted = realpathOrSelf(worktreePath);
  const match = entries
    .slice(1)
    .find((entry) => realpathOrSelf(entry.path) === wanted);
  if (!match) {
    return {
      error: `'${worktreePath}' is not a linked worktree of ${repoCwd}`,
    };
  }
  return match;
}

async function currentBranchOrHead(cwd: string): Promise<string> {
  const current = await runGit(["branch", "--show-current"], cwd);
  return current.error || !current.stdout.trim()
    ? "HEAD"
    : current.stdout.trim();
}

/**
 * Create a git worktree on a new branch named exactly `branchName`.
 */
export async function agenticGitWorktreeCreate(
  repoPath: string,
  branchName: string,
): Promise<GitWorktreeCreateResult> {
  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const cwd = validation.resolved;
  const invalidName = await validateBranchName(branchName, cwd);
  if (invalidName) {
    return { error: invalidName, repoPath: cwd };
  }

  // The directory name is not the branch name; only it is flattened.
  const directoryName = branchName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const worktreePath = `${WORKTREE_BASE}/${directoryName}-${Date.now()}`;

  // Ensure base directory exists
  const { mkdirSync } = await import("node:fs");
  try {
    mkdirSync(WORKTREE_BASE, { recursive: true });
  } catch {
    // ignore if it exists
  }

  const result = await runGit(
    ["worktree", "add", worktreePath, "-b", branchName],
    cwd,
  );

  if (result.error) {
    return { error: result.error, repoPath: cwd };
  }

  return {
    worktreePath,
    branch: branchName,
    repoPath: cwd,
  };
}

/**
 * Stage and commit everything in a linked worktree (argv, no shell). A clean
 * worktree is not an error: `committed: false`.
 */
export async function agenticGitWorktreeCommit(
  repoPath: string,
  worktreePath: string,
  message: string,
): Promise<GitWorktreeCommitResult> {
  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const worktree = await findLinkedWorktree(validation.resolved, worktreePath);
  if ("error" in worktree) return { error: worktree.error };
  const branch = worktree.branch ?? undefined;

  const staged = await runGit(["add", "-A"], worktree.path);
  if (staged.error) return { error: staged.error, branch };

  const status = await runGit(["status", "--porcelain"], worktree.path);
  if (status.error) return { error: status.error, branch };
  if (!status.stdout.trim()) return { branch, committed: false };

  const committed = await runGit(
    [...(await identityArgs(worktree.path)), "commit", "-q", "-m", message],
    worktree.path,
  );
  if (committed.error) return { error: committed.error, branch };

  const head = await runGit(["rev-parse", "HEAD"], worktree.path);
  return {
    branch,
    committed: true,
    ...(!head.error && { commit: head.stdout.trim() }),
  };
}

interface WorktreeRemoveOptions {
  deleteBranch?: boolean;
  /** Discard uncommitted and unmerged work. Only for an explicit discard. */
  force?: boolean;
}

/**
 * Remove a linked worktree and (by default) its branch — but never over work:
 * without `force`, a branch with commits its repo's HEAD does not contain
 * keeps BOTH the worktree and the branch, git refuses a dirty worktree, and
 * the branch is deleted with `-d`, not `-D`.
 */
export async function agenticGitWorktreeRemove(
  repoPath: string,
  worktreePath: string,
  { deleteBranch = true, force = false }: WorktreeRemoveOptions = {},
): Promise<GitWorktreeRemoveResult> {
  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const cwd = validation.resolved;
  const worktree = await findLinkedWorktree(cwd, worktreePath);
  if ("error" in worktree) return { error: worktree.error };
  const branchName = worktree.branch;

  if (!force && deleteBranch && branchName) {
    const contained = await runGit(
      ["merge-base", "--is-ancestor", branchName, "HEAD"],
      cwd,
    );
    if (contained.error) {
      const into = await currentBranchOrHead(cwd);
      return {
        error:
          contained.exitCode === 1
            ? `Branch '${branchName}' has commits that ${into} does not contain; kept the worktree (${worktree.path}) and the branch. Merge it first, or remove with force: true to discard them.`
            : contained.error,
        kept: true,
        branch: branchName,
      };
    }
  }

  const result = await runGit(
    ["worktree", "remove", ...(force ? ["--force"] : []), worktree.path],
    cwd,
  );

  if (result.error) {
    return {
      error: force
        ? result.error
        : `${result.error} (kept the worktree and branch '${branchName}'; remove with force: true to discard its changes)`,
      kept: true,
      branch: branchName,
    };
  }

  let branchError: string | undefined;
  if (deleteBranch && branchName) {
    const deleted = await runGit(
      ["branch", force ? "-D" : "-d", branchName],
      cwd,
    );
    branchError = deleted.error;
  }

  return {
    removed: worktree.path,
    branch: branchName,
    branchDeleted: deleteBranch && !!branchName && !branchError,
    ...(branchError && { branchError }),
  };
}

interface WorktreeMergeOptions {
  message?: string;
}

/** Paths git lists (tab-indented) under "...would be overwritten by merge:". */
function filesBlockingMerge(gitError: string): string[] {
  if (!/would be overwritten by merge/.test(gitError)) return [];
  return gitError
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Merge a worktree branch into the repo's current branch. A merge that
 * conflicts is aborted, so the caller's tree is never left half-merged; the
 * result names the conflicting files.
 */
export async function agenticGitWorktreeMerge(
  repoPath: string,
  branch: string,
  { message }: WorktreeMergeOptions = {},
): Promise<GitWorktreeMergeResult> {
  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }
  const optionLike = rejectOptionLikeArg(branch, "branch");
  if (optionLike) return { error: optionLike };

  const cwd = validation.resolved;
  const into = await currentBranchOrHead(cwd);

  const result = await runGit(
    [
      ...(await identityArgs(cwd)),
      "merge",
      "--no-ff",
      "--no-edit",
      ...(message ? ["-m", message] : []),
      branch,
    ],
    cwd,
  );
  if (!result.error) {
    return {
      merged: branch,
      into,
      output: result.stdout.trim(),
    };
  }

  const unmerged = await runGit(
    ["diff", "--name-only", "--diff-filter=U", "-z"],
    cwd,
  );
  const conflictingFiles = unmerged.error
    ? []
    : unmerged.stdout.split("\0").filter(Boolean);
  if (conflictingFiles.length > 0) {
    const aborted = await runGit(["merge", "--abort"], cwd);
    return {
      error: `Merging '${branch}' into ${into} conflicts in ${conflictingFiles.join(", ")}. ${aborted.error ? `The merge could NOT be aborted (${aborted.error}); ${into} is mid-merge.` : `The merge was aborted; ${into} is unchanged.`}`,
      reason: "conflict",
      conflictingFiles,
    };
  }

  const blocking = filesBlockingMerge(`${result.error}\n${result.stdout}`);
  if (blocking.length > 0) {
    return {
      error: `Merging '${branch}' into ${into} would overwrite uncommitted changes in ${blocking.join(", ")}; nothing was merged.`,
      reason: "local-changes",
      conflictingFiles: blocking,
    };
  }

  return { error: result.error };
}

const FILE_STATUS_BY_LETTER: Record<string, WorktreeFileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

/** Parse `git diff --name-status -z` (`R100\0old\0new\0` for renames/copies). */
function parseNameStatus(output: string): WorktreeDiffFile[] {
  const tokens = output.split("\0");
  const files: WorktreeDiffFile[] = [];
  for (let index = 0; index < tokens.length; ) {
    const code = tokens[index++];
    if (!code) continue;
    const status = FILE_STATUS_BY_LETTER[code[0]] ?? "modified";
    if (status === "renamed" || status === "copied") {
      const previousPath = tokens[index++];
      files.push({ path: tokens[index++], status, previousPath });
    } else {
      files.push({ path: tokens[index++], status });
    }
  }
  return files;
}

/** Sum `git diff --numstat` (binary files report `-`). */
function sumNumstat(output: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of output.split("\n")) {
    const [added, deleted] = line.split("\t");
    additions += Number.parseInt(added, 10) || 0;
    deletions += Number.parseInt(deleted, 10) || 0;
  }
  return { additions, deletions };
}

/**
 * What a worktree branch changed since it left the repo's current branch —
 * the typed diff contract (`WorktreeDiff`).
 */
export async function agenticGitWorktreeDiff(
  repoPath: string,
  branch: string,
): Promise<GitWorktreeDiffResult> {
  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error ?? "Invalid path" };
  }
  const optionLike = rejectOptionLikeArg(branch, "branch");
  if (optionLike) return { error: optionLike };

  const cwd = validation.resolved;
  const base = await currentBranchOrHead(cwd);
  const range = `${base}...${branch}`;

  const nameStatus = await runGit(
    ["diff", "--name-status", "-z", range, "--"],
    cwd,
  );
  if (nameStatus.error) {
    return { error: nameStatus.error };
  }
  const numstat = await runGit(["diff", "--numstat", range, "--"], cwd);
  if (numstat.error) {
    return { error: numstat.error };
  }
  const patch = await runGit(["diff", "--patch", range, "--"], cwd);
  if (patch.error) {
    return { error: patch.error };
  }

  const files = parseNameStatus(nameStatus.stdout);
  return {
    branch,
    base,
    files,
    patch: patch.stdout,
    stats: { filesChanged: files.length, ...sumNumstat(numstat.stdout) },
    ...(patch.truncated && { patchTruncated: true }),
  };
}

/**
 * Clean up any orphaned worktrees from previous runs.
 * Should be called on server startup.
 */
export async function agenticGitWorktreeCleanup(
  repoPath: string,
): Promise<GitWorktreeCleanupResult> {
  const validation = validatePath(repoPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const cwd = validation.resolved;
  const result = await runGit(["worktree", "prune"], cwd);

  if (result.error) {
    return { error: result.error };
  }

  // Also clean up temp directory
  const { rmSync, existsSync } = await import("node:fs");
  let cleaned = 0;
  if (existsSync(WORKTREE_BASE)) {
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(WORKTREE_BASE);
    for (const entry of entries) {
      try {
        rmSync(`${WORKTREE_BASE}/${entry}`, { recursive: true, force: true });
        cleaned++;
      } catch {
        // best-effort cleanup
      }
    }
  }

  return { pruned: true, cleanedDirs: cleaned };
}
