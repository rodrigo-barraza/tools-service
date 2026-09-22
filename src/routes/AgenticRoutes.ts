import { AGENT_IDS, DEFAULT_PROJECT, IDENTITY_HEADERS } from "@rodrigo-barraza/utilities-library/taxonomy";
import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import { parseIntParam } from "@rodrigo-barraza/utilities-library";
// ─── File System & Web Interaction Endpoints ────────────────
import { type Request, type Response, Router } from "express";
import CONFIG from "../config.ts";
import logger from "../logger.ts";
import { agenticHandler, errorMessage } from "../utilities.ts";
import { coerceInt, coerceBool } from "../utilities/agenticCoercion.ts";
import { getTraceHeaders } from "@rodrigo-barraza/utilities-library/service";
import { createReadStream } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { extname } from "node:path";
import {
  agenticReadFile,
  agenticWriteFile,
  agenticHashlineEdit,
  agenticPatchFile,
  agenticListDirectory,
  agenticGrepSearch,
  agenticGlobFiles,
  agenticMultiFileRead,
  agenticFileInfo,
  agenticFileDiff,
  agenticMoveFile,
  agenticDeleteFile,
  validatePath,
  agenticBlockReplace,
  agenticMultiReplace,
} from "../services/AgenticFileService.ts";
import {
  agenticFetchUrl,
  agenticWebSearch,
  agenticNewsSearch,
  agenticImageSearch,
  agenticVideoSearch,
} from "../services/AgenticWebService.ts";
import { readPdfUrl } from "../fetchers/web/PdfFetcher.ts";
import { readDocxUrl } from "../fetchers/web/DocxFetcher.ts";
import { readSpreadsheetUrl } from "../fetchers/web/SpreadsheetFetcher.ts";
import { readCsvSource } from "../fetchers/web/CsvFetcher.ts";
import {
  executeCommand,
  executeCommandStreaming,
  getAllowedCommands,
  listBackgroundProcesses,
  getBackgroundProcess,
  killBackgroundProcess,
} from "../services/AgenticCommandService.ts";
import {
  agenticGitStatus,
  agenticGitDiff,
  agenticGitLog,
  agenticGitWorktreeCreate,
  agenticGitWorktreeCommit,
  agenticGitWorktreeRemove,
  agenticGitWorktreeMerge,
  agenticGitWorktreeDiff,
  agenticGitWorktreeCleanup,
} from "../services/AgenticGitService.ts";
import { agenticProjectSummary } from "../services/AgenticProjectService.ts";
import {
  agenticBrowserAction,
  getBrowserHealth,
} from "../services/AgenticBrowserService.ts";
import {
  agenticLspAction,
  agenticLspDiagnosticsBatch,
  agenticLspShutdown,
  agenticLspHealth,
} from "../services/AgenticLspService.ts";
import {
  agenticDebugAction,
  agenticDebugHealth,
} from "../services/AgenticDebugService.ts";
import { agenticCommitSplit } from "../services/AgenticCommitSplitService.ts";
import {
  testTool,
  testAllTools,
  getTestableTools,
} from "../services/AgenticToolTestService.ts";
import {
  agenticTaskCreate,
  agenticTaskList,
  agenticTaskGet,
  agenticTaskUpdate,
  agenticTaskDelete,
} from "../services/AgenticTaskService.ts";
import {
  datastoreWrite,
  datastoreQuery,
  datastoreDelete,
} from "../services/AgenticDatastoreService.ts";
import { agenticToolSearch } from "../services/AgenticToolSearchService.ts";
import * as BackgroundProcessRegistry from "../services/BackgroundProcessRegistry.ts";
import {
  agenticScheduleCreate,
  agenticScheduleList,
  agenticScheduleDelete,
  agenticTriggerFire,
} from "../services/AgenticSchedulerService.ts";
import { agenticNotebookEdit } from "../services/AgenticNotebookService.ts";
import { TOOL_DEFINITIONS } from "../services/ToolSchemaService.ts";
import type { AgenticTask } from "../types/agentic.ts";
const router: ReturnType<typeof Router> = Router();
const dispatchToRoute = router as unknown as (request: Request, response: Response, fallback: () => void) => void;
// ─── 1. File Operations ─────────────────────────────────────
// ── Read File ─────────────────────────────────────────────────
router.post(
  "/file/read",
  agenticHandler(async (req: Request) => {
    const { absolutePath, startLine, endLine, path } = req.body;
    // Models overwhelmingly send `path`; accept it as an alias for absolutePath.
    const target = absolutePath ?? path;
    if (!target || typeof target !== "string") {
      return { error: "Request body must include 'absolutePath' (string)" };
    }
    const start = coerceInt(startLine, { name: "startLine", min: 1, default: 0 });
    if (!start.ok) return { error: start.error };
    const end = coerceInt(endLine, { name: "endLine", min: 1, default: 0 });
    if (!end.ok) return { error: end.error };
    return agenticReadFile(target, {
      startLine: start.value || undefined,
      endLine: end.value || undefined,
    });
  }),
);

// ── Raw File Stream (binary files: images, audio, video) ──────
// Serves file content directly with correct Content-Type.
// Used by the FileViewerPanelComponent for media preview.
const EXT_TO_MIME: Record<string, string> = {
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".wma": "audio/x-ms-wma",
  ".webm": "audio/webm",
  ".opus": "audio/opus",
  // Video
  ".mp4": "video/mp4",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".ts": "video/mp2t",
  // PDF
  ".pdf": "application/pdf",
};

router.get(
  "/file/raw",
  asyncHandler(async (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({ error: "Query param 'path' is required" });
    }

    const validation = validatePath(filePath);
    if (!validation.safe) {
      return res.status(403).json({ error: validation.error });
    }

    const resolved = validation.resolved;
    const fileExtension = extname(resolved).toLowerCase();
    const mime = EXT_TO_MIME[fileExtension];
    if (!mime) {
      return res
        .status(415)
        .json({ error: `Unsupported file type: ${fileExtension}` });
    }

    try {
      const stats = await fsStat(resolved);
      if (stats.isDirectory()) {
        return res
          .status(400)
          .json({ error: "Path is a directory, not a file" });
      }

      // Set appropriate headers for media streaming
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", stats.size);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=60");

      // Support HTTP Range requests for video/audio seeking
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunkSize = end - start + 1;

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
        res.setHeader("Content-Length", chunkSize);

        createReadStream(resolved, { start, end }).pipe(res);
      } else {
        createReadStream(resolved).pipe(res);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return res.status(404).json({ error: `File not found: ${resolved}` });
      }
      logger.error(`[file/raw] Stream failed: ${errorMessage(error)}`);
      res
        .status(500)
        .json({ error: `Failed to stream file: ${errorMessage(error)}` });
    }
  }),
);

