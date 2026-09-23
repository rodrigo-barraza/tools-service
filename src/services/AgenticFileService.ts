import {
  escapeRegex,
  errorMessage,
  getErrorMessage,
  BINARY_FILE_EXTENSIONS,
  PREVIEW_IMAGE_FILE_EXTENSIONS,
  WORKSPACE_MAX_READ_BYTES,
  WORKSPACE_MAX_WRITE_BYTES,
  WORKSPACE_MAX_LINES_PER_READ,
  WORKSPACE_MAX_GREP_RESULTS,
  WORKSPACE_MAX_GLOB_RESULTS,
  WORKSPACE_MAX_DIRECTORY_ENTRIES,
  WORKSPACE_MAX_PREVIEW_BYTES,
  globToRegex,
} from "@rodrigo-barraza/utilities-library";
import type {
  DirectoryEntry,
  TreeEntry,
  GlobMatch,
  FileInfoEntry,
} from "@rodrigo-barraza/utilities-library";
export type { DirectoryEntry, TreeEntry, GlobMatch, FileInfoEntry };
import { requestLocalStorage } from "@rodrigo-barraza/utilities-library/service";
import PromptLocaleService from "./PromptLocaleService.ts";
import {
  lineHash,
  formatHashline,
  formatHashlines,
  parseAnchor,
} from "../utilities/hashline.ts";
// ─── Sandboxed File Operations ──────────────────────────────

import {
  readFile,
  writeFile,
  stat,
  readdir,
  mkdir,
  rename,
  unlink,
  rm,
} from "node:fs/promises";
import { resolve, relative, extname, dirname, basename, join } from "node:path";
import { existsSync, realpathSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  resolveAndRouteToAgent,
  sendRpc,
  offlineRemoteRootForPath,
} from "./AgentConnectionManager.ts";
import logger from "../logger.ts";

// ────────────────────────────────────────────────────────────
// Agent Routing Helper
// ────────────────────────────────────────────────────────────

/**
 * Sentinel returned by tryAgentRoute when no remote agent serves the path, so
 * callers fall back to local execution. Using a distinct sentinel (rather than
 * null/undefined) means a remote handler that legitimately resolves to a falsy
 * value can NEVER be mistaken for "no agent" and silently re-run locally on the
 * wrong machine.
 */
const NO_AGENT = Symbol("no-agent");

/**
 * Route a workspace operation to a remote agent if one serves the target path.
 * Returns the NO_AGENT sentinel if no agent matches (caller falls back to local
 * handling); otherwise returns the remote result (or an { error } object).
 */
async function tryAgentRoute(
  method: string,
  params: Record<string, unknown>,
  targetPath: string,
): Promise<unknown> {
  const agent = resolveAndRouteToAgent(targetPath, ALLOWED_ROOTS[0]);
  if (!agent) {
    const offlineRoot = offlineRemoteRootForPath(targetPath, ALLOWED_ROOTS[0]);
    if (offlineRoot) {
      return {
        error: `The workspace agent serving '${offlineRoot}' is offline, so this path cannot be accessed. Reconnect the workspace agent and retry — the operation was NOT run locally on the server.`,
      };
    }
    return NO_AGENT;
  }
  try {
    return await sendRpc(agent.id, method, params);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    return { error: `Agent RPC failed: ${errorMessage}` };
  }
}

/**
 * Write a file atomically: write to a temp file in the same directory, then
 * rename over the target. A crash mid-write leaves the original intact instead
 * of a truncated file. Matches the remote workspace-service behavior so local
 * and remote writes have the same durability guarantee.
 */
