// ─── Workspace Snapshots for Rewind ─────────────────────────
//
// prism-service snapshots a workspace before (and after) every agent tool
// batch that can write, so a user can later rewind the CODE to any point of
// a conversation. A snapshot is a shadow commit:
//
//   GIT_INDEX_FILE=<temp> git add -A -- <workspace>   (a TEMPORARY index)
//   git write-tree  →  git commit-tree -p HEAD  →  git update-ref refs/prism/checkpoints/…
//
// Invariants (pinned by tests/AgenticGitSnapshot.test.ts on a real repo):
//   - the user's index, HEAD and branch are never read-modified-written;
//     the temporary index is seeded from a COPY of the user's index only so
//     `git add` can reuse its stat cache instead of rehashing every file;
//   - no hook ever runs: every git call carries -c core.hooksPath=/dev/null
//     (update-ref fires reference-transaction, index writes post-index-change);
//   - a restore removes files created after the snapshot, restores modified
//     and deleted ones, and never touches the index or HEAD either — files are
//     written by `checkout-index` from a second temporary index;
//   - a restore refuses (unless forced) when a path it would touch changed
//     after the latest snapshot — i.e. in a way the agent did not make;
//   - given `agentRanges` (the before/after snapshot pair of every agent
//     write batch since the target), a restore touches ONLY the paths the
//     agent changed inside those ranges. A user's unrelated edit — staged or
//     not — is left alone; a user edit to an agent-changed path, made in a
//     gap between ranges or after the last one, is a conflict.
//
// Non-git workspaces are reported as `snapshotCapable: false` with a reason,
// never as a silent success. This replaces prism-service's SandboxExecutor,
// which ran `git add -A` on the user's real index.

import { spawn } from "node:child_process";
import { copyFile, lstat, mkdtemp, readdir, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { validatePath } from "./AgenticFileService.ts";
import { resolveAndRouteToAgent } from "./AgentConnectionManager.ts";
import { errorMessage } from "../utilities.ts";

/** Every snapshot ref lives under this namespace; nothing else is ever written. */
export const SNAPSHOT_REF_PREFIX = "refs/prism/checkpoints/";

/** Snapshots of a large repo stat every tracked file; allow far more than a git status. */
const SNAPSHOT_GIT_TIMEOUT_MS = 120_000;
const SNAPSHOT_GIT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
/** File lists in a response are capped; counts stay exact. */
const MAX_LISTED_PATHS = 2000;

const SNAPSHOT_IDENTITY = {
  GIT_AUTHOR_NAME: "Prism",
  GIT_AUTHOR_EMAIL: "prism@localhost",
  GIT_COMMITTER_NAME: "Prism",
  GIT_COMMITTER_EMAIL: "prism@localhost",
};

/** Hooks, fsmonitor daemons and signing are all off for every snapshot git call. */
const SAFE_CONFIG = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "commit.gpgSign=false",
  "-c", "advice.addEmbeddedRepo=false",
  "--literal-pathspecs",
];

/** mode 160000: a submodule / embedded repository — never restored or removed. */
const GITLINK_MODE = "160000";

// ────────────────────────────────────────────────────────────
// Result shapes
// ────────────────────────────────────────────────────────────

export interface NotSnapshotCapable {
  snapshotCapable: false;
  reason: string;
  workspaceRoot?: string;
}

export interface SnapshotError {
  error: string;
  /** Set when the named snapshot ref does not exist (HTTP 404). */
  notFound?: boolean;
}

export interface SnapshotResult {
  snapshotCapable: true;
  ref: string;
  commit: string;
  tree: string;
  head: string | null;
  repoRoot: string;
  workspaceRoot: string;
  /** Milliseconds since the epoch, also stamped in the commit subject. */
  createdAt: number;
}