// ── Write File ────────────────────────────────────────────────
router.post(
  "/file/write",
  agenticHandler(async (req: Request) => {
    const { path, content, createDirs } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    if (typeof content !== "string") {
      return { error: "Request body must include 'content' (string)" };
    }
    const cd = coerceBool(createDirs, "createDirs", true);
    if (!cd.ok) return { error: cd.error };
    return agenticWriteFile(path, content, {
      createDirs: cd.value,
    });
  }),
);
// ── Hash-Anchored Edit (atomic edits[] batch) ────────────────
// Edits reference lines by `line:hash` anchors from hashline reads; a drifted
// anchor rejects the whole batch with fresh context around the stale line.
router.post(
  "/file/edit",
  agenticHandler(async (req: Request) => {
    const { path, edits } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      return {
        error:
          "'edits' must be a non-empty array of { anchor, endAnchor?, op?, content? }",
      };
    }
    return agenticHashlineEdit(path, edits);
  }),
);
// ── Patch File (unified diff) ─────────────────────────────────
router.post(
  "/file/patch",
  agenticHandler(async (req: Request) => {
    const { path, patch } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    if (!patch || typeof patch !== "string") {
      return {
        error: "Request body must include 'patch' (unified diff string)",
      };
    }
    return agenticPatchFile(path, patch);
  }),
);
// ── Block Replace ─────────────────────────────────────────────
router.post(
  "/file/block-replace",
  agenticHandler(async (req: Request) => {
    const { path, startLine, endLine, targetContent, replacementContent } =
      req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    const start = coerceInt(startLine, { name: "startLine", min: 1 });
    if (!start.ok) return { error: start.error };
    const end = coerceInt(endLine, { name: "endLine", min: 1 });
    if (!end.ok) return { error: end.error };
    if (typeof targetContent !== "string") {
      return { error: "Request body must include 'targetContent' (string)" };
    }
    if (typeof replacementContent !== "string") {
      return {
        error: "Request body must include 'replacementContent' (string)",
      };
    }
    return agenticBlockReplace(
      path,
      start.value,
      end.value,
      targetContent,
      replacementContent,
    );
  }),
);
// ── Multi Replace ─────────────────────────────────────────────
router.post(
  "/file/multi-replace",
  agenticHandler(async (req: Request) => {
    const { path, chunks } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return {
        error:
          "Request body must include 'chunks' (non-empty array of replacement chunks)",
      };
    }
    return agenticMultiReplace(path, chunks);
  }),
);
// ─── 2. Directory Operations ────────────────────────────────
router.post(
  "/directory/list",
  agenticHandler(async (req: Request) => {
    const { path, recursive, maxDepth } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    const rec = coerceBool(recursive, "recursive", false);
    if (!rec.ok) return { error: rec.error };
    const depth = coerceInt(maxDepth, { name: "maxDepth", min: 1, max: 5, default: 3 });
    if (!depth.ok) return { error: depth.error };
    return agenticListDirectory(path, {
      recursive: rec.value,
      maxDepth: depth.value,
    });
  }),
);
// ─── 3. Search Operations ───────────────────────────────────
// ── Grep Search ───────────────────────────────────────────────
router.post(
  "/search/grep",
  agenticHandler(async (req: Request) => {
    const {
      pattern,
      searchPath,
      isRegex,
      includes,
      caseInsensitive,
      matchPerLine,
    } = req.body;
    if (!pattern || typeof pattern !== "string") {
      return { error: "Request body must include 'pattern' (string)" };
    }
    if (!searchPath || typeof searchPath !== "string") {
      return { error: "Request body must include 'searchPath' (string)" };
    }
    const rx = coerceBool(isRegex, "isRegex", false);
    if (!rx.ok) return { error: rx.error };
    const ci = coerceBool(caseInsensitive, "caseInsensitive", false);
    if (!ci.ok) return { error: ci.error };
    const mpl = coerceBool(matchPerLine, "matchPerLine", true);
    if (!mpl.ok) return { error: mpl.error };
    return agenticGrepSearch(pattern, searchPath, {
      isRegex: rx.value,
      includes: Array.isArray(includes) ? includes : [],
      caseInsensitive: ci.value,
      matchPerLine: mpl.value,
    });
  }),
);
// ── Glob Files ────────────────────────────────────────────────
router.post(
  "/search/glob",
  agenticHandler(async (req: Request) => {
    const { pattern, searchPath } = req.body;
    if (!pattern || typeof pattern !== "string") {
      return { error: "Request body must include 'pattern' (string)" };
    }
    if (!searchPath || typeof searchPath !== "string") {
      return { error: "Request body must include 'searchPath' (string)" };
    }
    return agenticGlobFiles(pattern, searchPath);
  }),
);
// ─── 4. Web Operations ──────────────────────────────────────
// ── Fetch URL ─────────────────────────────────────────────────
router.post(
  "/web/fetch",
  agenticHandler(async (req: Request) => {
    const { url, selector } = req.body;
    if (!url || typeof url !== "string") {
      return { error: "Request body must include 'url' (string)" };
    }
    return agenticFetchUrl(url, { selector });
  }),
);
// ── Read PDF URL ──────────────────────────────────────────────
router.post(
  "/web/pdf-read",
  agenticHandler(async (req: Request) => {
    const { url, maxPages, maxChars, pages, startPage, endPage } = req.body;
    if (!url || typeof url !== "string") {
      return { error: "Request body must include 'url' (string)" };
    }
    return readPdfUrl(url, { maxPages, maxChars, pages, startPage, endPage });
  }),
);

// ── OCR: image → verbatim text (tesseract.js) ─────────────────
router.post(
  "/web/image-text",
  agenticHandler(async (req: Request) => {
    const { input, lang, annotate } = req.body;
    if (!input || typeof input !== "string") {
      return {
        error:
          "Request body must include 'input' (image URL, base64 data URI, imageId, or local path)",
      };
    }
    const { readImageText } = await import("../services/OcrService.ts");
    let result;
    try {
      result = await readImageText({
        input,
        lang,
        annotate: annotate === true,
      });
    } catch (error: unknown) {
      return { error: `OCR failed: ${errorMessage(error)}` };
    }

    // Annotated overlay is best-effort display sugar
    let display;
    if (result.annotatedImage) {
      const { default: MinioService } = await import(
        "../services/MinioService.ts"
      );
      const { buildDisplay } = await import("../utilities.ts");
      const url = await MinioService.uploadToolAsset(
        result.annotatedImage,
        "image/png",
      );
      if (url) display = buildDisplay("image", url, { title: "OCR" });
    }

    const { annotatedImage: _omit, ...rest } = result;
    return {
      ...rest,
      ...(display && { display }),
      ...(result.confidence < 60 && {
        hint: "Low confidence — try a sharper image, higher resolution, or crop closer to the text.",
      }),
    };
  }),
);

// ── Read DOCX URL ─────────────────────────────────────────────
router.post(
  "/web/docx-read",
  agenticHandler(async (req: Request) => {
    const { url, maxChars, outputFormat } = req.body;
    if (!url || typeof url !== "string") {
      return { error: "Request body must include 'url' (string)" };
    }
    return readDocxUrl(url, { maxChars, outputFormat });
  }),
);

