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
  };
}

export default router;