export interface RestoreResult {
  snapshotCapable: true;
  ref: string;
  againstRef: string | null;
  repoRoot: string;
  workspaceRoot: string;
  dryRun: boolean;
  /** True only when files were actually written. */
  applied: boolean;
  /** True when the restore was refused because of `conflicts` (HTTP 409). */
  refused: boolean;
  /** Paths the restore would touch that changed after `againstRef` — edits the agent did not make. */
  conflicts: string[];
  /** Paths written back to their snapshot content (modified or deleted since). Workspace-relative. */
  restored: string[];
  /** Paths created after the snapshot, deleted by the restore. Workspace-relative. */
  removed: string[];
  /** Submodules / embedded repos that differ but are never touched. */
  skipped: string[];
  /** Totals, exact even when the lists are capped at MAX_LISTED_PATHS. */
  counts: { restored: number; removed: number; conflicts: number; skipped: number };
  truncated?: boolean;
  /** The pre-restore state, kept so a forced restore can itself be undone. */
  undoRef?: string;
  /** The post-restore state: the baseline for the next restore's conflict check. */
  afterRef?: string;
}

/** One agent write batch: the snapshot before it and after it (null: through the current tree). */
export interface AgentRange {
  from: string;
  to: string | null;
}

export interface DeleteSnapshotsResult {
  snapshotCapable: true;
  deleted: string[];
}

// ────────────────────────────────────────────────────────────
// Git runner (env + stdin aware; the service-wide runner is neither)
// ────────────────────────────────────────────────────────────

interface GitOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  error?: string;
}

function runGit(
  args: string[],
  cwd: string,
  { env = {}, input }: { env?: Record<string, string>; input?: string } = {},
): Promise<GitOutcome> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", [...SAFE_CONFIG, ...args], {
      cwd,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        LANG: "C.UTF-8",
        ...SNAPSHOT_IDENTITY,
        ...env,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (outcome: GitOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(outcome);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout: "", stderr: "", code: null, error: `git ${args[0]} timed out after ${SNAPSHOT_GIT_TIMEOUT_MS}ms` });
    }, SNAPSHOT_GIT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= SNAPSHOT_GIT_MAX_OUTPUT_BYTES) stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => finish({ stdout: "", stderr: "", code: null, error: `git process error: ${error.message}` }));
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf-8");
      const err = Buffer.concat(stderr).toString("utf-8").trim();
      if (size > SNAPSHOT_GIT_MAX_OUTPUT_BYTES) {
        finish({ stdout: "", stderr: err, code, error: `git ${args[0]} output exceeded ${SNAPSHOT_GIT_MAX_OUTPUT_BYTES} bytes` });
        return;
      }
      finish({ stdout: out, stderr: err, code, ...(code !== 0 && { error: err || `git ${args[0]} exited with code ${code}` }) });
    });
    if (child.stdin) {
      // A command that exits before reading all of stdin must not crash the process.
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

/** Run git and throw on failure — for steps after the workspace is known to be a repo. */
async function mustGit(
  args: string[],
  cwd: string,
  options?: { env?: Record<string, string>; input?: string },
): Promise<string> {
  const outcome = await runGit(args, cwd, options);
  if (outcome.error) throw new Error(outcome.error);
  return outcome.stdout;
}

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

/**
 * A snapshot ref must sit under refs/prism/checkpoints/ and be a well-formed
 * ref name. Checked here (no `..`, no option-like or empty segments, a safe
 * character set) AND by `git check-ref-format` before anything is written.
 */
export function validateSnapshotRef(ref: unknown, label = "ref"): string | null {
  if (typeof ref !== "string" || !ref) return `'${label}' is required (string)`;
  if (!ref.startsWith(SNAPSHOT_REF_PREFIX)) {
    return `'${label}' must start with ${SNAPSHOT_REF_PREFIX}`;
  }
  const rest = ref.slice(SNAPSHOT_REF_PREFIX.length);
  const segments = rest.split("/");
  if (
    !rest ||
    segments.some(
      (segment) =>
        !segment ||
        segment.startsWith(".") ||
        segment.startsWith("-") ||
        segment.endsWith(".lock") ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    ) ||
    rest.includes("..")
  ) {
    return `'${label}' is not a valid snapshot ref: ${ref}`;
  }
  return null;
}

function validatePrefix(prefix: unknown): string | null {
  if (typeof prefix !== "string" || !prefix.startsWith(SNAPSHOT_REF_PREFIX)) {
    return `'prefix' must start with ${SNAPSHOT_REF_PREFIX}`;
  }
  if (prefix === SNAPSHOT_REF_PREFIX) return null;
  const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return validateSnapshotRef(trimmed, "prefix");
}

// ────────────────────────────────────────────────────────────
// Workspace resolution
// ────────────────────────────────────────────────────────────

interface Workspace {
  /** The workspace directory (realpath). */
  root: string;
  /** The repository's top level (realpath). */
  top: string;
  /** The user's index file — only ever COPIED, never written. */
  userIndex: string;
  /** HEAD's commit, or null in a repo with no commits yet. */
  head: string | null;
  /** The workspace as a pathspec relative to `top` ("." when they coincide). */
  pathspec: string;
}

function notCapable(reason: string, workspaceRoot?: string): NotSnapshotCapable {
  return { snapshotCapable: false, reason, ...(workspaceRoot && { workspaceRoot }) };
}

async function resolveWorkspace(
  workspaceRoot: unknown,
): Promise<Workspace | NotSnapshotCapable | SnapshotError> {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return { error: "'workspaceRoot' is required (string)" };
  }
  if (resolveAndRouteToAgent(workspaceRoot)) {
    return notCapable(
      "Workspace is served by a connected remote workspace agent; snapshots only run on workspaces local to tools-service.",
      workspaceRoot,
    );
  }
  const validation = validatePath(workspaceRoot);
  if (!validation.safe) return { error: validation.error || "Invalid workspaceRoot" };
  const root = validation.resolved;
  try {
    if (!(await stat(root)).isDirectory()) {
      return { error: `workspaceRoot is not a directory: ${root}` };
    }
  } catch {
    return { error: `workspaceRoot does not exist: ${root}` };
  }

  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], root);
  if (inside.error || inside.stdout.trim() !== "true") {
    return notCapable(`Not a git repository (or not a work tree): ${root}`, root);
  }
  const top = (await runGit(["rev-parse", "--show-toplevel"], root)).stdout.trim();
  if (!top) return notCapable(`Not a git repository: ${root}`, root);

  const indexPath = (await runGit(["rev-parse", "--git-path", "index"], top)).stdout.trim();
  const headOutcome = await runGit(["rev-parse", "--verify", "-q", "HEAD^{commit}"], top);
  const pathspec = relative(top, root) || ".";
  if (pathspec.startsWith("..") || isAbsolute(pathspec)) {
    return notCapable(`Workspace ${root} is not inside its repository ${top}`, root);
  }
  return {
    root,
    top,
    userIndex: resolve(top, indexPath),
    head: headOutcome.error ? null : headOutcome.stdout.trim() || null,
    pathspec,
  };
}