// ── Read Spreadsheet URL ──────────────────────────────────────
router.post(
  "/web/spreadsheet-read",
  agenticHandler(async (req: Request) => {
    const { url, maxRows, maxChars, sheet, includeHeaders, outputFormat } = req.body;
    if (!url || typeof url !== "string") {
      return { error: "Request body must include 'url' (string)" };
    }
    return readSpreadsheetUrl(url, { maxRows, maxChars, sheet, includeHeaders, outputFormat });
  }),
);
// ── Read CSV ──────────────────────────────────────────────────
router.post(
  "/web/csv-read",
  agenticHandler(async (req: Request) => {
    const { source, delimiter, maxRows, columns } = req.body;
    if (!source || typeof source !== "string") {
      return {
        error:
          "Request body must include 'source' (http(s) URL or base64 data: URI)",
      };
    }
    return readCsvSource(source, { delimiter, maxRows, columns });
  }),
);
// ── Web Search ────────────────────────────────────────────────
router.post(
  "/web/search",
  agenticHandler(async (req: Request) => {
    const { query, limit, dateRestrict, siteSearch, provider } = req.body;
    if (!query || typeof query !== "string") {
      return { error: "Request body must include 'query' (string)" };
    }
    return agenticWebSearch(query, {
      limit: parseIntParam(limit, 5, 20),
      dateRestrict,
      siteSearch,
      provider,
    });
  }),
);
// ── News Search ──────────────────────────────────────────────
router.post(
  "/web/news-search",
  agenticHandler(async (req: Request) => {
    const { query, topic, limit, locale, countryEdition } = req.body;
    if (!query && !topic) {
      return {
        error:
          "Request body must include 'query' (string) and/or 'topic' (string)",
      };
    }
    return agenticNewsSearch(query, {
      topic,
      limit: parseIntParam(limit, 20, 50),
      locale,
      countryEdition,
    });
  }),
);
// ── Image Search ─────────────────────────────────────────────
router.post(
  "/web/image-search",
  agenticHandler(async (req: Request) => {
    const { query, limit } = req.body;
    if (!query || typeof query !== "string") {
      return { error: "Request body must include 'query' (string)" };
    }
    return agenticImageSearch(query, {
      limit: parseIntParam(limit, 20, 150),
    });
  }),
);
// ── Video Search ─────────────────────────────────────────────
router.post(
  "/web/video-search",
  agenticHandler(async (req: Request) => {
    const { query, limit, dateRestrict } = req.body;
    if (!query || typeof query !== "string") {
      return { error: "Request body must include 'query' (string)" };
    }
    return agenticVideoSearch(query, {
      limit: parseIntParam(limit, 20, 50),
      dateRestrict,
    });
  }),
);
// ─── 5. Extended File Operations ────────────────────────────
// ── Multi-File Read ───────────────────────────────────────────
router.post(
  "/file/read-multi",
  agenticHandler(async (req: Request) => {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return {
        error:
          "Request body must include 'files' (array of { absolutePath, startLine?, endLine? })",
      };
    }
    // Validate/coerce each item's line range so a bad startLine can't produce
    // NaN-labeled lines that later corrupt a line-based edit.
    const coercedFiles = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i] ?? {};
      const target = f.absolutePath ?? f.path;
      if (!target || typeof target !== "string") {
        return { error: `files[${i}] must include 'absolutePath' (string)` };
      }
      const start = coerceInt(f.startLine, { name: `files[${i}].startLine`, min: 1, default: 0 });
      if (!start.ok) return { error: start.error };
      const end = coerceInt(f.endLine, { name: `files[${i}].endLine`, min: 1, default: 0 });
      if (!end.ok) return { error: end.error };
      coercedFiles.push({
        absolutePath: target,
        startLine: start.value || undefined,
        endLine: end.value || undefined,
      });
    }
    return agenticMultiFileRead(coercedFiles);
  }),
);
// ── File Info ─────────────────────────────────────────────────
router.post(
  "/file/info",
  agenticHandler(async (req: Request) => {
    const { paths, path } = req.body;
    const targetPaths = paths || (path ? [path] : null);
    if (!targetPaths) {
      return {
        error:
          "Request body must include 'path' (string) or 'paths' (array of strings)",
      };
    }
    return agenticFileInfo(
      targetPaths.length === 1 ? targetPaths[0] : targetPaths,
    );
  }),
);
// ── File Diff ─────────────────────────────────────────────────
router.post(
  "/file/diff",
  agenticHandler(async (req: Request) => {
    const { pathA, pathB, content, contextLines } = req.body;
    if (!pathA || typeof pathA !== "string") {
      return { error: "Request body must include 'pathA' (string)" };
    }
    if (!pathB && content === undefined) {
      return {
        error:
          "Request body must include either 'pathB' (string) or 'content' (string)",
      };
    }
    const ctx = coerceInt(contextLines, { name: "contextLines", min: 0, max: 100, default: 3 });
    if (!ctx.ok) return { error: ctx.error };
    return agenticFileDiff(pathA, { pathB, content, contextLines: ctx.value });
  }),
);
// ── Move File ─────────────────────────────────────────────────
router.post(
  "/file/move",
  agenticHandler(async (req: Request) => {
    const { source, destination, createDirs } = req.body;
    if (!source || typeof source !== "string") {
      return { error: "Request body must include 'source' (string)" };
    }
    if (!destination || typeof destination !== "string") {
      return { error: "Request body must include 'destination' (string)" };
    }
    const cd = coerceBool(createDirs, "createDirs", true);
    if (!cd.ok) return { error: cd.error };
    return agenticMoveFile(source, destination, {
      createDirs: cd.value,
    });
  }),
);
// ── Delete File ───────────────────────────────────────────────
router.post(
  "/file/delete",
  agenticHandler(async (req: Request) => {
    const { path, recursive } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    const rec = coerceBool(recursive, "recursive", false);
    if (!rec.ok) return { error: rec.error };
    return agenticDeleteFile(path, { recursive: rec.value });
  }),
);
// ─── 6. Command Execution ───────────────────────────────────
// Timeout is documented in milliseconds. Models frequently send seconds
// ("30" meaning 30s → historically became 30ms) or unit suffixes ("60s",
// "2m"). Accept the unambiguous suffix forms, and reject bare sub-second
// integers with a teaching error rather than silently running for 1ms.
const MAX_COMMAND_TIMEOUT_MS = 120_000;
function normalizeTimeoutMs(
  raw: unknown,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: undefined };
  if (typeof raw === "string") {
    const m = raw.trim().toLowerCase().match(/^(\d+)\s*(ms|s|m|sec|secs|min|mins)?$/);
    if (!m) {
      return {
        ok: false,
        error: `'timeout' must be a number of milliseconds (1000–${MAX_COMMAND_TIMEOUT_MS}), or a value like "60s"/"2m"; received ${JSON.stringify(raw)}.`,
      };
    }
    const n = Number(m[1]);
    const unit = m[2] || "ms";
    const ms =
      unit === "ms" ? n : unit === "s" || unit === "sec" || unit === "secs" ? n * 1000 : n * 60_000;
    return { ok: true, value: Math.min(Math.max(ms, 1000), MAX_COMMAND_TIMEOUT_MS) };
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 0 && raw < 1000) {
      return {
        ok: false,
        error: `'timeout' is in milliseconds; ${raw} is under 1 second. If you meant ${raw} seconds, send ${raw * 1000} (or "${raw}s").`,
      };
    }
    return { ok: true, value: Math.min(Math.max(raw, 1000), MAX_COMMAND_TIMEOUT_MS) };
  }
  return { ok: false, error: `'timeout' must be a number of milliseconds; received ${typeof raw}.` };
}
router.post(
  "/command/run",
  asyncHandler(async (req: Request, res: Response) => {
    const { command, cwd, timeout, run_in_background } = req.body;
    if (!command || typeof command !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'command' (string)" });
    }
    const timeoutResult = normalizeTimeoutMs(timeout);
    if (!timeoutResult.ok) {
      return res.status(400).json({ error: timeoutResult.error });
    }
    const rib = coerceBool(run_in_background, "run_in_background", false);
    if (!rib.ok) return res.status(400).json({ error: rib.error });
    // Create an AbortController so we can kill the child process if the
    // upstream client disconnects (e.g. user pressed Stop in the UI).
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });
    const result = await executeCommand(command, {
      cwd: cwd || undefined,
      timeout: timeoutResult.value,
      signal: abortController.signal,
      runInBackground: rib.value,
    });
    // Guard: response may already be closed if the client disconnected
    if (res.headersSent || res.writableEnded) return;
    if (result.error && !result.stdout && !result.stderr) {
      return res.status(400).json(result);
    }
    const { buildCodeDisplay } = await import("../utilities.ts");
    res.json({
      ...result,
      ...(result.stdout && {
        display: buildCodeDisplay("stdout", {
          language: "text",
          title: "stdout",
        }),
      }),
    });
  }),
);
router.post(
  "/command/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const { command, cwd, timeout } = req.body;
    if (!command || typeof command !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'command' (string)" });
    }
    const timeoutResult = normalizeTimeoutMs(timeout);
    if (!timeoutResult.ok) {
      return res.status(400).json({ error: timeoutResult.error });
    }
    const { setupStreamingServerSentEvents } =
      await import("@rodrigo-barraza/utilities-library/express");
    const send = setupStreamingServerSentEvents(res);
    send({ event: "start", command });
    // Create an AbortController so we can kill the child process if the
    // upstream client disconnects (e.g. user pressed Stop in the UI).
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });
    const result = await executeCommandStreaming(command, {
      cwd: cwd || undefined,
      timeout: timeoutResult.value,
      onChunk: (event: string, data: string) => send({ event, data }),
      signal: abortController.signal,
    });
    // Guard: response may already be closed if the client disconnected
    if (!res.writableEnded) {
      send({
        event: "exit",
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
        success: result.success,
        timedOut: result.timedOut,
        aborted: result.aborted || undefined,
        error: result.error || undefined,
      });
      res.end();
    }
  }),
);
router.get("/command/allowed", (_req: Request, res: Response) => {
  res.json({ commands: getAllowedCommands() });
});
// ── Kill Process ───────────────────────────────────────────
router.post(
  "/command/kill",
  asyncHandler(async (req: Request, res: Response) => {
    const { pid } = req.body;
    const pidResult = coerceInt(pid, { name: "pid", min: 1 });
    if (!pidResult.ok) {
      return res.status(400).json({ error: pidResult.error });
    }
    // Only kill PIDs this service is tracking as background processes.
    // killProcessTree signals arbitrary host PIDs/process-groups, so a
    // hallucinated or recycled PID could take down an unrelated process.
    const tracked = getBackgroundProcess(pidResult.value);
    if (!tracked) {
      const running = listBackgroundProcesses()
        .filter((p) => !p.exited)
        .map((p) => `${p.pid} (${p.command.slice(0, 40)})`);
      return res.status(400).json({
        error: `PID ${pidResult.value} is not a tracked background process, so it cannot be killed. ${
          running.length
            ? `Tracked background processes: ${running.join(", ")}.`
            : "There are no tracked background processes."
        }`,
      });
    }
    const result = killBackgroundProcess(pidResult.value);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  }),
);
// ── Background Process Management ─────────────────────────
router.get("/command/background/list", (_req: Request, res: Response) => {
  res.json({ processes: listBackgroundProcesses() });
});
router.get("/command/background/:pid", (req: Request, res: Response) => {
  const pid = parseInt(req.params.pid as string, 10);
  if (isNaN(pid)) return res.status(400).json({ error: "Invalid PID" });
  const proc = getBackgroundProcess(pid);
  if (!proc)
    return res
      .status(404)
      .json({ error: `PID ${pid} not found in background registry` });
  res.json(proc);
});
// ─── 7. Git Operations ──────────────────────────────────────
router.post(
  "/git/status",
  agenticHandler(async (req: Request) => {
    const { path } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to a directory inside a git repo",
      };
    }
    return agenticGitStatus(path);
  }),
);
router.post(
  "/git/diff",
  agenticHandler(async (req: Request) => {
    const { path, staged, file, ref } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    const st = coerceBool(staged, "staged", false);
    if (!st.ok) return { error: st.error };
    const result = await agenticGitDiff(path, {
      staged: st.value,
      path: file,
      ref,
    });
    if (result.error || !result.diff) return result;
    const { buildCodeDisplay } = await import("../utilities.ts");
    return {
      ...result,
      display: buildCodeDisplay("diff", { language: "diff", title: "git diff" }),
    };
  }),
);
router.post(
  "/git/log",
  agenticHandler(async (req: Request) => {
    const { path, limit, author, since, file } = req.body;
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (string)" };
    }
    const lim = coerceInt(limit, { name: "limit", min: 1, max: 100, default: 20 });
    if (!lim.ok) return { error: lim.error };
    return agenticGitLog(path, { limit: lim.value, author, since, path: file });
  }),
);
// ── Git Worktree (Coordinator Mode) ───────────────────────────
router.post(
  "/git/worktree/create",
  agenticHandler(async (req: Request) => {
    const { path, branch } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to the main git repo",
      };
    }
    if (!branch || typeof branch !== "string") {
      return {
        error:
          "Request body must include 'branch' (string) — name for the new worktree branch",
      };
    }
    return agenticGitWorktreeCreate(path, branch);
  }),
);
router.post(
  "/git/worktree/remove",
  agenticHandler(async (req: Request) => {
    const { path, worktreePath, deleteBranch, force } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to the main git repo",
      };
    }
    if (!worktreePath || typeof worktreePath !== "string") {
      return {
        error:
          "Request body must include 'worktreePath' (string) — path to the worktree to remove",
      };
    }
    const forced = coerceBool(force, "force", false);
    if (!forced.ok) return { error: forced.error };
    return agenticGitWorktreeRemove(path, worktreePath, {
      deleteBranch: deleteBranch !== false,
      force: forced.value,
    });
  }),
);
router.post(
  "/git/worktree/commit",
  agenticHandler(async (req: Request) => {
    const { path, worktreePath, message } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to the main git repo",
      };
    }
    if (!worktreePath || typeof worktreePath !== "string") {
      return {
        error:
          "Request body must include 'worktreePath' (string) — path to the worktree to commit",
      };
    }
    if (!message || typeof message !== "string") {
      return {
        error: "Request body must include 'message' (string) — commit message",
      };
    }
    return agenticGitWorktreeCommit(path, worktreePath, message);
  }),
);
router.post(
  "/git/worktree/merge",
  agenticHandler(async (req: Request) => {
    const { path, branch, message } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to the main git repo",
      };
    }
    if (!branch || typeof branch !== "string") {
      return {
        error: "Request body must include 'branch' (string) — branch to merge",
      };
    }
    return agenticGitWorktreeMerge(path, branch, { message });
  }),
);
router.post(
  "/git/worktree/diff",
  agenticHandler(async (req: Request) => {
    const { path, branch } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to the main git repo",
      };
    }
    if (!branch || typeof branch !== "string") {
      return {
        error:
          "Request body must include 'branch' (string) — branch to diff against",
      };
    }
    return agenticGitWorktreeDiff(path, branch);
  }),
);
router.post(
  "/git/worktree/cleanup",
  agenticHandler(async (req: Request) => {
    const { path } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to the main git repo",
      };
    }
    return agenticGitWorktreeCleanup(path);
  }),
);
// ─── 8. Project Intelligence ────────────────────────────────
router.post(
  "/project/summary",
  agenticHandler(async (req: Request) => {
    const { path } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — the project root directory",
      };
    }
    return agenticProjectSummary(path) as Promise<Record<string, unknown>>;
  }),
);
// ─── 9. Browser Automation ──────────────────────────────────
router.post(
  "/browser/action",
  agenticHandler(async (req: Request) => {
    const { action } = req.body;
    if (!action || typeof action !== "string") {
      return { error: "Request body must include 'action' (string)" };
    }
    if (action === "run_script" || action === "execute_browser_script") {
      return {
        error:
          "Script execution is not a control_browser action. Use the 'execute_browser_script' tool instead — it runs a full Playwright script in a fresh isolated browser (no shared session state).",
      };
    }
    return agenticBrowserAction(req.body);
  }),
);
// ── Browser Script Execution ──────────────────────────────────
router.post(
  "/browser/script",
  agenticHandler(async (req: Request) => {
    const { script, timeout } = req.body;
    if (!script || typeof script !== "string") {
      return { error: "Request body must include 'script' (string)" };
    }
    return agenticBrowserAction({
      action: "run_script",
      script,
      timeout,
    });
  }),
);
// ─── 10. LSP Code Intelligence ──────────────────────────────
// ── LSP Action ────────────────────────────────────────────────
router.post(
  "/lsp/action",
  agenticHandler(async (req: Request) => {
    const { operation, filePath, line, character, workspacePath, newName } =
      req.body;
    if (!operation || typeof operation !== "string") {
      return { error: "Request body must include 'operation' (string)" };
    }
    if (!filePath || typeof filePath !== "string") {
      return { error: "Request body must include 'filePath' (string)" };
    }
    const ln = coerceInt(line, { name: "line", min: 1, default: 0 });
    if (!ln.ok) return { error: `${ln.error} LSP positions are 1-based.` };
    const ch = coerceInt(character, { name: "character", min: 1, default: 0 });
    if (!ch.ok) return { error: `${ch.error} LSP positions are 1-based.` };
    return agenticLspAction({
      operation,
      filePath,
      line: ln.value || undefined,
      character: ch.value || undefined,
      workspacePath,
      newName: typeof newName === "string" ? newName : undefined,
    });
  }),
);
// ── LSP Batch Diagnostics ─────────────────────────────────────
// One call per edited-file batch — files sharing a workspace root reuse one
// language-server process, replacing the per-file whole-project compile.
router.post(
  "/lsp/diagnostics",
  agenticHandler(async (req: Request) => {
    const { files, workspacePath } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return {
        error: "Request body must include 'files' (non-empty array of paths)",
      };
    }
    return agenticLspDiagnosticsBatch({
      files,
      workspacePath: typeof workspacePath === "string" ? workspacePath : undefined,
    });
  }),
);
// ─── 10b. Interactive Debugging (DAP) ───────────────────────
router.post(
  "/debug/action",
  agenticHandler(async (req: Request) => {
    const {
      action,
      sessionId,
      program,
      args,
      cwd,
      breakpoints,
      expression,
      frameId,
      variablesReference,
    } = req.body;
    if (!action || typeof action !== "string") {
      return { error: "Request body must include 'action' (string)" };
    }
    return agenticDebugAction({
      action,
      sessionId,
      program,
      args,
      cwd,
      breakpoints,
      expression,
      frameId,
      variablesReference,
    });
  }),
);
// ─── 10c. Atomic Commit Splitting ───────────────────────────
router.post(
  "/git/commit-split",
  agenticHandler(async (req: Request) => {
    const { action, path, proposalId } = req.body;
    if (!action || typeof action !== "string") {
      return { error: "Request body must include 'action' ('propose' | 'confirm')" };
    }
    if (!path || typeof path !== "string") {
      return { error: "Request body must include 'path' (repo root)" };
    }
    return agenticCommitSplit({
      action: action as "propose" | "confirm",
      path,
      proposalId,
    });
  }),
);
// ── LSP Health ────────────────────────────────────────────────
router.get("/lsp/health", (_req: Request, res: Response) => {
  res.json(agenticLspHealth());
});
// ── LSP Shutdown ──────────────────────────────────────────────
router.post(
  "/lsp/shutdown",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      await agenticLspShutdown();
      res.json({ success: true, message: "All LSP servers shut down" });
    } catch (error: unknown) {
      logger.error(`LSP shutdown failed: ${errorMessage(error)}`);
      res.status(500).json({ error: "LSP shutdown failed" });
    }
  }),
);
// ─── Health ─────────────────────────────────────────────────
export function getAgenticHealth() {
  return {
    readFile: "on-demand (sandboxed fs, hashline format)",
    writeFile: "on-demand (sandboxed fs)",
    hashlineEdit: "on-demand (sandboxed fs, hash-anchored)",
    blockReplace: "on-demand (sandboxed fs)",
    multiReplace: "on-demand (sandboxed fs)",
    patchFile: "on-demand (sandboxed fs + diff)",
    listDirectory: "on-demand (sandboxed fs)",
    grepSearch: "on-demand (sandboxed fs)",
    globFiles: "on-demand (sandboxed fs)",
    fetchUrl: "on-demand (cheerio HTML→markdown)",
    readPdf: "on-demand (pdf-parse)",
    readDocx: "on-demand (mammoth)",
    readSpreadsheet: "on-demand (exceljs)",
    webSearch: "brave (primary) + google_cse (fallback)",
    multiFileRead: "on-demand (batched sandboxed fs)",
    fileInfo: "on-demand (sandboxed fs stat)",
    fileDiff: "on-demand (sandboxed fs + diff)",
    moveFile: "on-demand (sandboxed fs)",
    deleteFile: "on-demand (sandboxed fs)",
    runCommand: "on-demand (sandboxed subprocess)",
    backgroundProcesses: BackgroundProcessRegistry.activeCount(),
    gitStatus: "on-demand (git subprocess)",
    gitDiff: "on-demand (git subprocess)",
    gitLog: "on-demand (git subprocess)",
    gitWorktreeCreate: "on-demand (git worktree)",
    gitWorktreeRemove: "on-demand (git worktree)",
    gitWorktreeCommit: "on-demand (git commit)",
    gitWorktreeMerge: "on-demand (git merge)",
    gitWorktreeDiff: "on-demand (git diff)",
    gitWorktreeCleanup: "on-demand (git prune)",
    projectSummary: "on-demand (fs scan)",
    browserAction: getBrowserHealth(),
    browserScript: "on-demand (Playwright subprocess)",
    lspAction: "on-demand (LSP stdio JSON-RPC)",
    lspDiagnostics: "on-demand (publishDiagnostics capture, batched)",
    lspServers: agenticLspHealth(),
    debugAction: agenticDebugHealth(),
    commitSplit: "on-demand (git subprocess, propose/confirm)",
    taskManagement: "on-demand (MongoDB agent_tasks)",
    memoryUpsert: "on-demand (Prism MemoryService post-processing)",
    customAgentCreate: "on-demand (Prism CustomAgentService)",
    customAgentList: "on-demand (Prism CustomAgentService)",
    toolSearch: "on-demand (ToolSchemaService keyword search)",
    scheduling: "on-demand (MongoDB agent_schedules + 60s poller)",
    notebookEdit: "on-demand (sandboxed ipynb JSON editing)",
  };
}
// ── Unified Git Dispatcher ─────────────────────────────────────────
router.post(
  "/git",
  asyncHandler(async (req: Request, res: Response) => {
    const { action, ...params } = req.body;
    if (!action)
      return res
        .status(400)
        .json({
          error: "'action' is required",
          actions: ["status", "diff", "log"],
        });
    const pathMap: Record<string, string> = {
      status: "/git/status",
      diff: "/git/diff",
      log: "/git/log",
    };
    if (!pathMap[action])
      return res
        .status(400)
        .json({
          error: `Unknown action: ${action}`,
          actions: Object.keys(pathMap),
        });
    req.url = pathMap[action];
    req.body = params;
    return dispatchToRoute(req, res, () =>
      res.status(404).json({ error: "Route not found" }),
    );
  }),
);
// ─── 12. Task Management ────────────────────────────────────
// ── Create Task ───────────────────────────────────────────────
router.post(
  "/task/create",
  asyncHandler(async (req: Request, res: Response) => {
    const { project, subject, description, status, activeForm, metadata } =
      req.body;
    if (!project || typeof project !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'project' (string)" });
    }
    if (!subject || typeof subject !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'subject' (string)" });
    }
    if (!description || typeof description !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'description' (string)" });
    }
    // Auto-inject conversationId from Prism telemetry headers
    const conversationId =
      (req.headers[IDENTITY_HEADERS.conversationId] as string) || null;
    const result = await agenticTaskCreate(project, {
      subject,
      description,
      status,
      activeForm,
      metadata,
      conversationId: conversationId as string | null,
    });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }),
);
// ── List Tasks ────────────────────────────────────────────────
router.post(
  "/task/list",
  agenticHandler(async (req: Request) => {
    const { project, status, limit } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    return agenticTaskList(project, {
      status: status || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }),
);
router.get(
  "/task/list-all",
  asyncHandler(
    async (req: Request) => {
      const { status, limit, conversationId } = req.query as Record<
        string,
        string | undefined
      >;
      const database = (
        await import("@rodrigo-barraza/utilities-library/service/mongo")
      ).getDatabase();
      const collection = database.collection<AgenticTask>("agent_tasks");
      const filter: Record<string, unknown> = {};
      if (status) filter.status = status;
      if (conversationId) filter.conversationId = conversationId;
      const tasks = await collection
        .find(filter)
        .sort({ taskId: 1 })
        .limit(parseIntParam(limit, 100, 500))
        .toArray();
      // Summary counts (scoped to same filter base)
      const summaryFilter = conversationId ? { conversationId } : {};
      const allTasks = await collection.find(summaryFilter).toArray();
      const summary = {
        total: allTasks.length,
        pending: allTasks.filter((task: AgenticTask) => task.status === "pending").length,
        in_progress: allTasks.filter((task: AgenticTask) => task.status === "in_progress")
          .length,
        completed: allTasks.filter((task: AgenticTask) => task.status === "completed")
          .length,
      };
      // Sanitize _id
      const sanitized = tasks.map((task: AgenticTask) => {
        const { _id, ...rest } = task;
        return rest;
      });
      return { tasks: sanitized, summary };
    },
    "Task list-all",
    500,
  ),
);
// ── Get Task ──────────────────────────────────────────────────
router.post(
  "/task/get",
  agenticHandler(async (req: Request) => {
    const { project, taskId } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    if (taskId == null) {
      return { error: "Request body must include 'taskId' (number)" };
    }
    return agenticTaskGet(project, taskId);
  }),
);
// ── Update Task ───────────────────────────────────────────────
router.post(
  "/task/update",
  agenticHandler(async (req: Request) => {
    const {
      project,
      taskId,
      status,
      subject,
      description,
      activeForm,
      metadata,
    } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    if (taskId == null) {
      return { error: "Request body must include 'taskId' (number)" };
    }
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (subject) updates.subject = subject;
    if (description) updates.description = description;
    if (activeForm !== undefined) updates.activeForm = activeForm;
    if (metadata) updates.metadata = metadata;
    // Auto-inject conversationId from Prism telemetry headers
    const conversationId = req.headers[IDENTITY_HEADERS.conversationId];
    if (conversationId) updates.conversationId = conversationId as string;
    return agenticTaskUpdate(project, taskId, updates);
  }),
);
// ── Delete Task ───────────────────────────────────────────────
router.post(
  "/task/delete",
  agenticHandler(async (req: Request) => {
    const { project, taskId } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    if (taskId == null) {
      return { error: "Request body must include 'taskId' (number)" };
    }
    return agenticTaskDelete(project, taskId);
  }),
);
// ─── 12b. Structured Datastore ──────────────────────────────
// Namespaced queryable record store (MongoDB agent_datastore).
// project/agent/username arrive via trusted orchestrator body
// injection + X-headers — stripped from the model-facing schema.
// ── Write records ─────────────────────────────────────────────
router.post(
  "/datastore/write",
  agenticHandler(async (req: Request) => {
    const { project, namespace, records, keyField } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    return datastoreWrite(project, namespace, records, keyField, {
      agent: (req.headers[IDENTITY_HEADERS.agent] as string) || req.body.agent || null,
      username: (req.headers[IDENTITY_HEADERS.username] as string) || req.body.username || null,
    });
  }),
);
// ── Query records / list namespaces ───────────────────────────
router.post(
  "/datastore/query",
  agenticHandler(async (req: Request) => {
    const { project, namespace, filter, sort, fields, limit, skip, pipeline } =
      req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    return datastoreQuery(project, namespace, {
      filter,
      sort,
      fields,
      limit,
      skip,
      pipeline,
    });
  }),
);
// ── Delete records ────────────────────────────────────────────
router.post(
  "/datastore/delete",
  agenticHandler(async (req: Request) => {
    const { project, namespace, ids, filter, all } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    const allFlag = coerceBool(all, "all", false);
    if (!allFlag.ok) return { error: allFlag.error };
    return datastoreDelete(project, namespace, {
      ids,
      filter,
      all: allFlag.value,
    });
  }),
);
// ─── 13. Tool Smoke Tests ───────────────────────────────────
// ── Single tool test ──────────────────────────────────────────
router.post(
  "/test-tool",
  asyncHandler(async (req: Request, res: Response) => {
    const { toolName } = req.body;
    if (!toolName || typeof toolName !== "string") {
      return res.status(400).json({
        error: "'toolName' is required",
        available: getTestableTools(),
      });
    }
    const result = await testTool(toolName);
    res.json(result);
  }),
);
// ── Test all tools ────────────────────────────────────────────
router.post(
  "/test-all-tools",
  asyncHandler(async (req: Request, res: Response) => {
    const { toolNames } = req.body;
    const results = await testAllTools(toolNames || undefined);
    const passed = results.filter((r) => r.success).length;
    res.json({
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
    });
  }),
);
// ── List testable tools ───────────────────────────────────────
router.get("/testable-tools", (_req: Request, res: Response) => {
  res.json(getTestableTools());
});
// ─── 14. Memory Persistence ─────────────────────────────────
/**
 * POST /agentic/memory/save
 *
 * Forwards save_memory calls to Prism's MemoryService via
 * POST /agent-memories. Prism handles embedding generation,
 * cosine-similarity deduplication, and MongoDB persistence.
 * Same cross-service pattern as generate_image → Prism.
 */
router.post(
  "/memory/save",
  asyncHandler(async (req: Request, res: Response) => {
    const { content, type, title } = req.body;
    if (!content || typeof content !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'content' (string)" });
    }
    // Trusted context: arrives via X-headers (telemetry) and body injection
    // (ToolOrchestratorService injects project/agent/username from session ctx).
    // The model never provides these — they're stripped from the tool schema.
    const project = req.headers[IDENTITY_HEADERS.project] || req.body.project || DEFAULT_PROJECT;
    const agent = req.headers[IDENTITY_HEADERS.agent] || req.body.agent || AGENT_IDS.CODING;
    const username = req.headers[IDENTITY_HEADERS.username] || req.body.username || null;
    try {
      const prismResponse = await fetch(
        `${CONFIG.PRISM_SERVICE_URL}/agent-memories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getTraceHeaders() },
          body: JSON.stringify({
            agent,
            project: project || DEFAULT_PROJECT,
            username,
            content,
            type: type || "project",
            title: title || null,
          }),
        },
      );
      if (!prismResponse.ok) {
        const errorBody = await prismResponse.json().catch(() => ({}));
        return res
          .status(prismResponse.status)
          .json({
            error: errorBody.error || `Prism returned ${prismResponse.status}`,
          });
      }
      const result = await prismResponse.json();
      res.json(result);
    } catch (error: unknown) {
      res
        .status(500)
        .json({ error: `Memory storage failed: ${errorMessage(error)}` });
    }
  }),
);
// ─── 15. Custom Agent Creation ──────────────────────────────
/**
 * POST /agentic/custom-agent/create
 *
 * Creates a new custom agent persona by proxying to Prism's
 * POST /custom-agents. The agent is persisted to MongoDB and
 * registered into the live AgentPersonaRegistry.
 *
 * Same cross-service pattern as memory/upsert → Prism.
 */
router.post(
  "/custom-agent/create",
  asyncHandler(async (req: Request, res: Response) => {
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
      return res
        .status(400)
        .json({ error: "Request body must include 'name' (non-empty string)" });
    }
    // ── Validate enabledTools against the tool registry ──────────
    if (Array.isArray(enabledTools) && enabledTools.length > 0) {
      const knownToolNames = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
      const unknownTools = enabledTools.filter(
        (toolName: string) => !knownToolNames.has(toolName),
      );
      if (unknownTools.length > 0) {
        return res.status(400).json({
          error:
            `Unknown tool(s) in enabledTools: ${unknownTools.join(", ")}. ` +
            `Use the tool_search tool or list_custom_agents to discover valid tool names.`,
          unknownTools,
        });
      }
    }
    try {
      const prismResponse = await fetch(
        `${CONFIG.PRISM_SERVICE_URL}/custom-agents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getTraceHeaders() },
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
        },
      );
      if (!prismResponse.ok) {
        const errorBody = await prismResponse.json().catch(() => ({}));
        return res
          .status(prismResponse.status)
          .json({
            error: errorBody.error || `Prism returned ${prismResponse.status}`,
          });
      }
      const created = await prismResponse.json();
      res.status(201).json(created);
    } catch (error: unknown) {
      res
        .status(500)
        .json({
          error: `Custom agent creation failed: ${errorMessage(error)}`,
        });
    }
  }),
);
// ── List Custom Agents ────────────────────────────────────────
/**
 * GET /agentic/custom-agent/list
 *
 * Returns all custom agent personas by proxying to Prism's
 * GET /custom-agents. Read-only discovery for the agentic loop.
 */
