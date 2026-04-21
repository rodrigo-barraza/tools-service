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
import CONFIG from "../config.js";
import { agenticHandler } from "../utilities.js";
import {
  agenticReadFile,
  agenticWriteFile,
  agenticStrReplace,
  agenticPatchFile,
  agenticListDirectory,
  agenticGrepSearch,
  agenticGlobFiles,
  agenticMultiFileRead,
  agenticFileInfo,
  agenticFileDiff,
  agenticMoveFile,
  agenticDeleteFile,
} from "../services/AgenticFileService.js";
import {
  agenticFetchUrl,
  agenticWebSearch,
} from "../services/AgenticWebService.js";
import {
  executeCommand,
  executeCommandStreaming,
  getAllowedCommands,
  killProcessTree,
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
import {
  agenticTaskCreate,
  agenticTaskList,
  agenticTaskGet,
  agenticTaskUpdate,
  agenticTaskDelete,
} from "../services/AgenticTaskService.js";
import { agenticToolSearch } from "../services/AgenticToolSearchService.js";
import {
  agenticScheduleCreate,
  agenticScheduleList,
  agenticScheduleDelete,
  agenticTriggerFire,
} from "../services/AgenticSchedulerService.js";
import { agenticNotebookEdit } from "../services/AgenticNotebookService.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════
// 1. File Operations
// ═══════════════════════════════════════════════════════════════

// ── Read File ─────────────────────────────────────────────────

router.post("/file/read", agenticHandler(async (req) => {
  const { path, startLine, endLine } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string)" };
  }

  return agenticReadFile(path, {
    startLine: startLine ? parseInt(startLine, 10) : undefined,
    endLine: endLine ? parseInt(endLine, 10) : undefined,
  });
}));

// ── Write File ────────────────────────────────────────────────

router.post("/file/write", agenticHandler(async (req) => {
  const { path, content, createDirs } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string)" };
  }
  if (typeof content !== "string") {
    return { error: "Request body must include 'content' (string)" };
  }

  return agenticWriteFile(path, content, {
    createDirs: createDirs !== false,
  });
}));

// ── String Replace ────────────────────────────────────────────

router.post("/file/str-replace", agenticHandler(async (req) => {
  const { path, oldStr, newStr, allowMultiple } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string)" };
  }
  if (!oldStr || typeof oldStr !== "string") {
    return { error: "Request body must include 'oldStr' (non-empty string)" };
  }
  if (typeof newStr !== "string") {
    return { error: "Request body must include 'newStr' (string)" };
  }

  return agenticStrReplace(path, oldStr, newStr, {
    allowMultiple: allowMultiple === true,
  });
}));

// ── Patch File (unified diff) ─────────────────────────────────

router.post("/file/patch", agenticHandler(async (req) => {
  const { path, patch } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string)" };
  }
  if (!patch || typeof patch !== "string") {
    return { error: "Request body must include 'patch' (unified diff string)" };
  }

  return agenticPatchFile(path, patch);
}));

// ═══════════════════════════════════════════════════════════════
// 2. Directory Operations
// ═══════════════════════════════════════════════════════════════

router.post("/directory/list", agenticHandler(async (req) => {
  const { path, recursive, maxDepth } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string)" };
  }

  return agenticListDirectory(path, {
    recursive: recursive === true,
    maxDepth: maxDepth ? Math.min(parseInt(maxDepth, 10), 5) : 3,
  });
}));

// ═══════════════════════════════════════════════════════════════
// 3. Search Operations
// ═══════════════════════════════════════════════════════════════

// ── Grep Search ───────────────────────────────────────────────

router.post("/search/grep", agenticHandler(async (req) => {
  const { pattern, searchPath, isRegex, includes, caseInsensitive, matchPerLine } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return { error: "Request body must include 'pattern' (string)" };
  }
  if (!searchPath || typeof searchPath !== "string") {
    return { error: "Request body must include 'searchPath' (string)" };
  }

  return agenticGrepSearch(pattern, searchPath, {
    isRegex: isRegex === true,
    includes: Array.isArray(includes) ? includes : [],
    caseInsensitive: caseInsensitive === true,
    matchPerLine: matchPerLine !== false,
  });
}));

// ── Glob Files ────────────────────────────────────────────────

router.post("/search/glob", agenticHandler(async (req) => {
  const { pattern, searchPath } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return { error: "Request body must include 'pattern' (string)" };
  }
  if (!searchPath || typeof searchPath !== "string") {
    return { error: "Request body must include 'searchPath' (string)" };
  }

  return agenticGlobFiles(pattern, searchPath);
}));

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
    limit: limit ? Math.min(parseInt(limit, 10), 10) : 5,
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