function isWorkspace(value: Workspace | NotSnapshotCapable | SnapshotError): value is Workspace {
  return "top" in value;
}

// ────────────────────────────────────────────────────────────
// Trees
// ────────────────────────────────────────────────────────────

/**
 * Build a tree of the workspace's CURRENT working-tree state through a
 * temporary index. Outside the workspace pathspec the tree mirrors the
 * user's index — irrelevant, since restores are scoped to the same pathspec.
 */
async function buildWorkingTree(workspace: Workspace, scratch: string, name: string): Promise<string> {
  const indexFile = join(scratch, name);
  const env = { GIT_INDEX_FILE: indexFile };
  const attempt = async (seedFromUserIndex: boolean) => {
    await rm(indexFile, { force: true });
    if (seedFromUserIndex) {
      await copyFile(workspace.userIndex, indexFile);
    } else if (workspace.head) {
      await mustGit(["read-tree", workspace.head], workspace.top, { env });
    }
    await mustGit(["add", "-A", "--", workspace.pathspec], workspace.top, { env });
    return (await mustGit(["write-tree"], workspace.top, { env })).trim();
  };
  try {
    // The copied index carries the user's stat cache: unchanged files are not rehashed.
    return await attempt(true);
  } catch {
    // No index yet, a split index, or unmerged entries outside the workspace:
    // start from HEAD instead (correct, only slower).
    return attempt(false);
  }
}

async function commitTree(workspace: Workspace, tree: string, subject: string): Promise<string> {
  const args = ["commit-tree", tree, ...(workspace.head ? ["-p", workspace.head] : []), "-m", subject];
  return (await mustGit(args, workspace.top)).trim();
}

async function checkRefFormat(ref: string, cwd: string): Promise<boolean> {
  return !(await runGit(["check-ref-format", ref], cwd)).error;
}

