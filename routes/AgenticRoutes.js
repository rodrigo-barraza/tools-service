// ============================================================
// Agentic Routes — File System & Web Interaction Endpoints
// ============================================================
// Exposes sandboxed file operations and web fetching for
// AI agentic loops. All file operations are restricted to
// configured allowed directories.
//
// Mounted at: /agentic
// ============================================================

import { Router } from "express";
import {
  agenticReadFile,
  agenticWriteFile,
  agenticStrReplace,
  agenticPatchFile,
  agenticListDirectory,
  agenticGrepSearch,
  agenticGlobFiles,
} from "../services/AgenticFileService.js";
import {
  agenticFetchUrl,
  agenticWebSearch,
} from "../services/AgenticWebService.js";
import {
  agenticMultiFileRead,
  agenticFileInfo,
  agenticFileDiff,
  agenticMoveFile,
  agenticDeleteFile,
} from "../services/AgenticFileService.js";
import {
  executeCommand,
  executeCommandStreaming,
  getAllowedCommands,
} from "../services/AgenticCommandService.js";
import {
  agenticGitStatus,
  agenticGitDiff,
  agenticGitLog,
  agenticGitWorktreeCreate,
  agenticGitWorktreeRemove,
  agenticGitWorktreeMerge,
  agenticGitWorktreeDiff,
  agenticGitWorktreeCleanup,
} from "../services/AgenticGitService.js";
import { agenticProjectSummary } from "../services/AgenticProjectService.js";
import {
  agenticBrowserAction,
  getBrowserHealth,
} from "../services/AgenticBrowserService.js";
import {
  agenticLspAction,
  agenticLspShutdown,
  agenticLspHealth,
} from "../services/AgenticLspService.js";
import {
  testTool,
  testAllTools,
  getTestableTools,
} from "../services/AgenticToolTestService.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════
// 1. File Operations
// ═══════════════════════════════════════════════════════════════

// ── Read File ─────────────────────────────────────────────────