async function writeFileAtomic(resolved: string, data: string): Promise<void> {
  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, data, "utf-8");
    await rename(tmp, resolved);
  } catch (error) {
    // Best-effort cleanup of the temp file on failure.
    try {
      await rm(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}

// Dynamic roots — mutable array populated by agent registration and user config.
// Starts empty; agents add their roots on connect, and user-configured roots
// are loaded from MongoDB at boot.
const ALLOWED_ROOTS: string[] = [];



// Patterns that are always blocked — even within allowed roots
const BLOCKED_PATTERNS = [
  /node_modules\//,
  /\.git\/objects\//,
  /\.git\/hooks\//,
  /\.env$/,
  /\.env\.(?!example|sample|template|defaults|dist).+$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
];

// Image extensions eligible for inline base64 preview (avoids /file/raw round-trip)


// ────────────────────────────────────────────────────────────
// Dynamic Security Settings Caching
// ────────────────────────────────────────────────────────────

import { MongoClient } from "mongodb";
import { getDatabase } from "@rodrigo-barraza/utilities-library/service/mongo";

let settingsClient: MongoClient | null = null;
let cachedAllowEnvFiles = false;
let lastSecuritySettingsCheck = 0;
let settingsFetchPromise: Promise<void> | null = null;

async function getSecuritySettings(): Promise<{ allowEnvFiles: boolean }> {
  try {
    const database = getDatabase();
    const databaseInternal = database as unknown as { client?: { db: (name: string) => import("mongodb").Db }; s?: { client?: { db: (name: string) => import("mongodb").Db } } };
    const client = databaseInternal.client || databaseInternal.s?.client;
    const { default: CONFIG } = await import("../config.ts");
    const prismDb = client ? client.db(CONFIG.PRISM_MONGODB_DB_NAME) : null;
    if (prismDb) {
      const collection = prismDb.collection("settings");
      const doc = await collection.findOne({ _key: "global" });
      if (doc && doc.data && doc.data.security) {
        return { allowEnvFiles: !!doc.data.security.allowEnvFiles };
      }
    } else {
      // Fallback: lazily establish a new connection if needed
      if (!settingsClient) {
        if (CONFIG.MONGODB_URI) {
          settingsClient = new MongoClient(CONFIG.MONGODB_URI);
          await settingsClient.connect();
        }
      }
      if (settingsClient) {
        const doc = await settingsClient
          .db(CONFIG.PRISM_MONGODB_DB_NAME)
          .collection("settings")
          .findOne({ _key: "global" });
        if (doc && doc.data && doc.data.security) {
          return { allowEnvFiles: !!doc.data.security.allowEnvFiles };
        }
      }
    }
  } catch (error) {
    logger.warn(
      `[AgenticFileService] Failed to fetch security settings: ${error}`,
    );
  }
  return { allowEnvFiles: false };
}

function triggerSecuritySettingsRefresh() {
  if (settingsFetchPromise) return;
  const now = Date.now();
  if (now - lastSecuritySettingsCheck < 5000) return; // 5s TTL

  settingsFetchPromise = getSecuritySettings()
    .then((settings) => {
      cachedAllowEnvFiles = settings.allowEnvFiles;
      lastSecuritySettingsCheck = Date.now();
    })
    .finally(() => {
      settingsFetchPromise = null;
    });
}

// ────────────────────────────────────────────────────────────
// Path Validation
// ────────────────────────────────────────────────────────────

/**
 * Resolve symlinks in a path so the sandbox check runs against the REAL
 * location — `path.resolve` only normalizes `..`, so a symlink inside an
 * allowed root pointing outside it would otherwise pass validation.
 * For not-yet-existing targets (writes), the nearest existing ancestor is
 * realpathed and the remaining segments are rejoined.
 */
function resolveSymlinks(targetPath: string): string {
  let existing = targetPath;
  let suffix = "";
  for (;;) {
    try {
      const real = realpathSync(existing);
      return suffix ? join(real, suffix) : real;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return targetPath; // reached filesystem root
      suffix = suffix ? join(basename(existing), suffix) : basename(existing);
      existing = parent;
    }
  }
}

/** Realpath a root for comparison, tolerating roots that don't exist yet. */
function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/**
 * Validate and resolve a path against the sandbox.
 */
function validatePath(inputPath: string | unknown) {
  if (!inputPath || typeof inputPath !== "string") {
    return { safe: false, resolved: "", error: "Path is required (string)" };
  }

  // Sanitize LLM-generated paths: strip surrounding quotes and whitespace.
  // Models sometimes send path values like `"."` or `'./src'` with literal
  // quote characters embedded in the string, producing invalid filesystem paths.
  const sanitizedPath = inputPath.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!sanitizedPath) {
    return { safe: false, resolved: "", error: "Path is required (string)" };
  }

  // Trigger non-blocking lazy refresh of security settings
  triggerSecuritySettingsRefresh();

  const requestStore = requestLocalStorage.getStore();
  const workspaceOverride = requestStore?.workspaceOverride;
  const workspaceRoot = requestStore?.workspaceRoot;

  // Resolve relative paths against the active workspace context, NOT process.cwd().
  // Priority: workspaceOverride (worktree) > workspaceRoot (user-selected) > ALLOWED_ROOTS[0] (static fallback).
  const isRelative = !sanitizedPath.startsWith("/");
  let baseRoot: string;

  if (workspaceOverride && workspaceOverride.startsWith("/tmp/prism-worktrees/")) {
    // Active worktree takes highest priority
    baseRoot = workspaceOverride;
  } else if (workspaceRoot) {
    // User-selected workspace root — validate it's within an allowed root
    const resolvedWorkspaceRoot = resolve(workspaceRoot);
    const isWorkspaceRootAllowed = ALLOWED_ROOTS.some(
      (root: string) =>
        root === "/" ||
        resolvedWorkspaceRoot.startsWith(root + "/") ||
        resolvedWorkspaceRoot === root,
    );
    baseRoot = isWorkspaceRootAllowed ? resolvedWorkspaceRoot : ALLOWED_ROOTS[0];
  } else {
    baseRoot = ALLOWED_ROOTS[0];
  }

  // No local roots at all (e.g. every configured root is remote-only and its
  // agent hasn't connected): error clearly instead of resolve(undefined, …).
  if (isRelative && !baseRoot) {
    return {
      safe: false,
      resolved: "",
      error:
        "No local workspace roots are available on this server. If this workspace lives on another machine, its workspace agent must be connected.",
    };
  }

  const resolved = resolveSymlinks(
    isRelative ? resolve(baseRoot, sanitizedPath) : resolve(sanitizedPath),
  );

  // Check against allowed roots — both as configured and symlink-resolved,
  // so a root that is itself a symlink (or contains one) still matches.
  // A root of "/" means everything: without the special case, "/" + "/"
  // builds "//" which no resolved path starts with, silently denying every
  // request under an allow-all configuration.
  const isWithin = (root: string) =>
    root === "/" ||
    resolved.startsWith(root + "/") ||
    resolved === root ||
    resolved.startsWith(realRoot(root) + "/") ||
    resolved === realRoot(root);

  let inAllowedRoot = ALLOWED_ROOTS.some(isWithin);

  // Also check workspaceOverride
  if (!inAllowedRoot && workspaceOverride && workspaceOverride.startsWith("/tmp/prism-worktrees/")) {
    if (isWithin(workspaceOverride)) {
      inAllowedRoot = true;
    }
  }

  if (!inAllowedRoot) {
    return {
      safe: false,
      resolved,
      error: `Path '${resolved}' is outside allowed roots: ${ALLOWED_ROOTS.join(", ")}`,
    };
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (cachedAllowEnvFiles) {
      const source = pattern.source;
      // Skip environment configurations, keys, and private credentials
      if (
        source === "\\.env$" ||
        source === "\\.env\\.(?!example|sample|template|defaults|dist).+$" ||
        source === "\\.pem$" ||
        source === "\\.key$" ||
        source === "id_rsa" ||
        source === "id_ed25519"
      ) {
        continue;
      }
    }
    if (pattern.test(resolved)) {
      return {
        safe: false,
        resolved,
        error: `Path '${resolved}' matches blocked pattern: ${pattern.source}`,
      };
    }
  }

  return { safe: true, resolved };
}

// ────────────────────────────────────────────────────────────
// File Operations
// ────────────────────────────────────────────────────────────

/**
 * Read file contents with optional line range.
 */
export async function agenticReadFile(
  filePath: string,
  { startLine, endLine }: { startLine?: number; endLine?: number } = {},
) {
  // Agent routing — proxy to remote agent if path is served by one
  const agentResult = await tryAgentRoute(
    "file.read",
    { path: filePath, startLine, endLine },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const resolved = validation.resolved;

  try {
    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      return {
        error: `'${resolved}' is a directory, not a file. Use list_directory instead.`,
      };
    }
    const fileExtension = extname(resolved).toLowerCase();
    if (stats.size > WORKSPACE_MAX_READ_BYTES) {
      // The whole-file gate must not trap the model: honor a line range by
      // streaming just those lines so the advertised recovery actually works.
      if (
        (startLine || endLine) &&
        !BINARY_FILE_EXTENSIONS.has(fileExtension)
      ) {
        return await readOversizedRange(resolved, stats.size, startLine, endLine);
      }
      return {
        error: `File is ${(stats.size / 1024).toFixed(1)} KB — exceeds max whole-file read size of ${(WORKSPACE_MAX_READ_BYTES / 1024).toFixed(0)} KB. Re-call with startLine and endLine to read a portion (a range up to ${WORKSPACE_MAX_LINES_PER_READ} lines is served directly), or use execute_command with sed/grep for targeted extraction.`,
      };
    }

    // Binary detection
    if (BINARY_FILE_EXTENSIONS.has(fileExtension)) {
      const result: Record<string, unknown> = {
        filePath: resolved,
        isBinary: true,
        extension: fileExtension,
        sizeBytes: stats.size,
      };

      // Auto-include base64 for previewable image files under threshold
      if (
        PREVIEW_IMAGE_FILE_EXTENSIONS.has(fileExtension) &&
        stats.size <= WORKSPACE_MAX_PREVIEW_BYTES
      ) {
        const buffer = await readFile(resolved);
        result.contentBase64 = buffer.toString("base64");
      } else {
        result.message = `Binary file detected (${fileExtension}). Content not returned.`;
      }

      return result;
    }

    const raw = await readFile(resolved, "utf-8");
    const allLines = raw.split("\n");
    const totalLines = allLines.length;

    // Reject degenerate ranges explicitly instead of "succeeding" with 0 lines
    // (which reads as an empty file and misleads the model).
    if (startLine && startLine > totalLines) {
      return {
        error: `startLine (${startLine}) exceeds the file length (${totalLines} lines). ${resolved} has lines 1–${totalLines}.`,
      };
    }
    if (startLine && endLine && endLine < startLine) {
      return {
        error: `startLine (${startLine}) is greater than endLine (${endLine}). Provide a range where startLine <= endLine.`,
      };
    }

    // Summarized read by default for large files: a whole-file read of a file
    // exceeding the per-read line cap returns head + tail + a structural
    // outline instead of the first 800 lines. Explicit ranges are always
    // served exactly.
    if (!startLine && !endLine && totalLines > WORKSPACE_MAX_LINES_PER_READ) {
      return summarizedRead(resolved, allLines, stats.size);
    }

    // Apply line range
    const start = startLine ? Math.max(1, startLine) : 1;
    let end = endLine ? Math.min(totalLines, endLine) : totalLines;

    // Enforce max lines per read
    let cappedByMaxLines = false;
    if (end - start + 1 > WORKSPACE_MAX_LINES_PER_READ) {
      end = start + WORKSPACE_MAX_LINES_PER_READ - 1;
      cappedByMaxLines = true;
    }

    const selectedLines = allLines.slice(start - 1, end);
    const hashlineContent = formatHashlines(selectedLines, start);

    const truncated = end < totalLines;
    return {
      filePath: resolved,
      totalLines,
      totalBytes: stats.size,
      startLine: start,
      endLine: Math.min(end, totalLines),
      linesReturned: selectedLines.length,
      lineFormat: "hashline",
      truncated,
      ...(truncated
        ? {
            truncationReason: cappedByMaxLines
              ? `Capped at ${WORKSPACE_MAX_LINES_PER_READ} lines per read.`
              : "More lines follow the requested range.",
            nextStartLine: end + 1,
          }
        : {}),
      content: hashlineContent,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return { error: `Read failed: ${errorMessage(error)}` };
  }
}

// ── Summarized reads ─────────────────────────────────────────

const SUMMARY_HEAD_LINES = 200;
const SUMMARY_TAIL_LINES = 100;
const SUMMARY_MAX_OUTLINE_LINES = 200;

// Column-0 declaration starts across the languages the workspace tools see.
// Deliberately conservative: an outline that misses a symbol still points the
// model at the right region; one that drowns in noise does not.
const OUTLINE_PATTERN =
  /^(export\s|import\s|function\s|async function\s|class\s|interface\s|type\s+[\w$]+\s*=|enum\s|const\s+[\w$]+|def\s+[\w$]|async def\s+[\w$]|fn\s+[\w$]|pub\s|impl[\s<]|struct\s+[\w$]|trait\s+[\w$]|func\s+[\w$]|package\s|namespace\s|module\s|router\.|describe\(|#{1,6}\s)/;

/**
 * Default whole-file read for files larger than the per-read cap: exact head
 * and tail plus a structural outline of the omitted middle, all in hashline
 * format so any shown line is a valid edit anchor. Deterministic for a given
 * file content. Explicit startLine/endLine re-reads serve exact ranges.
 */
function summarizedRead(
  resolved: string,
  allLines: string[],
  sizeBytes: number,
) {
  const totalLines = allLines.length;
  const headEnd = SUMMARY_HEAD_LINES;
  const tailStart = totalLines - SUMMARY_TAIL_LINES + 1;

  const head = formatHashlines(allLines.slice(0, headEnd), 1);
  const tail = formatHashlines(
    allLines.slice(tailStart - 1),
    tailStart,
  );

  // Outline of the omitted middle region only
  const outline: string[] = [];
  let outlineTruncated = false;
  for (let index = headEnd; index < tailStart - 1; index++) {
    if (!OUTLINE_PATTERN.test(allLines[index])) continue;
    if (outline.length >= SUMMARY_MAX_OUTLINE_LINES) {
      outlineTruncated = true;
      break;
    }
    outline.push(formatHashline(index + 1, allLines[index]));
  }

  const omittedStart = headEnd + 1;
  const omittedEnd = tailStart - 1;
  const separatorTop = `⋯ [lines ${omittedStart}–${omittedEnd} omitted (${omittedEnd - omittedStart + 1} lines) — structural outline below; re-read any range with startLine/endLine] ⋯`;
  const separatorBottom = outlineTruncated
    ? `⋯ [outline capped at ${SUMMARY_MAX_OUTLINE_LINES} entries — tail follows] ⋯`
    : "⋯ [end of outline — tail follows] ⋯";

  return {
    filePath: resolved,
    totalLines,
    totalBytes: sizeBytes,
    startLine: 1,
    endLine: totalLines,
    lineFormat: "hashline",
    summarized: true,
    omitted: { startLine: omittedStart, endLine: omittedEnd },
    outlineLines: outline.length,
    outlineTruncated,
    message: PromptLocaleService.get("en", "prompts.file.summarized-read"),
    content: [head, separatorTop, outline.join("\n"), separatorBottom, tail]
      .filter((part) => part.length > 0)
      .join("\n"),
  };
}

/**
 * Read a bounded line range out of a file too large to load whole. Streams
 * line-by-line so memory stays bounded; only lines in [start, end] (capped at
 * WORKSPACE_MAX_LINES_PER_READ) are buffered. totalLines is not known without
 * reading to EOF, so it is reported as null and truncated is true.
 */
async function readOversizedRange(
  resolved: string,
  sizeBytes: number,
  startLine?: number,
  endLine?: number,
): Promise<Record<string, unknown>> {
  const start = startLine ? Math.max(1, startLine) : 1;
  let end = endLine ? Math.max(start, endLine) : start + WORKSPACE_MAX_LINES_PER_READ - 1;
  if (end - start + 1 > WORKSPACE_MAX_LINES_PER_READ) {
    end = start + WORKSPACE_MAX_LINES_PER_READ - 1;
  }
  const collected: string[] = [];
  let lineNo = 0;
  let reachedEof = true;
  const rl = createInterface({
    input: createReadStream(resolved, "utf-8"),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      lineNo++;
      if (lineNo < start) continue;
      if (lineNo > end) {
        reachedEof = false;
        break;
      }
      collected.push(formatHashline(lineNo, line));
    }
  } finally {
    rl.close();
  }
  return {
    filePath: resolved,
    totalLines: reachedEof ? lineNo : null,
    totalBytes: sizeBytes,
    oversized: true,
    lineFormat: "hashline",
    startLine: start,
    endLine: Math.min(end, lineNo),
    linesReturned: collected.length,
    truncated: !reachedEof,
    ...(reachedEof ? {} : { nextStartLine: end + 1 }),
    content: collected.join("\n"),
  };
}

/**
 * Write (create or overwrite) a file.
 */
export async function agenticWriteFile(
  filePath: string,
  content: string,
  { createDirs = true }: { createDirs?: boolean } = {},
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.write",
    { path: filePath, content, createDirs },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (typeof content !== "string") {
    return { error: "'content' must be a string" };
  }

  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > WORKSPACE_MAX_WRITE_BYTES) {
    return {
      error: `Content is ${(bytes / 1024).toFixed(1)} KB — exceeds max write size of ${(WORKSPACE_MAX_WRITE_BYTES / 1024).toFixed(0)} KB.`,
    };
  }

  const resolved = validation.resolved;

  try {
    if (existsSync(resolved)) {
      const targetStat = await stat(resolved);
      if (targetStat.isDirectory()) {
        return {
          error: `'${resolved}' is a directory, not a file. Choose a file path (e.g. ${resolved}/yourfile).`,
        };
      }
    }
    if (createDirs) {
      const dir = dirname(resolved);
      await mkdir(dir, { recursive: true });
    }

    const existed = existsSync(resolved);
    await writeFileAtomic(resolved, content);

    const lines = content.split("\n").length;

    return {
      filePath: resolved,
      created: !existed,
      overwritten: existed,
      bytesWritten: bytes,
      linesWritten: lines,
    };
  } catch (error: unknown) {
    return { error: `Write failed: ${errorMessage(error)}` };
  }
}

// ── Hash-anchored editing ────────────────────────────────────

export type HashlineEditOp = "replace" | "insert_after" | "delete";

export interface HashlineEdit {
  /** `line:hash` anchor from a hashline read. Line 0 = start of file (insert_after only). */
  anchor: string;
  /** Inclusive range end (`line:hash`) for replace/delete spanning multiple lines. */
  endAnchor?: string;
  /** Operation — defaults to "replace". */
  op?: HashlineEditOp;
  /** New text for replace/insert_after. May be multi-line. */
  content?: string;
}

interface ResolvedHashlineEdit {
  index: number;
  op: HashlineEditOp;
  startLine: number;
  endLine: number; // for insert_after: same as startLine (span is the boundary)
  content?: string;
  /** `line:hash` pairs whose hashes must match the current file. */
  anchorsToCheck: Array<{ line: number; hash: string }>;
}

const MAX_HASHLINE_EDITS = 50;
const STALE_ANCHOR_WINDOW = 3; // lines of fresh context on each side

/** Fresh hashline window around a line, for stale-anchor recovery. */
function hashlineWindow(lines: string[], line: number): string {
  const start = Math.max(1, line - STALE_ANCHOR_WINDOW);
  const end = Math.min(lines.length, line + STALE_ANCHOR_WINDOW);
  return formatHashlines(lines.slice(start - 1, end), start);
}

/**
 * Apply hash-anchored edits as ONE all-or-nothing transaction. Every edit
 * references lines by `line:hash` anchors from a prior hashline read; all
 * anchors are validated against the CURRENT file first, and any drifted
 * anchor rejects the whole batch with the fresh hashlines around it — the
 * model re-anchors from the error window instead of re-reading the file.
 * Line numbers refer to the file as read: edits are applied bottom-up, so
 * earlier edits never shift later anchors.
 */
export async function agenticHashlineEdit(
  filePath: string,
  edits: HashlineEdit[],
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.hashEdit",
    { path: filePath, edits },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      error:
        "'edits' must be a non-empty array of { anchor, endAnchor?, op?, content? } operations",
    };
  }
  if (edits.length > MAX_HASHLINE_EDITS) {
    return {
      error: `Maximum ${MAX_HASHLINE_EDITS} edits per call. Received ${edits.length}.`,
    };
  }

  const resolved = validation.resolved;

  try {
    const original = await readFile(resolved, "utf-8");
    const lines = original.split("\n");
    const totalLines = lines.length;

    // ── 1. Parse + structurally validate every edit ──────────
    const resolvedEdits: ResolvedHashlineEdit[] = [];
    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
      const edit = edits[editIndex] ?? ({} as HashlineEdit);
      const editLabel = `Edit ${editIndex + 1}/${edits.length}`;
      const op = edit.op ?? "replace";

      if (!["replace", "insert_after", "delete"].includes(op)) {
        return {
          error: `${editLabel}: unknown op '${String(edit.op)}'. Supported: replace, insert_after, delete. No changes were made.`,
        };
      }
      if (op !== "delete" && typeof edit.content !== "string") {
        return {
          error: `${editLabel}: '${op}' requires 'content' (string). No changes were made.`,
        };
      }
      if (op === "delete" && edit.content !== undefined) {
        return {
          error: `${editLabel}: 'delete' takes no 'content'. Use 'replace' to substitute text. No changes were made.`,
        };
      }

      const anchor = parseAnchor(edit.anchor);
      if (!anchor.ok) {
        return { error: `${editLabel}: ${anchor.error}. No changes were made.` };
      }
      if (anchor.line === 0 && op !== "insert_after") {
        return {
          error: `${editLabel}: anchor line 0 (start of file) is only valid for 'insert_after'. No changes were made.`,
        };
      }

      let endLine = anchor.line;
      let endHash: string | null = null;
      if (edit.endAnchor !== undefined) {
        if (op === "insert_after") {
          return {
            error: `${editLabel}: 'insert_after' takes no 'endAnchor'. No changes were made.`,
          };
        }
        const endAnchor = parseAnchor(edit.endAnchor);
        if (!endAnchor.ok) {
          return {
            error: `${editLabel}: endAnchor: ${endAnchor.error}. No changes were made.`,
          };
        }
        if (endAnchor.line < anchor.line) {
          return {
            error: `${editLabel}: endAnchor line (${endAnchor.line}) precedes anchor line (${anchor.line}). No changes were made.`,
          };
        }
        endLine = endAnchor.line;
        endHash = endAnchor.hash;
      }

      // Range + hash validation is collected below so ALL stale anchors are
      // reported at once; structural errors above still fail fast.
      const anchorsToCheck: Array<{ line: number; hash: string }> = [];
      if (anchor.line > 0) anchorsToCheck.push({ line: anchor.line, hash: anchor.hash });
      if (endHash !== null && endLine !== anchor.line) {
        anchorsToCheck.push({ line: endLine, hash: endHash });
      }

      resolvedEdits.push({
        index: editIndex,
        op,
        startLine: anchor.line,
        endLine,
        content: edit.content,
        anchorsToCheck,
      });
    }

    // ── 2. Validate anchors against the current file ─────────
    const outOfRange: Array<Record<string, unknown>> = [];
    const staleAnchors: Array<Record<string, unknown>> = [];
    for (const resolvedEdit of resolvedEdits) {
      for (const { line, hash } of resolvedEdit.anchorsToCheck) {
        if (line > totalLines) {
          outOfRange.push({
            edit: resolvedEdit.index + 1,
            line,
            totalLines,
          });
          continue;
        }
        const actualHash = lineHash(lines[line - 1]);
        if (actualHash !== hash) {
          staleAnchors.push({
            edit: resolvedEdit.index + 1,
            anchor: `${line}:${hash}`,
            line,
            expectedHash: hash,
            actualHash,
            currentWindow: hashlineWindow(lines, line),
          });
        }
      }
    }

    if (outOfRange.length > 0) {
      return {
        error: `${outOfRange.length} anchor(s) point past the end of the file (${totalLines} lines). Re-read the tail of the file and re-anchor. No changes were made.`,
        code: "line_out_of_range",
        filePath: resolved,
        totalLines,
        outOfRange,
      };
    }

    if (staleAnchors.length > 0) {
      return {
        error: PromptLocaleService.get("en", "prompts.file.stale-anchor"),
        code: "stale_anchor",
        filePath: resolved,
        totalLines,
        staleAnchors,
      };
    }

    // ── 3. Reject overlapping edits ───────────────────────────
    // insert_after occupies the boundary AFTER its line; model it as the
    // half-open point (line, line+1) so it conflicts with a replace/delete
    // covering that line but not with one ending at line-1.
    const spans = resolvedEdits
      .map((resolvedEdit) => ({
        edit: resolvedEdit.index + 1,
        start:
          resolvedEdit.op === "insert_after"
            ? resolvedEdit.startLine + 0.5
            : resolvedEdit.startLine,
        end:
          resolvedEdit.op === "insert_after"
            ? resolvedEdit.startLine + 0.5
            : resolvedEdit.endLine,
      }))
      .sort((a, b) => a.start - b.start);
    for (let spanIndex = 0; spanIndex < spans.length - 1; spanIndex++) {
      if (spans[spanIndex].end >= spans[spanIndex + 1].start) {
        return {
          error: `Edits ${spans[spanIndex].edit} and ${spans[spanIndex + 1].edit} overlap (lines ${spans[spanIndex].start}–${spans[spanIndex].end} vs ${spans[spanIndex + 1].start}–${spans[spanIndex + 1].end}). Merge them into one edit. No changes were made.`,
          code: "overlapping_edits",
          filePath: resolved,
        };
      }
    }

    // ── 4. Apply bottom-up ────────────────────────────────────
    let working = lines;
    const applyOrder = [...resolvedEdits].sort(
      (a, b) => b.startLine - a.startLine,
    );
    for (const resolvedEdit of applyOrder) {
      if (resolvedEdit.op === "insert_after") {
        const inserted = resolvedEdit.content!.split("\n");
        working = [
          ...working.slice(0, resolvedEdit.startLine),
          ...inserted,
          ...working.slice(resolvedEdit.startLine),
        ];
      } else {
        const replacement =
          resolvedEdit.op === "delete"
            ? []
            : resolvedEdit.content!.split("\n");
        working = [
          ...working.slice(0, resolvedEdit.startLine - 1),
          ...replacement,
          ...working.slice(resolvedEdit.endLine),
        ];
      }
    }

    await writeFileAtomic(resolved, working.join("\n"));

    return {
      filePath: resolved,
      editsApplied: edits.length,
      totalLines: working.length,
      lineDelta: working.length - totalLines,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return { error: `edit failed: ${errorMessage(error)}` };
  }
}

/**
 * Apply a unified diff patch to a file.
 */
export async function agenticPatchFile(filePath: string, patch: string) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.patch",
    { path: filePath, patch },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!patch || typeof patch !== "string") {
    return {
      error: "'patch' is required and must be a string (unified diff format)",
    };
  }

  const resolved = validation.resolved;

  try {
    const { applyPatch } = await import("diff");
    const content = await readFile(resolved, "utf-8");
    const patched = applyPatch(content, patch);

    if (patched === false) {
      return {
        error: PromptLocaleService.get("en", "prompts.file.patch-context-mismatch"),
        filePath: resolved,
      };
    }

    await writeFileAtomic(resolved, patched);

    const oldLines = content.split("\n").length;
    const newLines = patched.split("\n").length;

    return {
      filePath: resolved,
      success: true,
      oldLines,
      newLines,
      lineDelta: newLines - oldLines,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return {
      error: `patch_file failed: ${errorMessage(error)}`,
    };
  }
}