router.get(
  "/custom-agent/list",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const prismResponse = await fetch(`${CONFIG.PRISM_SERVICE_URL}/custom-agents`, { headers: getTraceHeaders() });
      if (!prismResponse.ok) {
        const errorBody = await prismResponse.json().catch(() => ({}));
        return res
          .status(prismResponse.status)
          .json({
            error: errorBody.error || `Prism returned ${prismResponse.status}`,
          });
      }
      const agents = await prismResponse.json();
      res.json({ agents, count: agents.length });
    } catch (error: unknown) {
      res
        .status(500)
        .json({ error: `Custom agent list failed: ${errorMessage(error)}` });
    }
  }),
);
// ── List All Agents (Built-in + Custom) ───────────────────────
/**
 * GET /agentic/agent/list
 *
 * Returns all registered agent personas (built-in and custom)
 * by proxying to Prism's GET /config/agents. Returns a lightweight
 * summary with id, name, type, and custom flag for each persona.
 */
router.get(
  "/agent/list",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const prismResponse = await fetch(`${CONFIG.PRISM_SERVICE_URL}/config/agents`, { headers: getTraceHeaders() });
      if (!prismResponse.ok) {
        const errorBody = await prismResponse.json().catch(() => ({}));
        return res
          .status(prismResponse.status)
          .json({
            error: errorBody.error || `Prism returned ${prismResponse.status}`,
          });
      }
      const agentsFullPayload = await prismResponse.json();
      const agents = (agentsFullPayload as Array<Record<string, unknown>>).map(
        (entry) => ({
          id: entry.id,
          name: entry.name,
          type: entry.type || "",
          description: entry.description || "",
          custom: entry.custom || false,
        }),
      );
      res.json({ agents, count: agents.length });
    } catch (error: unknown) {
      res
        .status(500)
        .json({ error: `Agent list failed: ${errorMessage(error)}` });
    }
  }),
);
// ── Update Custom Agent ───────────────────────────────────────
/**
 * POST /agentic/custom-agent/update
 *
 * Updates an existing custom agent by proxying to Prism's
 * PUT /custom-agents/:id. Accepts partial updates — only
 * the fields you provide will be changed.
 */