router.post("/file/read", async (req, res) => {
  const { path, startLine, endLine } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }

  const result = await agenticReadFile(path, {
    startLine: startLine ? parseInt(startLine) : undefined,
    endLine: endLine ? parseInt(endLine) : undefined,
  });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── Write File ────────────────────────────────────────────────

router.post("/file/write", async (req, res) => {
  const { path, content, createDirs } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }
  if (typeof content !== "string") {
    return res.status(400).json({ error: "Request body must include 'content' (string)" });
  }

  const result = await agenticWriteFile(path, content, {
    createDirs: createDirs !== false,
  });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── String Replace ────────────────────────────────────────────

router.post("/file/str-replace", async (req, res) => {
  const { path, oldStr, newStr, allowMultiple } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }
  if (!oldStr || typeof oldStr !== "string") {
    return res.status(400).json({ error: "Request body must include 'oldStr' (non-empty string)" });
  }
  if (typeof newStr !== "string") {
    return res.status(400).json({ error: "Request body must include 'newStr' (string)" });
  }

  const result = await agenticStrReplace(path, oldStr, newStr, {
    allowMultiple: allowMultiple === true,
  });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── Patch File (unified diff) ─────────────────────────────────

router.post("/file/patch", async (req, res) => {
  const { path, patch } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }
  if (!patch || typeof patch !== "string") {
    return res.status(400).json({ error: "Request body must include 'patch' (unified diff string)" });
  }

  const result = await agenticPatchFile(path, patch);

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 2. Directory Operations
// ═══════════════════════════════════════════════════════════════

router.post("/directory/list", async (req, res) => {
  const { path, recursive, maxDepth } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }

  const result = await agenticListDirectory(path, {
    recursive: recursive === true,
    maxDepth: maxDepth ? Math.min(parseInt(maxDepth), 5) : 3,
  });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 3. Search Operations
// ═══════════════════════════════════════════════════════════════

// ── Grep Search ───────────────────────────────────────────────

router.post("/search/grep", async (req, res) => {
  const { pattern, searchPath, isRegex, includes, caseInsensitive, matchPerLine } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return res.status(400).json({ error: "Request body must include 'pattern' (string)" });
  }
  if (!searchPath || typeof searchPath !== "string") {
    return res.status(400).json({ error: "Request body must include 'searchPath' (string)" });
  }

  const result = await agenticGrepSearch(pattern, searchPath, {
    isRegex: isRegex === true,
    includes: Array.isArray(includes) ? includes : [],
    caseInsensitive: caseInsensitive === true,
    matchPerLine: matchPerLine !== false,
  });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── Glob Files ────────────────────────────────────────────────

router.post("/search/glob", async (req, res) => {
  const { pattern, searchPath } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return res.status(400).json({ error: "Request body must include 'pattern' (string)" });
  }
  if (!searchPath || typeof searchPath !== "string") {
    return res.status(400).json({ error: "Request body must include 'searchPath' (string)" });
  }

  const result = await agenticGlobFiles(pattern, searchPath);

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 4. Web Operations
// ═══════════════════════════════════════════════════════════════

// ── Fetch URL ─────────────────────────────────────────────────

router.post("/web/fetch", async (req, res) => {
  const { url, selector } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Request body must include 'url' (string)" });
  }

  const result = await agenticFetchUrl(url, { selector });

  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ── Web Search ────────────────────────────────────────────────

router.post("/web/search", async (req, res) => {
  const { query, limit, dateRestrict, siteSearch } = req.body;
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Request body must include 'query' (string)" });
  }

  const result = await agenticWebSearch(query, {
    limit: limit ? Math.min(parseInt(limit), 10) : 5,
    dateRestrict,
    siteSearch,
  });

  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 5. Extended File Operations
// ═══════════════════════════════════════════════════════════════

// ── Multi-File Read ───────────────────────────────────────────

router.post("/file/read-multi", async (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Request body must include 'files' (array of { path, startLine?, endLine? })" });
  }

  const result = await agenticMultiFileRead(files);

  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ── File Info ─────────────────────────────────────────────────

router.post("/file/info", async (req, res) => {
  const { paths, path } = req.body;
  const targetPaths = paths || (path ? [path] : null);
  if (!targetPaths) {
    return res.status(400).json({ error: "Request body must include 'path' (string) or 'paths' (array of strings)" });
  }

  const result = await agenticFileInfo(targetPaths.length === 1 ? targetPaths[0] : targetPaths);

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── File Diff ─────────────────────────────────────────────────

router.post("/file/diff", async (req, res) => {
  const { pathA, pathB, content, contextLines } = req.body;
  if (!pathA || typeof pathA !== "string") {
    return res.status(400).json({ error: "Request body must include 'pathA' (string)" });
  }
  if (!pathB && content === undefined) {
    return res.status(400).json({ error: "Request body must include either 'pathB' (string) or 'content' (string)" });
  }

  const result = await agenticFileDiff(pathA, { pathB, content, contextLines });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── Move File ─────────────────────────────────────────────────

router.post("/file/move", async (req, res) => {
  const { source, destination, createDirs } = req.body;
  if (!source || typeof source !== "string") {
    return res.status(400).json({ error: "Request body must include 'source' (string)" });
  }
  if (!destination || typeof destination !== "string") {
    return res.status(400).json({ error: "Request body must include 'destination' (string)" });
  }

  const result = await agenticMoveFile(source, destination, { createDirs: createDirs !== false });

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ── Delete File ───────────────────────────────────────────────

router.post("/file/delete", async (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }

  const result = await agenticDeleteFile(path);

  if (result.error) {
    return res.status(result.error.includes("outside allowed") || result.error.includes("blocked") ? 403 : 400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 6. Command Execution
// ═══════════════════════════════════════════════════════════════

router.post("/command/run", async (req, res) => {
  const { command, cwd, timeout } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Request body must include 'command' (string)" });
  }

  const result = await executeCommand(command, {
    cwd: cwd || undefined,
    timeout: timeout ? Math.min(parseInt(timeout), 120_000) : undefined,
  });

  if (result.error && !result.stdout && !result.stderr) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/command/stream", async (req, res) => {
  const { command, cwd, timeout } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Request body must include 'command' (string)" });
  }

  const { setupStreamingSSE } = await import("../utilities.js");
  const send = setupStreamingSSE(res);
  send({ event: "start", command });

  const result = await executeCommandStreaming(command, {
    cwd: cwd || undefined,
    timeout: timeout ? Math.min(parseInt(timeout), 120_000) : undefined,
    onChunk: (event, data) => send({ event, data }),
  });

  send({ event: "exit", exitCode: result.exitCode, executionTimeMs: result.executionTimeMs, success: result.success, timedOut: result.timedOut, error: result.error || undefined });
  res.end();
});

router.get("/command/allowed", (_req, res) => {
  res.json({ commands: getAllowedCommands() });
});

// ═══════════════════════════════════════════════════════════════
// 7. Git Operations
// ═══════════════════════════════════════════════════════════════

router.post("/git/status", async (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — path to a directory inside a git repo" });
  }

  const result = await agenticGitStatus(path);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/git/diff", async (req, res) => {
  const { path, staged, file, ref } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }

  const result = await agenticGitDiff(path, { staged, path: file, ref });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/git/log", async (req, res) => {
  const { path, limit, author, since, file } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string)" });
  }

  const result = await agenticGitLog(path, { limit, author, since, path: file });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ── Git Worktree (Coordinator Mode) ───────────────────────────

router.post("/git/worktree/create", async (req, res) => {
  const { path, branch } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — path to the main git repo" });
  }
  if (!branch || typeof branch !== "string") {
    return res.status(400).json({ error: "Request body must include 'branch' (string) — name for the new worktree branch" });
  }

  const result = await agenticGitWorktreeCreate(path, branch);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/git/worktree/remove", async (req, res) => {
  const { path, worktreePath, deleteBranch } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — path to the main git repo" });
  }
  if (!worktreePath || typeof worktreePath !== "string") {
    return res.status(400).json({ error: "Request body must include 'worktreePath' (string) — path to the worktree to remove" });
  }

  const result = await agenticGitWorktreeRemove(path, worktreePath, { deleteBranch: deleteBranch !== false });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/git/worktree/merge", async (req, res) => {
  const { path, branch, message } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — path to the main git repo" });
  }
  if (!branch || typeof branch !== "string") {
    return res.status(400).json({ error: "Request body must include 'branch' (string) — branch to merge" });
  }

  const result = await agenticGitWorktreeMerge(path, branch, { message });
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/git/worktree/diff", async (req, res) => {
  const { path, branch } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — path to the main git repo" });
  }
  if (!branch || typeof branch !== "string") {
    return res.status(400).json({ error: "Request body must include 'branch' (string) — branch to diff against" });
  }

  const result = await agenticGitWorktreeDiff(path, branch);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post("/git/worktree/cleanup", async (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — path to the main git repo" });
  }

  const result = await agenticGitWorktreeCleanup(path);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 8. Project Intelligence
// ═══════════════════════════════════════════════════════════════

router.post("/project/summary", async (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ error: "Request body must include 'path' (string) — the project root directory" });
  }

  const result = await agenticProjectSummary(path);
  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 9. Browser Automation
// ═══════════════════════════════════════════════════════════════

router.post("/browser/action", async (req, res) => {
  const { action } = req.body;
  if (!action || typeof action !== "string") {
    return res.status(400).json({ error: "Request body must include 'action' (string)" });
  }

  const result = await agenticBrowserAction(req.body);

  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 10. LSP Code Intelligence
// ═══════════════════════════════════════════════════════════════

// ── LSP Action ────────────────────────────────────────────────

router.post("/lsp/action", async (req, res) => {
  const { operation, filePath, line, character, workspacePath } = req.body;
  if (!operation || typeof operation !== "string") {
    return res.status(400).json({ error: "Request body must include 'operation' (string)" });
  }
  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "Request body must include 'filePath' (string)" });
  }

  const result = await agenticLspAction({
    operation,
    filePath,
    line: line != null ? parseInt(line) : undefined,
    character: character != null ? parseInt(character) : undefined,
    workspacePath,
  });

  if (result.error) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ── LSP Health ────────────────────────────────────────────────

router.get("/lsp/health", (_req, res) => {
  res.json(agenticLspHealth());
});

// ── LSP Shutdown ──────────────────────────────────────────────

router.post("/lsp/shutdown", async (_req, res) => {
  try {
    await agenticLspShutdown();
    res.json({ success: true, message: "All LSP servers shut down" });
  } catch (error) {
    res.status(500).json({ error: `LSP shutdown failed: ${error.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════

export function getAgenticHealth() {
  return {
    readFile: "on-demand (sandboxed fs)",
    writeFile: "on-demand (sandboxed fs)",
    strReplace: "on-demand (sandboxed fs)",
    patchFile: "on-demand (sandboxed fs + diff)",
    listDirectory: "on-demand (sandboxed fs)",
    grepSearch: "on-demand (sandboxed fs)",
    globFiles: "on-demand (sandboxed fs)",
    fetchUrl: "on-demand (cheerio HTML→markdown)",
    webSearch: "brave (primary) + google_cse (fallback)",
    multiFileRead: "on-demand (batched sandboxed fs)",
    fileInfo: "on-demand (sandboxed fs stat)",
    fileDiff: "on-demand (sandboxed fs + diff)",
    moveFile: "on-demand (sandboxed fs)",
    deleteFile: "on-demand (sandboxed fs)",
    runCommand: "on-demand (sandboxed subprocess)",
    gitStatus: "on-demand (git subprocess)",
    gitDiff: "on-demand (git subprocess)",
    gitLog: "on-demand (git subprocess)",
    gitWorktreeCreate: "on-demand (git worktree)",
    gitWorktreeRemove: "on-demand (git worktree)",
    gitWorktreeMerge: "on-demand (git merge)",
    gitWorktreeDiff: "on-demand (git diff)",
    gitWorktreeCleanup: "on-demand (git prune)",
    projectSummary: "on-demand (fs scan)",
    browserAction: getBrowserHealth(),
    lspAction: "on-demand (LSP stdio JSON-RPC)",
    lspServers: agenticLspHealth(),
  };
}


// ── Unified Git Dispatcher ─────────────────────────────────────────

router.post("/git", async (req, res) => {
  const { action, ...params } = req.body;
  if (!action) return res.status(400).json({ error: "'action' is required", actions: ["status", "diff", "log"] });

  const pathMap = { status: "/git/status", diff: "/git/diff", log: "/git/log" };
  if (!pathMap[action]) return res.status(400).json({ error: `Unknown action: ${action}`, actions: Object.keys(pathMap) });

  req.url = pathMap[action];
  req.body = params;
  return router.handle(req, res, () => res.status(404).json({ error: "Route not found" }));
});

// ═══════════════════════════════════════════════════════════════
// 12. Tool Smoke Tests
// ═══════════════════════════════════════════════════════════════

// ── Single tool test ──────────────────────────────────────────

router.post("/test-tool", async (req, res) => {
  const { toolName } = req.body;
  if (!toolName || typeof toolName !== "string") {
    return res.status(400).json({
      error: "'toolName' is required",
      available: getTestableTools(),
    });
  }
  const result = await testTool(toolName);
  res.json(result);
});

// ── Test all tools ────────────────────────────────────────────

router.post("/test-all-tools", async (req, res) => {
  const { toolNames } = req.body;
  const results = await testAllTools(toolNames || undefined);
  const passed = results.filter((r) => r.success).length;
  res.json({
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  });
});

// ── List testable tools ───────────────────────────────────────

router.get("/testable-tools", (_req, res) => {
  res.json(getTestableTools());
});

export default router;