/**
 * List directory contents with metadata.
 */


export async function agenticListDirectory(
  dirPath: string,
  {
    recursive = false,
    maxDepth = 3,
  }: { recursive?: boolean; maxDepth?: number } = {},
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "directory.list",
    { path: dirPath, recursive, maxDepth },
    dirPath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(dirPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const resolved = validation.resolved;

  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) {
      return {
        error: `'${resolved}' is a file, not a directory. Use read_file instead.`,
      };
    }

    const entries: DirectoryEntry[] = [];

    async function walk(dir: string, depth: number) {
      if (entries.length >= WORKSPACE_MAX_DIRECTORY_ENTRIES) return;
      if (depth > maxDepth) return;

      const dirEntries = await readdir(dir, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (entries.length >= WORKSPACE_MAX_DIRECTORY_ENTRIES) break;

        const fullPath = resolve(dir, entry.name);
        const relativePath = relative(resolved, fullPath);

        // Skip blocked paths
        const pathValidation = validatePath(fullPath);
        if (!pathValidation.safe) continue;

        if (entry.isDirectory()) {
          entries.push({
            name: entry.name,
            path: relativePath,
            isDir: true,
          });
          if (recursive && depth < maxDepth) {
            await walk(fullPath, depth + 1);
          }
        } else {
          try {
            const fileStat = await stat(fullPath);
            entries.push({
              name: entry.name,
              path: relativePath,
              isDir: false,
              sizeBytes: fileStat.size,
            });
          } catch {
            entries.push({
              name: entry.name,
              path: relativePath,
              isDir: false,
            });
          }
        }
      }
    }

    await walk(resolved, 1);

    return {
      directory: resolved,
      totalEntries: entries.length,
      truncated: entries.length >= WORKSPACE_MAX_DIRECTORY_ENTRIES,
      entries,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `Directory not found: ${resolved}` };
    }
    return {
      error: `list_directory failed: ${errorMessage(error)}`,
    };
  }
}