router.post("/file/read-multi", agenticHandler(async (req) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "Request body must include 'files' (array of { path, startLine?, endLine? })" };
  }

  return agenticMultiFileRead(files);
}));

// ── File Info ─────────────────────────────────────────────────

router.post("/file/info", agenticHandler(async (req) => {
  const { paths, path } = req.body;
  const targetPaths = paths || (path ? [path] : null);
  if (!targetPaths) {
    return { error: "Request body must include 'path' (string) or 'paths' (array of strings)" };
  }

  return agenticFileInfo(targetPaths.length === 1 ? targetPaths[0] : targetPaths);
}));

// ── File Diff ─────────────────────────────────────────────────

router.post("/file/diff", agenticHandler(async (req) => {
  const { pathA, pathB, content, contextLines } = req.body;
  if (!pathA || typeof pathA !== "string") {
    return { error: "Request body must include 'pathA' (string)" };
  }
  if (!pathB && content === undefined) {
    return { error: "Request body must include either 'pathB' (string) or 'content' (string)" };
  }

  return agenticFileDiff(pathA, { pathB, content, contextLines });
}));

// ── Move File ─────────────────────────────────────────────────

router.post("/file/move", agenticHandler(async (req) => {
  const { source, destination, createDirs } = req.body;
  if (!source || typeof source !== "string") {
    return { error: "Request body must include 'source' (string)" };
  }
  if (!destination || typeof destination !== "string") {
    return { error: "Request body must include 'destination' (string)" };
  }

  return agenticMoveFile(source, destination, { createDirs: createDirs !== false });
}));

// ── Delete File ───────────────────────────────────────────────

router.post("/file/delete", agenticHandler(async (req) => {
  const { path } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string)" };
  }

  return agenticDeleteFile(path);
}));

// ═══════════════════════════════════════════════════════════════
// 6. Command Execution
// ═══════════════════════════════════════════════════════════════

router.post("/command/run", async (req, res) => {
  const { command, cwd, timeout } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Request body must include 'command' (string)" });
  }

  // Create an AbortController so we can kill the child process if the
  // upstream client disconnects (e.g. user pressed Stop in the UI).
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const result = await executeCommand(command, {
    cwd: cwd || undefined,
    timeout: timeout ? Math.min(parseInt(timeout, 10), 120_000) : undefined,
    signal: ac.signal,
  });

  // Guard: response may already be closed if the client disconnected
  if (res.headersSent || res.writableEnded) return;

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

  // Create an AbortController so we can kill the child process if the
  // upstream client disconnects (e.g. user pressed Stop in the UI).
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const result = await executeCommandStreaming(command, {
    cwd: cwd || undefined,
    timeout: timeout ? Math.min(parseInt(timeout, 10), 120_000) : undefined,
    onChunk: (event, data) => send({ event, data }),
    signal: ac.signal,
  });

  // Guard: response may already be closed if the client disconnected
  if (!res.writableEnded) {
    send({ event: "exit", exitCode: result.exitCode, executionTimeMs: result.executionTimeMs, success: result.success, timedOut: result.timedOut, aborted: result.aborted || undefined, error: result.error || undefined });
    res.end();
  }
});

router.get("/command/allowed", (_req, res) => {
  res.json({ commands: getAllowedCommands() });
});

// ── Kill Process ───────────────────────────────────────────