router.post(
  "/custom-agent/update",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      id,
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
    if (!id || typeof id !== "string") {
      return res
        .status(400)
        .json({
          error:
            "Request body must include 'id' (string — the agent's MongoDB ObjectId)",
        });
    }
    // ── Validate enabledTools against the tool registry ──────────
    if (Array.isArray(enabledTools) && enabledTools.length > 0) {
      const knownToolNames = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
      const unknownTools = enabledTools.filter(
        (toolName: string) => !knownToolNames.has(toolName),
      );
      if (unknownTools.length > 0) {
        return res.status(400).json({
          error:
            `Unknown tool(s) in enabledTools: ${unknownTools.join(", ")}. ` +
            `Use the tool_search tool or list_custom_agents to discover valid tool names.`,
          unknownTools,
        });
      }
    }
    try {
      const prismResponse = await fetch(
        `${CONFIG.PRISM_SERVICE_URL}/custom-agents/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...getTraceHeaders() },
          body: JSON.stringify({
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
            ...(project !== undefined && { project }),
            ...(icon !== undefined && { icon }),
            ...(color !== undefined && { color }),
            ...(backgroundImage !== undefined && { backgroundImage }),
            ...(identity !== undefined && { identity }),
            ...(guidelines !== undefined && { guidelines }),
            ...(toolPolicy !== undefined && { toolPolicy }),
            ...(enabledTools !== undefined && { enabledTools }),
            ...(usesDirectoryTree !== undefined && { usesDirectoryTree }),
            ...(usesCodingGuidelines !== undefined && { usesCodingGuidelines }),
          }),
        },
      );
      if (!prismResponse.ok) {
        const errorBody = await prismResponse.json().catch(() => ({}));
        return res
          .status(prismResponse.status)
          .json({
            error: errorBody.error || `Prism returned ${prismResponse.status}`,
          });
      }
      const updated = await prismResponse.json();
      res.json(updated);
    } catch (error: unknown) {
      res
        .status(500)
        .json({ error: `Custom agent update failed: ${errorMessage(error)}` });
    }
  }),
);
// ─── 16. Tool Search (Meta-Tool) ────────────────────────────
router.post(
  "/tool/search",
  agenticHandler(async (req: Request) => {
    const { query, domain, limit } = req.body;
    if (!query && !domain) {
      return {
        error: "At least one of 'query' or 'domain' is required",
      };
    }
    const enabledToolsHeader = req.headers["x-enabled-tools"];
    const agentHeader = req.headers[IDENTITY_HEADERS.agent];
    let enabledTools: string[] | undefined;
    if (
      enabledToolsHeader &&
      typeof enabledToolsHeader === "string" &&
      agentHeader !== AGENT_IDS.META
    ) {
      enabledTools = enabledToolsHeader.split(",");
    }
    return agenticToolSearch(query, {
      domain: domain || undefined,
      limit: limit ? Math.min(parseInt(limit, 10), 50) : 20,
      enabledTools,
    });
  }),
);
// ─── 17. Cron Jobs (Persistent Scheduling + Remote Triggers) ─
// ── Create Cron Job ───────────────────────────────────────────
router.post(
  "/scheduled-task/create",
  agenticHandler(async (req: Request) => {
    const {
      project,
      name,
      prompt,
      scheduleType,
      cronExpression,
      scheduleTime,
      scheduleDay,
      scheduleDate,
      agent,
      provider,
      model,
      schedule,
      type,
    } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    if (!name || typeof name !== "string") {
      return { error: "Request body must include 'name' (string)" };
    }
    if (!prompt || typeof prompt !== "string") {
      return { error: "Request body must include 'prompt' (string)" };
    }
    const username = (req.headers[IDENTITY_HEADERS.username] as string) || undefined;
    const providerFromHeader = (req.headers["x-provider"] as string) || undefined;
    const modelFromHeader = (req.headers["x-model"] as string) || undefined;
    const agentFromHeader = (req.headers[IDENTITY_HEADERS.agent] as string) || undefined;
    const enabledToolsHeader = req.headers["x-enabled-tools"];
    let enabledTools: string[] | undefined;
    if (enabledToolsHeader && typeof enabledToolsHeader === "string") {
      enabledTools = enabledToolsHeader.split(",");
    }

    return agenticScheduleCreate({
      project,
      name,
      prompt,
      scheduleType,
      cronExpression,
      scheduleTime,
      scheduleDay,
      scheduleDate,
      agent: agent || agentFromHeader || null,
      provider: provider || providerFromHeader,
      model: model || modelFromHeader,
      schedule,
      type,
      enabledTools,
    }, username);
  }),
);

// ── List Cron Jobs ────────────────────────────────────────────
router.post(
  "/scheduled-task/list",
  agenticHandler(async (req: Request) => {
    const { project } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    const username = (req.headers[IDENTITY_HEADERS.username] as string) || undefined;
    return agenticScheduleList(project, undefined, username);
  }),
);

// ── Delete Cron Job ───────────────────────────────────────────
router.post(
  "/scheduled-task/delete",
  agenticHandler(async (req: Request) => {
    const { project, scheduleId } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    if (!scheduleId) {
      return { error: "Request body must include 'scheduleId' (string)" };
    }
    const username = (req.headers[IDENTITY_HEADERS.username] as string) || undefined;
    return agenticScheduleDelete(project, scheduleId, username);
  }),
);

// ── Trigger Cron Job / Remote Trigger ─────────────────────────
router.post(
  "/scheduled-task/trigger",
  agenticHandler(async (req: Request) => {
    const { project, triggerName, payload } = req.body;
    if (!project || typeof project !== "string") {
      return { error: "Request body must include 'project' (string)" };
    }
    if (!triggerName || typeof triggerName !== "string") {
      return { error: "Request body must include 'triggerName' (string)" };
    }
    const username = (req.headers[IDENTITY_HEADERS.username] as string) || undefined;
    return agenticTriggerFire(project, triggerName, payload || {}, username);
  }),
);

// ─── 18. Notebook Editing ───────────────────────────────────
router.post(
  "/notebook/edit",
  agenticHandler(async (req: Request) => {
    const { path, action, cellIndex, content, cellType } = req.body;
    if (!path || typeof path !== "string") {
      return {
        error:
          "Request body must include 'path' (string) — path to .ipynb file",
      };
    }
    if (!action || typeof action !== "string") {
      return { error: "Request body must include 'action' (string)" };
    }
    let cellIndexValue: number | undefined;
    if (cellIndex != null) {
      // Allow -1 as explicit "append" sugar for insert_cell; otherwise require
      // a real 0-based integer so "last"/NaN can't splice cell 0.
      const ci = coerceInt(cellIndex, { name: "cellIndex", min: -1 });
      if (!ci.ok) return { error: `${ci.error} cellIndex is 0-based.` };
      cellIndexValue = ci.value;
    }
    return agenticNotebookEdit(path, {
      action,
      cellIndex: cellIndexValue,
      content,
      cellType,
    });
  }),
);
export default router;