async function writeRef(workspace: Workspace, ref: string, commit: string): Promise<void> {
  if (!(await checkRefFormat(ref, workspace.top))) throw new Error(`Invalid ref name: ${ref}`);
  await mustGit(["update-ref", "--no-deref", ref, commit], workspace.top);
}

/** A snapshot ref's tree; throws when the ref is gone. */
async function resolveTree(workspace: Workspace, ref: string): Promise<string> {
  const outcome = await runGit(["rev-parse", "--verify", "-q", `${ref}^{tree}`], workspace.top);
  const tree = outcome.stdout.trim();
  if (outcome.error || !tree) throw new Error(`Snapshot ref not found: ${ref}`);
  return tree;
}

interface TreeChange {
  status: string;
  path: string;
  gitlink: boolean;
}

/** Raw `diff-tree` between two trees within the workspace (repo-relative paths). */
async function diffTrees(workspace: Workspace, from: string, to: string): Promise<TreeChange[]> {
  const output = await mustGit(
    ["diff-tree", "-r", "-z", "--no-renames", "--raw", from, to, "--", workspace.pathspec],
    workspace.top,
  );
  const fields = output.split("\0");
  const changes: TreeChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const meta = fields[index];
    const path = fields[index + 1];
    if (!meta.startsWith(":") || !path) continue;
    const [sourceMode, destinationMode, , , status] = meta.slice(1).split(" ");
    changes.push({
      status: status.charAt(0),
      path,
      gitlink: sourceMode === GITLINK_MODE || destinationMode === GITLINK_MODE,
    });
  }
  return changes;
}

function snapshotSubject(createdAt: number, ref: string, message?: string): string {
  return `prism snapshot t=${createdAt}\n\nref: ${ref}${message ? `\n${message}` : ""}`;
}

function parseSubjectTime(subject: string): number | null {
  const match = /^prism snapshot t=(\d+)/.exec(subject);
  return match ? Number(match[1]) : null;
}

interface ListedRef {
  ref: string;
  createdAt: number;
}

/** Snapshot refs under a prefix with their creation time (subject stamp, else committer date). */
async function listRefs(workspace: Workspace, prefix: string): Promise<ListedRef[]> {
  const output = await mustGit(
    ["for-each-ref", "--format=%(refname)%00%(committerdate:unix)%00%(subject)", prefix],
    workspace.top,
  );
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, unix, subject] = line.split("\0");
      return { ref, createdAt: parseSubjectTime(subject) ?? Number(unix) * 1000 };
    });
}

/** The most recent snapshot in `ref`'s conversation namespace — the conflict baseline. */
async function latestSiblingRef(workspace: Workspace, ref: string): Promise<string | null> {
  const namespace = ref.slice(0, ref.lastIndexOf("/") + 1);
  const refs = await listRefs(workspace, namespace);
  refs.sort((a, b) => a.createdAt - b.createdAt || a.ref.localeCompare(b.ref));
  return refs.length ? refs[refs.length - 1].ref : null;
}

function toWorkspaceRelative(workspace: Workspace, repoPath: string): string {
  if (workspace.pathspec === ".") return repoPath;
  return repoPath.slice(workspace.pathspec.length + 1);
}

/** Normalize a caller-supplied path (absolute, or workspace-relative) to repo-relative. */
function toRepoRelative(workspace: Workspace, path: string): string | null {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(workspace.root, path);
  const relativeToRoot = relative(workspace.root, absolute);
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) return null;
  return relative(workspace.top, absolute);
}

/** Remove now-empty directories from `start` up to (not including) the workspace root. */
async function pruneEmptyDirectories(workspace: Workspace, start: string): Promise<void> {
  let directory = start;
  while (directory.startsWith(workspace.root + sep) && directory !== workspace.root) {
    try {
      if ((await readdir(directory)).length > 0) return;
      await rmdir(directory);
    } catch {
      return;
    }
    directory = resolve(directory, "..");
  }
}

function cap(paths: string[]): string[] {
  return paths.length > MAX_LISTED_PATHS ? paths.slice(0, MAX_LISTED_PATHS) : paths;
}