router.post("/command/kill", async (req, res) => {
  const { pid } = req.body;
  if (!pid || typeof pid !== "number") {
    return res.status(400).json({ error: "Request body must include 'pid' (positive integer)" });
  }

  const result = await killProcessTree(pid);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
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

// ── Browser Script Execution ──────────────────────────────────

router.post("/browser/script", async (req, res) => {
  const { script, sessionId, timeout } = req.body;
  if (!script || typeof script !== "string") {
    return res.status(400).json({ error: "Request body must include 'script' (string)" });
  }

  const result = await agenticBrowserAction({
    action: "run_script",
    sessionId,
    script,
    timeout,
  });

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
    line: line != null ? parseInt(line, 10) : undefined,
    character: character != null ? parseInt(character, 10) : undefined,
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
    browserScript: "on-demand (Playwright subprocess)",
    lspAction: "on-demand (LSP stdio JSON-RPC)",
    lspServers: agenticLspHealth(),
    taskManagement: "on-demand (MongoDB agent_tasks)",
    memoryUpsert: "on-demand (Prism MemoryService post-processing)",
    customAgentCreate: "on-demand (Prism CustomAgentService)",
    toolSearch: "on-demand (ToolSchemaService keyword search)",
    scheduling: "on-demand (MongoDB agent_schedules + 60s poller)",
    notebookEdit: "on-demand (sandboxed ipynb JSON editing)",
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
// 12. Task Management
// ═══════════════════════════════════════════════════════════════

// ── Create Task ───────────────────────────────────────────────

router.post("/task/create", async (req, res) => {
  const { project, subject, description, status, activeForm, metadata } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (!subject || typeof subject !== "string") {
    return res.status(400).json({ error: "Request body must include 'subject' (string)" });
  }
  if (!description || typeof description !== "string") {
    return res.status(400).json({ error: "Request body must include 'description' (string)" });
  }

  // Auto-inject agentSessionId from Prism telemetry header
  const agentSessionId = req.headers["x-agent-session-id"] || null;

  const result = await agenticTaskCreate(project, { subject, description, status, activeForm, metadata, agentSessionId });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── List Tasks ────────────────────────────────────────────────

router.post("/task/list", async (req, res) => {
  const { project, status, limit } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }

  const result = await agenticTaskList(project, {
    status: status || undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── List All Tasks (admin — cross-project) ────────────────────

router.get("/task/list-all", async (req, res) => {
  const { status, limit, agentSessionId } = req.query;
  try {
    const db = (await import("../db.js")).getDB();
    const col = db.collection("agent_tasks");

    const filter = {};
    if (status) filter.status = status;
    if (agentSessionId) filter.agentSessionId = agentSessionId;

    const tasks = await col
      .find(filter)
      .sort({ taskId: 1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 500))
      .toArray();

    // Summary counts (scoped to same filter base)
    const summaryFilter = agentSessionId ? { agentSessionId } : {};
    const allTasks = await col.find(summaryFilter).toArray();
    const summary = {
      total: allTasks.length,
      pending: allTasks.filter((t) => t.status === "pending").length,
      in_progress: allTasks.filter((t) => t.status === "in_progress").length,
      completed: allTasks.filter((t) => t.status === "completed").length,
    };

    // Sanitize _id
    const sanitized = tasks.map(({ _id, ...rest }) => rest);
    res.json({ tasks: sanitized, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Task ──────────────────────────────────────────────────

router.post("/task/get", async (req, res) => {
  const { project, taskId } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (taskId == null) {
    return res.status(400).json({ error: "Request body must include 'taskId' (number)" });
  }

  const result = await agenticTaskGet(project, taskId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Update Task ───────────────────────────────────────────────

router.post("/task/update", async (req, res) => {
  const { project, taskId, status, subject, description, activeForm, metadata } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (taskId == null) {
    return res.status(400).json({ error: "Request body must include 'taskId' (number)" });
  }

  const updates = {};
  if (status) updates.status = status;
  if (subject) updates.subject = subject;
  if (description) updates.description = description;
  if (activeForm !== undefined) updates.activeForm = activeForm;
  if (metadata) updates.metadata = metadata;
  // Auto-inject agentSessionId from Prism telemetry header
  const agentSessionId = req.headers["x-agent-session-id"];
  if (agentSessionId) updates.agentSessionId = agentSessionId;

  const result = await agenticTaskUpdate(project, taskId, updates);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Delete Task ───────────────────────────────────────────────

router.post("/task/delete", async (req, res) => {
  const { project, taskId } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (taskId == null) {
    return res.status(400).json({ error: "Request body must include 'taskId' (number)" });
  }

  const result = await agenticTaskDelete(project, taskId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 13. Tool Smoke Tests
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

// ═══════════════════════════════════════════════════════════════
// 14. Memory Persistence
// ═══════════════════════════════════════════════════════════════

/**
 * POST /agentic/memory/upsert
 *
 * Forwards upsert_memory calls to Prism's MemoryService via
 * POST /agent-memories. Prism handles embedding generation,
 * cosine-similarity deduplication, and MongoDB persistence.
 * Same cross-service pattern as generate_image → Prism.
 */
router.post("/memory/upsert", async (req, res) => {
  const { content, type, title } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "Request body must include 'content' (string)" });
  }

  // Trusted context: arrives via X-headers (telemetry) and body injection
  // (ToolOrchestratorService injects project/agent/username from session ctx).
  // The model never provides these — they're stripped from the tool schema.
  const project = req.headers["x-project"] || req.body.project || "default";
  const agent = req.headers["x-agent"] || req.body.agent || "CODING";
  const username = req.headers["x-username"] || req.body.username || null;
  const agentSessionId = req.headers["x-agent-session-id"] || null;

  try {
    const prismRes = await fetch(`${CONFIG.PRISM_API_URL}/agent-memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent,
        project: project || "default",
        username,
        agentSessionId,
        content,
        type: type || "project",
        title: title || null,
      }),
    });

    if (!prismRes.ok) {
      const err = await prismRes.json().catch(() => ({}));
      return res.status(prismRes.status).json({ error: err.error || `Prism returned ${prismRes.status}` });
    }

    const result = await prismRes.json();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Memory storage failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 15. Custom Agent Creation
// ═══════════════════════════════════════════════════════════════

/**
 * POST /agentic/custom-agent/create
 *
 * Creates a new custom agent persona by proxying to Prism's
 * POST /custom-agents. The agent is persisted to MongoDB and
 * registered into the live AgentPersonaRegistry.
 *
 * Same cross-service pattern as memory/upsert → Prism.
 */
router.post("/custom-agent/create", async (req, res) => {
  const {
    name,
    description,
    project,
    icon,
    color,
    backgroundImage,
    identity,
    guidelines,
    toolPolicy,
    enabledTools,
    usesDirectoryTree,
    usesCodingGuidelines,
  } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Request body must include 'name' (non-empty string)" });
  }

  try {
    const prismRes = await fetch(`${CONFIG.PRISM_API_URL}/custom-agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description || "",
        project: project || "coding",
        icon: icon || "",
        color: color || "",
        backgroundImage: backgroundImage || "",
        identity: identity || "",
        guidelines: guidelines || "",
        toolPolicy: toolPolicy || "",
        enabledTools: Array.isArray(enabledTools) ? enabledTools : [],
        usesDirectoryTree: usesDirectoryTree === true,
        usesCodingGuidelines: usesCodingGuidelines === true,
      }),
    });

    if (!prismRes.ok) {
      const err = await prismRes.json().catch(() => ({}));
      return res.status(prismRes.status).json({ error: err.error || `Prism returned ${prismRes.status}` });
    }

    const created = await prismRes.json();
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: `Custom agent creation failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════
// 16. Tool Search (Meta-Tool)
// ═══════════════════════════════════════════════════════════════

router.post("/tool/search", agenticHandler(async (req) => {
  const { query, domain, label, limit } = req.body;
  if (!query && !domain && !label) {
    return { error: "At least one of 'query', 'domain', or 'label' is required" };
  }

  return agenticToolSearch(query, {
    domain: domain || undefined,
    label: label || undefined,
    limit: limit ? Math.min(parseInt(limit, 10), 50) : 20,
  });
}));

// ═══════════════════════════════════════════════════════════════
// 17. Scheduling (Cron + Remote Trigger)
// ═══════════════════════════════════════════════════════════════

// ── Create Schedule ───────────────────────────────────────────

router.post("/schedule/create", async (req, res) => {
  const { project, name, schedule, prompt, type, agent, model } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Request body must include 'name' (string)" });
  }
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Request body must include 'prompt' (string)" });
  }

  const result = await agenticScheduleCreate({ project, name, schedule, prompt, type, agent, model });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── List Schedules ────────────────────────────────────────────

router.post("/schedule/list", async (req, res) => {
  const { project, type, limit } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }

  const result = await agenticScheduleList(project, {
    type: type || undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Delete Schedule ───────────────────────────────────────────

router.post("/schedule/delete", async (req, res) => {
  const { project, scheduleId } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (scheduleId == null) {
    return res.status(400).json({ error: "Request body must include 'scheduleId' (number)" });
  }

  const result = await agenticScheduleDelete(project, scheduleId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Fire Remote Trigger ───────────────────────────────────────

router.post("/trigger/fire", async (req, res) => {
  const { project, triggerName, payload } = req.body;
  if (!project || typeof project !== "string") {
    return res.status(400).json({ error: "Request body must include 'project' (string)" });
  }
  if (!triggerName || typeof triggerName !== "string") {
    return res.status(400).json({ error: "Request body must include 'triggerName' (string)" });
  }

  const result = await agenticTriggerFire(project, triggerName, payload || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// 18. Notebook Editing
// ═══════════════════════════════════════════════════════════════

router.post("/notebook/edit", agenticHandler(async (req) => {
  const { path, action, cellIndex, content, cellType } = req.body;
  if (!path || typeof path !== "string") {
    return { error: "Request body must include 'path' (string) — path to .ipynb file" };
  }
  if (!action || typeof action !== "string") {
    return { error: "Request body must include 'action' (string)" };
  }

  return agenticNotebookEdit(path, {
    action,
    cellIndex: cellIndex != null ? parseInt(cellIndex, 10) : undefined,
    content,
    cellType,
  });
}));

export default router;