/**
 * Get directory tree structure.
 * Returns nested directory tree representation for SystemPromptAssembler.
 */
export async function agenticGetDirectoryTree(
  directoryPath: string,
  maxDepth = 2,
) {
  const agentResult = await tryAgentRoute(
    "directory.tree",
    { path: directoryPath, maxDepth },
    directoryPath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(directoryPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const resolved = validation.resolved;

  try {
    const fileStats = await stat(resolved);
    if (!fileStats.isDirectory()) {
      return {
        error: `'${resolved}' is a file, not a directory.`,
      };
    }

    async function buildTree(currentDirectory: string, currentDepth: number): Promise<TreeEntry[]> {
      if (currentDepth > maxDepth) return [];

      const directoryEntries = await readdir(currentDirectory, { withFileTypes: true });
      const treeEntries: TreeEntry[] = [];

      for (const entry of directoryEntries) {
        const fullPath = resolve(currentDirectory, entry.name);
        const relativePath = relative(resolved, fullPath);

        const pathValidation = validatePath(fullPath);
        if (!pathValidation.safe) continue;

        if (entry.isDirectory()) {
          const children = currentDepth < maxDepth ? await buildTree(fullPath, currentDepth + 1) : [];
          treeEntries.push({
            name: entry.name,
            path: relativePath,
            type: "directory",
            children,
          });
        } else {
          treeEntries.push({
            name: entry.name,
            path: relativePath,
            type: "file",
          });
        }
      }

      return treeEntries;
    }

    const entries = await buildTree(resolved, 1);
    return { entries };
  } catch (error: unknown) {
    return {
      error: `Directory tree fetch failed: ${errorMessage(error)}`,
    };
  }
}

/**
 * Search for pattern matches within files (ripgrep-style).
 */
export interface GrepResult {
  file: string;
  line: number;
  content: string;
}

export async function agenticGrepSearch(
  pattern: string,
  searchPath: string,
  {
    isRegex = false,
    includes = [],
    caseInsensitive = false,
    matchPerLine = true,
  }: {
    isRegex?: boolean;
    includes?: string[];
    caseInsensitive?: boolean;
    matchPerLine?: boolean;
  } = {},
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "search.grep",
    { pattern, searchPath, isRegex, includes, caseInsensitive, matchPerLine },
    searchPath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(searchPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!pattern || typeof pattern !== "string") {
    return { error: "'pattern' is required and must be a non-empty string" };
  }

  const resolved = validation.resolved;

  try {
    let regex: RegExp;
    try {
      regex = isRegex
        ? new RegExp(pattern, caseInsensitive ? "gi" : "g")
        : new RegExp(escapeRegex(pattern), caseInsensitive ? "gi" : "g");
    } catch (error: unknown) {
      return {
        error: `Invalid regex pattern: ${errorMessage(error)}`,
      };
    }

    const results: GrepResult[] = [];
    const fileMatches = new Set<string>();
    let skippedOversized = 0;
    let skippedBinary = 0;
    let capReached = false;

    // Precompile include globs so "**/*.ts", "src/**/*.ts", and "*.ts" all
    // work — the old code only handled suffix "*.ext" and exact names, so any
    // path-glob silently matched nothing and grep reported 0 matches.
    const includeRegexes: RegExp[] = includes
      .filter((g): g is string => typeof g === "string" && g.length > 0)
      .map((g) => globToRegex(g));
    const matchesInclude = (name: string, relPath: string): boolean => {
      if (includeRegexes.length === 0) return true;
      return includeRegexes.some((r) => r.test(name) || r.test(relPath));
    };

    // In file-list mode (matchPerLine:false) results[] never grows, so the
    // cap must gate on fileMatches instead — otherwise the search is unbounded.
    const capHit = () =>
      matchPerLine
        ? results.length >= WORKSPACE_MAX_GREP_RESULTS
        : fileMatches.size >= WORKSPACE_MAX_GREP_RESULTS;

    async function searchFile(filePath: string) {
      if (capHit()) {
        capReached = true;
        return;
      }

      const fileExtension = extname(filePath).toLowerCase();
      if (BINARY_FILE_EXTENSIONS.has(fileExtension)) {
        skippedBinary++;
        return;
      }

      // Check blocked patterns
      const pathCheck = validatePath(filePath);
      if (!pathCheck.safe) return;

      try {
        const fileStat = await stat(filePath);
        if (fileStat.size > WORKSPACE_MAX_READ_BYTES) {
          skippedOversized++;
          return;
        }

        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (capHit()) {
            capReached = true;
            break;
          }

          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            fileMatches.add(filePath);
            if (matchPerLine) {
              results.push({
                file: filePath,
                line: i + 1,
                content:
                  lines[i].length > 500
                    ? lines[i].slice(0, 500) + "..."
                    : lines[i],
              });
            } else {
              // File-list mode: one match is enough for this file.
              break;
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    async function walkDir(dir: string) {
      if (capHit()) {
        capReached = true;
        return;
      }

      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (capHit()) {
            capReached = true;
            break;
          }

          const fullPath = resolve(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip node_modules, .git
            if (entry.name === "node_modules" || entry.name === ".git")
              continue;
            await walkDir(fullPath);
          } else {
            if (!matchesInclude(entry.name, relative(resolved, fullPath))) continue;
            await searchFile(fullPath);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }

    const stats_ = await stat(resolved);
    if (stats_.isFile()) {
      await searchFile(resolved);
    } else {
      await walkDir(resolved);
    }

    const skipNote =
      skippedOversized || skippedBinary
        ? {
            skippedOversized,
            skippedBinary,
            skipNote: `${skippedOversized} file(s) skipped for exceeding the size limit and ${skippedBinary} binary file(s) were not searched.`,
          }
        : {};

    if (!matchPerLine) {
      return {
        pattern,
        searchPath: resolved,
        matchingFiles: [...fileMatches],
        totalFiles: fileMatches.size,
        truncated: capReached,
        ...skipNote,
      };
    }

    return {
      pattern,
      searchPath: resolved,
      totalMatches: results.length,
      truncated: capReached,
      ...skipNote,
      results,
    };
  } catch (error: unknown) {
    return {
      error: `search_file_contents failed: ${errorMessage(error)}`,
    };
  }
}

/**
 * Find files by glob pattern.
 */

export async function agenticGlobFiles(pattern: string, searchPath: string) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "search.glob",
    { pattern, searchPath },
    searchPath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(searchPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!pattern || typeof pattern !== "string") {
    return { error: "'pattern' is required and must be a non-empty string" };
  }

  const resolved = validation.resolved;
  const matches: GlobMatch[] = [];

  // Convert simple glob to regex
  const globRegex = globToRegex(pattern);

  async function walk(dir: string) {
    if (matches.length >= WORKSPACE_MAX_GLOB_RESULTS) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (matches.length >= WORKSPACE_MAX_GLOB_RESULTS) break;

        const fullPath = resolve(dir, entry.name);
        const relativePath = relative(resolved, fullPath);

        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          await walk(fullPath);
        } else {
          if (globRegex.test(relativePath) || globRegex.test(entry.name)) {
            const pathCheck = validatePath(fullPath);
            if (!pathCheck.safe) continue;

            try {
              const fileStat = await stat(fullPath);
              matches.push({
                path: fullPath,
                relativePath: relativePath,
                name: entry.name,
                sizeBytes: fileStat.size,
              });
            } catch {
              matches.push({
                path: fullPath,
                relativePath: relativePath,
                name: entry.name,
              });
            }
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  try {
    await walk(resolved);

    return {
      pattern,
      searchPath: resolved,
      totalMatches: matches.length,
      truncated: matches.length >= WORKSPACE_MAX_GLOB_RESULTS,
      matches,
    };
  } catch (error: unknown) {
    return {
      error: `find_files failed: ${errorMessage(error)}`,
    };
  }
}

// ────────────────────────────────────────────────────────────
// Multi-File Read
// ────────────────────────────────────────────────────────────

/**
 * Read multiple files in a single call.
 */
export interface MultiFileReadItem {
  absolutePath: string;
  startLine?: number;
  endLine?: number;
}

export async function agenticMultiFileRead(files: MultiFileReadItem[]) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      error:
        "'files' must be a non-empty array of { absolutePath, startLine?, endLine? }",
    };
  }
  if (files.length > 20) {
    return {
      error: `Maximum 20 files per batch read. Received ${files.length}.`,
    };
  }

  const results = await Promise.all(
    files.map(async (fileItem: MultiFileReadItem) => {
      const result = await agenticReadFile(fileItem.absolutePath, {
        startLine: fileItem.startLine,
        endLine: fileItem.endLine,
      });
      return { absolutePath: fileItem.absolutePath, ...result };
    }),
  );

  const succeeded = results.filter(
    (result) => !('error' in result),
  ).length;
  const failed = results.filter(
    (result) => 'error' in result,
  ).length;

  return {
    totalRequested: files.length,
    succeeded,
    failed,
    results,
  };
}

// ────────────────────────────────────────────────────────────
// File Info (Stat)
// ────────────────────────────────────────────────────────────

/**
 * Get metadata for one or more files without reading content.
 */

export async function agenticFileInfo(paths: string | string[]) {
  const pathList: string[] = Array.isArray(paths) ? paths : [paths];

  if (pathList.length === 0) {
    return { error: "'paths' must be a non-empty string or array of strings" };
  }
  if (pathList.length > 20) {
    return {
      error: `Maximum 20 paths per batch. Received ${pathList.length}.`,
    };
  }

  // Agent routing is per-path, not per-batch: a single batch can mix paths
  // served by a remote agent with local ones, so routing the whole batch by
  // its first path would stat the wrong machine for the rest.
  const results = await Promise.all(
    pathList.map(async (filePath: string) => {
      const agentResult = await tryAgentRoute(
        "file.info",
        { paths: [filePath] },
        filePath,
      );
      if (agentResult !== NO_AGENT) {
        // Remote single-path file.info returns a bare entry; normalize
        // routing-level failures (agent offline, RPC error) into entry shape.
        const entry = agentResult as Record<string, unknown>;
        if (entry && typeof entry === "object" && "error" in entry && !("path" in entry)) {
          return { path: filePath, exists: false, error: entry.error };
        }
        return entry;
      }

      const validation = validatePath(filePath);
      if (!validation.safe) {
        return { path: filePath, exists: false, error: validation.error };
      }

      const resolved = validation.resolved;
      try {
        const stats = await stat(resolved);
        const fileExtension = extname(resolved).toLowerCase();
        const info: FileInfoEntry = {
          path: resolved,
          exists: true,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          sizeBytes: stats.size,
          lastModified: stats.mtime.toISOString(),
          extension: fileExtension || null,
          isBinary: BINARY_FILE_EXTENSIONS.has(fileExtension),
        };

        // Line count for text files
        if (
          stats.isFile() &&
          !BINARY_FILE_EXTENSIONS.has(fileExtension) &&
          stats.size <= WORKSPACE_MAX_READ_BYTES
        ) {
          try {
            const content = await readFile(resolved, "utf-8");
            info.lines = content.split("\n").length;
          } catch {
            // Non-fatal — skip line counting
          }
        }

        return info;
      } catch (error: unknown) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
          return { path: resolved, exists: false };
        }
        return {
          path: resolved,
          exists: false,
          error: errorMessage(error),
        };
      }
    }),
  );

  if (pathList.length === 1) {
    return results[0];
  }

  return {
    totalRequested: pathList.length,
    results,
  };
}

// ────────────────────────────────────────────────────────────
// File Diff
// ────────────────────────────────────────────────────────────

/**
 * Generate a unified diff between two files or between a file and provided content.
 */
export async function agenticFileDiff(
  pathA: string,
  {
    pathB,
    content,
    contextLines = 3,
  }: { pathB?: string; content?: string; contextLines?: number } = {},
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.diff",
    { pathA, pathB, content, contextLines },
    pathA,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  if (!pathA) {
    return { error: "'pathA' is required" };
  }
  if (!pathB && content === undefined) {
    return { error: "Either 'pathB' or 'content' must be provided" };
  }

  const validA = validatePath(pathA);
  if (!validA.safe) {
    return { error: validA.error };
  }

  try {
    const contentA = await readFile(validA.resolved, "utf-8");
    let contentB = "";
    let labelB = "";

    if (pathB) {
      const validB = validatePath(pathB);
      if (!validB.safe) {
        return { error: validB.error };
      }
      contentB = await readFile(validB.resolved, "utf-8");
      labelB = validB.resolved;
    } else {
      contentB = content || "";
      labelB = "(provided content)";
    }

    const { createTwoFilesPatch } = await import("diff");
    const diff = createTwoFilesPatch(
      validA.resolved,
      labelB,
      contentA,
      contentB,
      "",
      "",
      { context: Math.min(contextLines, 10) },
    ) as string;

    const hasChanges = diff.includes("@@");
    const additions = (diff.match(/^\+[^+]/gm) || []).length;
    const deletions = (diff.match(/^-[^-]/gm) || []).length;

    return {
      pathA: validA.resolved,
      pathB: labelB,
      hasChanges,
      additions,
      deletions,
      diff: hasChanges ? diff : "(files are identical)",
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File not found: ${String(nodeError.path || pathA)}` };
    }
    return {
      error: `diff_files failed: ${errorMessage(error)}`,
    };
  }
}

// ────────────────────────────────────────────────────────────
// Move / Rename File
// ────────────────────────────────────────────────────────────

/**
 * Move or rename a file within allowed roots.
 */
export async function agenticMoveFile(
  source: string,
  destination: string,
  { createDirs = true }: { createDirs?: boolean } = {},
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.move",
    { source, destination, createDirs },
    source,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validSource = validatePath(source);
  if (!validSource.safe) {
    return { error: validSource.error };
  }
  const validDestination = validatePath(destination);
  if (!validDestination.safe) {
    return { error: validDestination.error };
  }

  try {
    if (!existsSync(validSource.resolved)) {
      return { error: `Source not found: ${validSource.resolved}` };
    }
    if (existsSync(validDestination.resolved)) {
      return {
        error: `Destination already exists: ${validDestination.resolved}. Delete it first or choose a different path.`,
      };
    }

    if (createDirs) {
      await mkdir(dirname(validDestination.resolved), { recursive: true });
    }

    await rename(validSource.resolved, validDestination.resolved);

    return {
      source: validSource.resolved,
      destination: validDestination.resolved,
      success: true,
    };
  } catch (error: unknown) {
    return {
      error: `move_file failed: ${errorMessage(error)}`,
    };
  }
}

// ────────────────────────────────────────────────────────────
// Delete File
// ────────────────────────────────────────────────────────────

/**
 * Delete a file within allowed roots.
 */
export async function agenticDeleteFile(
  filePath: string,
  { recursive = false }: { recursive?: boolean } = {},
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.delete",
    { path: filePath, recursive },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  try {
    const stats = await stat(validation.resolved);
    const sizeBytes = stats.isDirectory() ? 0 : stats.size;

    if (stats.isDirectory()) {
      if (!recursive) {
        return {
          error: `'${validation.resolved}' is a directory. Only files can be deleted with this tool, unless the 'recursive' parameter is set to true.`,
        };
      }
      await rm(validation.resolved, { recursive: true, force: true });
    } else {
      await unlink(validation.resolved);
    }

    return {
      filePath: validation.resolved,
      deleted: true,
      isDirectory: stats.isDirectory(),
      sizeBytes,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File or directory not found: ${validation.resolved}` };
    }
    return {
      error: `delete_file failed: ${errorMessage(error)}`,
    };
  }
}

// ────────────────────────────────────────────────────────────
// Surgical Block & Multi-Block Editing
// ────────────────────────────────────────────────────────────

/**
 * Perform a targeted block replacement in a file bounded by startLine and endLine.
 * Verifies that the targeted range contains the exact 'targetContent', then replaces it.
 */
export async function agenticBlockReplace(
  filePath: string,
  startLine: number,
  endLine: number,
  targetContent: string,
  replacementContent: string,
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.blockReplace",
    { path: filePath, startLine, endLine, targetContent, replacementContent },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (typeof startLine !== "number" || startLine <= 0) {
    return { error: "'startLine' must be a positive integer" };
  }
  if (typeof endLine !== "number" || endLine < startLine) {
    return {
      error: "'endLine' must be an integer greater than or equal to startLine",
    };
  }
  if (typeof targetContent !== "string") {
    return { error: "'targetContent' must be a string" };
  }
  if (typeof replacementContent !== "string") {
    return { error: "'replacementContent' must be a string" };
  }

  const resolved = validation.resolved;

  try {
    const raw = await readFile(resolved, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;

    if (startLine > totalLines || endLine > totalLines) {
      return {
        error: `Line range [${startLine}, ${endLine}] exceeds total file lines (${totalLines})`,
        filePath: resolved,
      };
    }

    // Extract the target segment to match against targetContent
    const segment = lines.slice(startLine - 1, endLine).join("\n");

    // Precise match (including whitespace)
    if (segment !== targetContent) {
      const numberedActual = lines
        .slice(startLine - 1, endLine)
        .map((l: string, i: number) => `${startLine + i}: ${l}`)
        .join("\n");
      return {
        error: `Content in line range [${startLine}, ${endLine}] does not match targetContent.`,
        filePath: resolved,
        actualContentInRange: numberedActual,
      };
    }

    // Replace the segment
    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const newSegmentLines = replacementContent.split("\n");
    const updatedContent = [...before, ...newSegmentLines, ...after].join("\n");

    await writeFileAtomic(resolved, updatedContent);

    const oldLinesCount = endLine - startLine + 1;
    const newLinesCount = newSegmentLines.length;

    return {
      filePath: resolved,
      success: true,
      oldLines: oldLinesCount,
      newLines: newLinesCount,
      lineDelta: newLinesCount - oldLinesCount,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return {
      error: `block_replace failed: ${errorMessage(error)}`,
    };
  }
}

export interface MultiReplaceChunk {
  startLine: number;
  endLine: number;
  targetContent: string;
  replacementContent: string;
}

/**
 * Perform multiple non-contiguous block replacements in a single file atomically.

 * Processed from bottom-to-top to ensure subsequent line index stability.
 */
export async function agenticMultiReplace(
  filePath: string,
  chunks: MultiReplaceChunk[],
) {
  // Agent routing
  const agentResult = await tryAgentRoute(
    "file.multiReplace",
    { path: filePath, chunks },
    filePath,
  );
  if (agentResult !== NO_AGENT) return agentResult as Record<string, unknown>;

  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      error: "'chunks' must be a non-empty array of replacement chunks",
    };
  }
  if (chunks.length > 30) {
    return { error: `Maximum 30 chunks per batch. Received ${chunks.length}.` };
  }

  // Validate each chunk parameter type
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (typeof chunk.startLine !== "number" || chunk.startLine <= 0) {
      return { error: `Chunk ${i}: 'startLine' must be a positive integer` };
    }
    if (typeof chunk.endLine !== "number" || chunk.endLine < chunk.startLine) {
      return {
        error: `Chunk ${i}: 'endLine' must be an integer greater than or equal to startLine`,
      };
    }
    if (typeof chunk.targetContent !== "string") {
      return { error: `Chunk ${i}: 'targetContent' must be a string` };
    }
    if (typeof chunk.replacementContent !== "string") {
      return { error: `Chunk ${i}: 'replacementContent' must be a string` };
    }
  }

  const resolved = validation.resolved;

  try {
    const raw = await readFile(resolved, "utf-8");
    let lines = raw.split("\n");

    // Check for overlap between chunks
    const sortedAsc = [...chunks].sort(
      (firstItem, b) => firstItem.startLine - b.startLine,
    );
    for (let i = 0; i < sortedAsc.length - 1; i++) {
      if (sortedAsc[i].endLine >= sortedAsc[i + 1].startLine) {
        return {
          error: `Chunks overlap or touch: Chunk at [${sortedAsc[i].startLine}, ${sortedAsc[i].endLine}] overlaps/touches [${sortedAsc[i + 1].startLine}, ${sortedAsc[i + 1].endLine}]`,
          filePath: resolved,
        };
      }
    }

    // Sort descending by startLine so we replace bottom-to-top without affecting subsequent indices
    const sortedDesc = [...chunks].sort(
      (firstItem, b) => b.startLine - firstItem.startLine,
    );
    const chunkResults = [];
    let overallLineDelta = 0;

    for (let index = 0; index < sortedDesc.length; index++) {
      const chunk = sortedDesc[index];
      const totalLines = lines.length;

      if (chunk.startLine > totalLines || chunk.endLine > totalLines) {
        return {
          error: `Chunk range [${chunk.startLine}, ${chunk.endLine}] exceeds total file lines (${totalLines})`,
          filePath: resolved,
        };
      }

      const segment = lines
        .slice(chunk.startLine - 1, chunk.endLine)
        .join("\n");
      if (segment !== chunk.targetContent) {
        const numberedActual = lines
          .slice(chunk.startLine - 1, chunk.endLine)
          .map((l: string, i: number) => `${chunk.startLine + i}: ${l}`)
          .join("\n");
        return {
          error: `Chunk in range [${chunk.startLine}, ${chunk.endLine}] does not match targetContent.`,
          filePath: resolved,
          actualContentInRange: numberedActual,
        };
      }

      // Perform replace
      const before = lines.slice(0, chunk.startLine - 1);
      const after = lines.slice(chunk.endLine);
      const newSegmentLines = chunk.replacementContent.split("\n");
      lines = [...before, ...newSegmentLines, ...after];

      const oldLinesCount = chunk.endLine - chunk.startLine + 1;
      const newLinesCount = newSegmentLines.length;
      const delta = newLinesCount - oldLinesCount;
      overallLineDelta += delta;

      chunkResults.push({
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        oldLines: oldLinesCount,
        newLines: newLinesCount,
        lineDelta: delta,
      });
    }

    // Write back updated content
    await writeFileAtomic(resolved, lines.join("\n"));

    return {
      filePath: resolved,
      success: true,
      chunksProcessed: chunkResults.length,
      overallLineDelta,
      details: chunkResults.reverse(),
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return {
      error: `multi_replace failed: ${errorMessage(error)}`,
    };
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

// escapeRegex — imported from @rodrigo-barraza/utilities-library



// Export validatePath and ALLOWED_ROOTS for reuse in other agentic services
export { validatePath, ALLOWED_ROOTS };

/**
 * Normalize a workspace path for the host OS.
 * Windows-style paths (e.g. C:\Users\foo) are translated to WSL mount
 * paths (/mnt/c/Users/foo) when the server runs on Linux/macOS.
 * All other paths are resolved as POSIX absolute paths.
 */
export function normalizeWorkspacePath(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  const windowsPathMatch = trimmed.match(/^([A-Za-z]):[/\\](.*)/);
  if (windowsPathMatch) {
    const driveLetter = windowsPathMatch[1].toLowerCase();
    const remainingPath = windowsPathMatch[2].replace(/\\/g, "/");
    return `/mnt/${driveLetter}/${remainingPath}`;
  }

  return resolve(trimmed);
}

/**
 * Merge extra roots (from MongoDB user config or agents) into ALLOWED_ROOTS.
 * Duplicates are de-duped.
 * Mutates the array in-place so all importers see the update.
 * Windows paths are auto-translated to WSL mount paths on Linux hosts.
 */
export function refreshAllowedRoots(extraRoots: string[] = []) {
  const resolved = extraRoots
    .filter((r: string) => r && typeof r === "string")
    .map((r: string) => normalizeWorkspacePath(r))
    .filter((r): r is string => r !== null);

  const merged: string[] = [];
  for (const root of resolved) {
    if (!merged.includes(root)) {
      merged.push(root);
    }
  }

  // Mutate in-place so importers see the change
  ALLOWED_ROOTS.length = 0;
  ALLOWED_ROOTS.push(...merged);
}

/**
 * Get the file service metadata (for health checks).
 */
export function getAgenticFileHealth() {
  return {
    allowedRoots: ALLOWED_ROOTS,
    maxReadBytes: WORKSPACE_MAX_READ_BYTES,
    maxWriteBytes: WORKSPACE_MAX_WRITE_BYTES,
    maxLinesPerRead: WORKSPACE_MAX_LINES_PER_READ,
    maxGrepResults: WORKSPACE_MAX_GREP_RESULTS,
    maxGlobResults: WORKSPACE_MAX_GLOB_RESULTS,
    maxDirEntries: WORKSPACE_MAX_DIRECTORY_ENTRIES,
  };
}