async function withScratch<T>(run: (scratch: string) => Promise<T>): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), "prism-snapshot-"));
  try {
    return await run(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/** Snapshot the workspace's working tree into `ref`. */
export async function snapshotWorkspace({
  workspaceRoot,
  ref,
  message,
}: {
  workspaceRoot: unknown;
  ref: unknown;
  message?: unknown;
}): Promise<SnapshotResult | NotSnapshotCapable | SnapshotError> {
  const refError = validateSnapshotRef(ref);
  if (refError) return { error: refError };
  const workspace = await resolveWorkspace(workspaceRoot);
  if (!isWorkspace(workspace)) return workspace;
  const snapshotRef = ref as string;

  try {
    return await withScratch(async (scratch) => {
      const createdAt = Date.now();
      const tree = await buildWorkingTree(workspace, scratch, "index");
      const subject = snapshotSubject(
        createdAt,
        snapshotRef,
        typeof message === "string" ? message.slice(0, 500) : undefined,
      );
      const commit = await commitTree(workspace, tree, subject);
      await writeRef(workspace, snapshotRef, commit);
      return {
        snapshotCapable: true as const,
        ref: snapshotRef,
        commit,
        tree,
        head: workspace.head,
        repoRoot: workspace.top,
        workspaceRoot: workspace.root,
        createdAt,
      };
    });
  } catch (error: unknown) {
    return { error: `Snapshot failed: ${errorMessage(error)}` };
  }
}

/**
 * Restore the workspace to the snapshot at `ref`.
 *
 * Files modified or deleted since the snapshot are written back; files
 * created since are removed. Only the workspace pathspec (and, when given,
 * only `paths`) is considered; ignored files never appear in a snapshot, so
 * they are never removed. The user's index and HEAD are never touched.
 *
 * Refused (nothing written) when a path the restore would touch changed after
 * `againstRef` — default: the latest snapshot in the same conversation
 * namespace — unless `force`.
 */
export async function restoreWorkspace({
  workspaceRoot,
  ref,
  againstRef,
  paths,
  agentRanges,
  force = false,
  dryRun = false,
}: {
  workspaceRoot: unknown;
  ref: unknown;
  againstRef?: unknown;
  paths?: unknown;
  agentRanges?: unknown;
  force?: boolean;
  dryRun?: boolean;
}): Promise<RestoreResult | NotSnapshotCapable | SnapshotError> {
  const refError = validateSnapshotRef(ref);
  if (refError) return { error: refError };
  let ranges: AgentRange[] | null = null;
  if (agentRanges !== undefined && agentRanges !== null) {
    if (!Array.isArray(agentRanges)) return { error: "'agentRanges' must be an array of {from, to}" };
    ranges = [];
    for (const range of agentRanges as Array<Record<string, unknown>>) {
      const fromError = validateSnapshotRef(range?.from, "agentRanges[].from");
      if (fromError) return { error: fromError };
      if (range.to !== null && range.to !== undefined) {
        const toError = validateSnapshotRef(range.to, "agentRanges[].to");
        if (toError) return { error: toError };
      }
      ranges.push({ from: range.from as string, to: (range.to as string | undefined) ?? null });
    }
  }
  if (againstRef !== undefined && againstRef !== null) {
    const againstError = validateSnapshotRef(againstRef, "againstRef");
    if (againstError) return { error: againstError };
  }
  if (paths !== undefined && (!Array.isArray(paths) || paths.some((path) => typeof path !== "string"))) {
    return { error: "'paths' must be an array of strings" };
  }
  const workspace = await resolveWorkspace(workspaceRoot);
  if (!isWorkspace(workspace)) return workspace;
  const targetRef = ref as string;

  const target = await runGit(["rev-parse", "--verify", "-q", `${targetRef}^{tree}`], workspace.top);
  if (target.error || !target.stdout.trim()) {
    return { error: `Snapshot ref not found: ${targetRef}`, notFound: true };
  }
  const targetTree = target.stdout.trim();

  let baselineRef: string | null = null;
  if (typeof againstRef === "string") {
    baselineRef = againstRef;
  } else {
    baselineRef = await latestSiblingRef(workspace, targetRef);
  }
  let baselineTree: string | null = null;
  if (baselineRef) {
    const baseline = await runGit(["rev-parse", "--verify", "-q", `${baselineRef}^{tree}`], workspace.top);
    if (baseline.error || !baseline.stdout.trim()) {
      return { error: `Snapshot ref not found: ${baselineRef}`, notFound: true };
    }
    baselineTree = baseline.stdout.trim();
  }

  try {
    return await withScratch(async (scratch) => {
      const currentTree = await buildWorkingTree(workspace, scratch, "current-index");
      let changes = await diffTrees(workspace, targetTree, currentTree);

      // With agent ranges: only what the agent changed is restored, and a
      // conflict is an agent-changed path someone else changed in a gap.
      let gapPaths: Set<string> | null = null;
      if (ranges) {
        const agentPaths = new Set<string>();
        gapPaths = new Set<string>();
        const pathsBetween = async (from: string, to: string) =>
          (await diffTrees(workspace, from, to)).map((change) => change.path);
        let cursor = targetTree;
        for (const range of ranges) {
          const fromTree = await resolveTree(workspace, range.from);
          const toTree = range.to ? await resolveTree(workspace, range.to) : currentTree;
          for (const path of await pathsBetween(cursor, fromTree)) gapPaths.add(path);
          for (const path of await pathsBetween(fromTree, toTree)) agentPaths.add(path);
          cursor = toTree;
        }
        for (const path of await pathsBetween(cursor, currentTree)) gapPaths.add(path);
        changes = changes.filter((change) => agentPaths.has(change.path));
      }

      if (Array.isArray(paths) && paths.length > 0) {
        const wanted = (paths as string[])
          .map((path) => toRepoRelative(workspace, path))
          .filter((path): path is string => path !== null);
        changes = changes.filter((change) =>
          wanted.some((path) => change.path === path || change.path.startsWith(`${path}/`)),
        );
      }

      const skipped = changes.filter((change) => change.gitlink).map((change) => change.path);
      const actionable = changes.filter((change) => !change.gitlink);
      // diff-tree <target> <current>: A = exists now, not in the snapshot → remove;
      // D = in the snapshot, gone now → restore; M / T = changed → restore.
      const toRemove = actionable.filter((change) => change.status === "A").map((change) => change.path);
      const toRestore = actionable.filter((change) => change.status !== "A").map((change) => change.path);

      let conflicts: string[] = [];
      if (gapPaths) {
        const userChanged = gapPaths;
        conflicts = [...toRestore, ...toRemove].filter((path) => userChanged.has(path)).sort();
      } else if (baselineTree) {
        const changedSinceBaseline = new Set(
          (await diffTrees(workspace, baselineTree, currentTree)).map((change) => change.path),
        );
        conflicts = [...toRestore, ...toRemove].filter((path) => changedSinceBaseline.has(path)).sort();
      }

      const relativeTo = (list: string[]) => list.map((path) => toWorkspaceRelative(workspace, path)).sort();
      const report = (overrides: Partial<RestoreResult>): RestoreResult => {
        const restored = relativeTo(toRestore);
        const removed = relativeTo(toRemove);
        const conflictList = relativeTo(conflicts);
        const skippedList = relativeTo(skipped);
        const truncated = [restored, removed, conflictList, skippedList].some(
          (list) => list.length > MAX_LISTED_PATHS,
        );
        return {
          snapshotCapable: true,
          ref: targetRef,
          againstRef: baselineRef,
          repoRoot: workspace.top,
          workspaceRoot: workspace.root,
          dryRun,
          applied: false,
          refused: false,
          conflicts: cap(conflictList),
          restored: cap(restored),
          removed: cap(removed),
          skipped: cap(skippedList),
          counts: {
            restored: restored.length,
            removed: removed.length,
            conflicts: conflictList.length,
            skipped: skippedList.length,
          },
          ...(truncated && { truncated: true }),
          ...overrides,
        };
      };

      if (conflicts.length > 0 && !force) return report({ refused: true });
      if (dryRun) return report({});

      const namespace = targetRef.slice(0, targetRef.lastIndexOf("/") + 1);
      const stamp = Date.now();

      // Keep the pre-restore state so even a forced restore can be undone.
      const undoRef = `${namespace}undo-${stamp}`;
      const undoCommit = await commitTree(workspace, currentTree, snapshotSubject(stamp, undoRef, "pre-restore state"));
      await writeRef(workspace, undoRef, undoCommit);

      // 1. Remove files created after the snapshot (first, so a path that
      //    turned from a directory back into a file can be written).
      const removedDirectories = new Set<string>();
      for (const path of toRemove) {
        const absolute = join(workspace.top, path);
        if (!absolute.startsWith(workspace.root + sep)) continue;
        try {
          const entry = await lstat(absolute);
          if (entry.isDirectory()) continue;
          await rm(absolute, { force: true });
          removedDirectories.add(resolve(absolute, ".."));
        } catch {
          // already gone
        }
      }
      for (const directory of [...removedDirectories].sort((a, b) => b.length - a.length)) {
        await pruneEmptyDirectories(workspace, directory);
      }

      // 2. Write modified / deleted files back from a temporary index of the
      //    snapshot tree. checkout-index writes the working tree only.
      if (toRestore.length > 0) {
        const env = { GIT_INDEX_FILE: join(scratch, "target-index") };
        await mustGit(["read-tree", targetTree], workspace.top, { env });
        await mustGit(["checkout-index", "-f", "-z", "--stdin"], workspace.top, {
          env,
          input: toRestore.join("\0"),
        });
      }

      // 3. The post-restore state becomes the next conflict baseline.
      const afterTree = await buildWorkingTree(workspace, scratch, "after-index");
      const afterRef = `${namespace}restore-${stamp}`;
      const afterCommit = await commitTree(workspace, afterTree, snapshotSubject(stamp + 1, afterRef, `restored ${targetRef}`));
      await writeRef(workspace, afterRef, afterCommit);

      return report({ applied: true, undoRef, afterRef });
    });
  } catch (error: unknown) {
    return { error: `Restore failed: ${errorMessage(error)}` };
  }
}

/**
 * Delete snapshot refs: the listed `refs`, or every ref under `prefix`,
 * optionally only those older than `olderThanMs`. The objects become
 * unreachable and are collected by the repository's normal gc.
 */
export async function deleteWorkspaceSnapshots({
  workspaceRoot,
  refs,
  prefix,
  olderThanMs,
}: {
  workspaceRoot: unknown;
  refs?: unknown;
  prefix?: unknown;
  olderThanMs?: unknown;
}): Promise<DeleteSnapshotsResult | NotSnapshotCapable | SnapshotError> {
  if (refs === undefined && prefix === undefined) {
    return { error: "Provide 'refs' (string[]) or 'prefix' (string)" };
  }
  if (refs !== undefined) {
    if (!Array.isArray(refs)) return { error: "'refs' must be an array of strings" };
    for (const ref of refs) {
      const refError = validateSnapshotRef(ref);
      if (refError) return { error: refError };
    }
  }
  if (prefix !== undefined) {
    const prefixError = validatePrefix(prefix);
    if (prefixError) return { error: prefixError };
  }
  if (olderThanMs !== undefined && (typeof olderThanMs !== "number" || !(olderThanMs >= 0))) {
    return { error: "'olderThanMs' must be a non-negative number" };
  }
  const workspace = await resolveWorkspace(workspaceRoot);
  if (!isWorkspace(workspace)) return workspace;

  try {
    let candidates: ListedRef[];
    if (typeof prefix === "string") {
      candidates = await listRefs(workspace, prefix.endsWith("/") ? prefix : `${prefix}/`);
    } else {
      const all = await listRefs(workspace, SNAPSHOT_REF_PREFIX);
      const wanted = new Set(refs as string[]);
      candidates = all.filter((entry) => wanted.has(entry.ref));
    }
    if (typeof olderThanMs === "number") {
      const cutoff = Date.now() - olderThanMs;
      candidates = candidates.filter((entry) => entry.createdAt < cutoff);
    }
    const deleted = candidates.map((entry) => entry.ref).sort();
    if (deleted.length > 0) {
      await mustGit(["update-ref", "--stdin"], workspace.top, {
        input: deleted.map((ref) => `delete ${ref}\n`).join(""),
      });
    }
    return { snapshotCapable: true, deleted };
  } catch (error: unknown) {
    return { error: `Delete failed: ${errorMessage(error)}` };
  }
}

/** HTTP status for a snapshot-service result. */
export function snapshotResultStatus(result: object): number {
  if ("error" in result) return (result as SnapshotError).notFound ? 404 : 400;
  if ((result as RestoreResult).refused) return 409;
  return 200;
}
