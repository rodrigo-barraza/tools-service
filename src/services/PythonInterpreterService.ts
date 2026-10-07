// ─── Sandboxed Code Execution ───────────────────────────────

import { spawn } from "node:child_process";
import { writeFile, unlink, mkdtemp, rm, readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import {
  PYTHON_DEFAULT_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
  PYTHON_MAX_TIMEOUT_MS as MAX_TIMEOUT_MS,
  PYTHON_MAX_OUTPUT_BYTES as MAX_OUTPUT_BYTES,
  PYTHON_MEMORY_LIMIT_MB as MEMORY_LIMIT_MB,
  PYTHON_HEALTH_CHECK_TIMEOUT_MS as HEALTH_CHECK_TIMEOUT_MS,
  PYTHON_MAX_FIGURES as MAX_FIGURES,
  PYTHON_MAX_FIGURE_BYTES as MAX_FIGURE_BYTES,
  PYTHON_MAX_INPUT_FILES as MAX_INPUT_FILES,
  PYTHON_MAX_INPUT_FILE_BYTES as MAX_INPUT_FILE_BYTES,
  PYTHON_INPUT_FETCH_TIMEOUT_MS as INPUT_FETCH_TIMEOUT_MS,
} from "../constants.ts";
import { errorMessage, randomUserAgent } from "../utilities.ts";
import { OutputAccumulator } from "../utilities/OutputAccumulator.ts";
import { buildCommandEnv } from "./AgenticCommandService.ts";
import {
  isUnresolvedAttachedSentinel,
  buildAttachedSentinelError,
} from "./AttachedMediaSentinel.ts";
import { fetchPublicOrOwnUrl } from "../fetchers/web/SsrfGuard.ts";

const PYTHON_BIN = "python3";

// Pre-injected preamble that sets resource limits from within Python
// This is more portable than relying on ulimit in all environments.
const PREAMBLE = `
import resource, sys, os

# ─── Memory limit (${MEMORY_LIMIT_MB} MB) ───
# RLIMIT_DATA (heap + anonymous mappings), NOT RLIMIT_AS: numpy/OpenBLAS and
# matplotlib reserve large virtual address ranges they never back with real
# memory, so an address-space cap makes "import matplotlib" hang or die at
# ~67 MB real RSS while a data-segment cap still stops runaway allocations.
_mb = ${MEMORY_LIMIT_MB} * 1024 * 1024
try:
    resource.setrlimit(resource.RLIMIT_DATA, (_mb, _mb))
except (ValueError, resource.error):
    pass  # Some environments restrict setrlimit

# ─── Disable network (block socket creation) ───
import socket as _socket
_orig_socket = _socket.socket
def _blocked_socket(*args, **kwargs):
    raise PermissionError("Network access is disabled in the sandbox")
_socket.socket = _blocked_socket

# ─── Quiet the Agg backend's plt.show() warning ───
import warnings as _warnings
_warnings.filterwarnings("ignore", message="FigureCanvasAgg is non-interactive")
_warnings.filterwarnings("ignore", message="Matplotlib is currently using agg")

# Where figure files land: the run's temp working directory. Captured at
# start so os.chdir() in user code can't redirect the epilogue's output.
_PRISM_WORKDIR = os.getcwd()

# ─── Clean namespace ───
del resource, _mb, _socket, _orig_socket, _blocked_socket, _warnings
`;

// Appended after user code. Auto-saves any still-open matplotlib figures so
// the host can return them as images (Jupyter/e2b-style rich results — see
// https://github.com/e2b-dev/code-interpreter for the result model). An
// atexit hook can't do this: pyplot registers its own atexit handler at
// import time, which runs FIRST (LIFO) and destroys all figures. If user
// code raises, the epilogue is skipped — but files it savefig()'d into the
// working directory are still collected by the host afterwards.
const EPILOGUE = `
# ─── prism: auto-capture open matplotlib figures ───
try:
    import sys as _prism_sys
    if "matplotlib" in _prism_sys.modules:
        import os as _prism_os
        import matplotlib.pyplot as _prism_plt
        for _prism_index, _prism_num in enumerate(_prism_plt.get_fignums()):
            _prism_plt.figure(_prism_num).savefig(
                _prism_os.path.join(_PRISM_WORKDIR, "_prism_figure_%d.png" % (_prism_index + 1)),
                format="png", dpi=110, bbox_inches="tight")
except Exception:
    pass
`;

// Spawn-env additions for headless plotting. The thread caps are load-bearing:
// without them, multi-threaded OpenBLAS/OpenMP reservations exhaust the memory
// cap during "import numpy" (verified empirically — the import hangs).
const PYTHON_RUNTIME_ENV = {
  MPLBACKEND: "Agg",
  MPLCONFIGDIR: join(tmpdir(), "prism-matplotlib-cache"),
  OPENBLAS_NUM_THREADS: "1",
  OMP_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  NUMEXPR_NUM_THREADS: "1",
  MALLOC_ARENA_MAX: "2",
};

// Image files collected from the working directory after a run: both the
// epilogue's auto-captures and anything user code savefig()'d itself.
const FIGURE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface PythonFigure {
  filename: string;
  mimeType: string;
  /** Base64-encoded image bytes. */
  data: string;
  bytes: number;
}

/**
 * Collect image files from the run's working directory (auto-captured
 * figures sort first via their _prism_ prefix). Returns at most MAX_FIGURES
 * figures plus the total number of candidate files found. Staged input
 * files are excluded — echoing an uploaded photo back as a "figure" would
 * both confuse the model and waste the figure budget.
 */
async function collectFigures(
  directory: string,
  excludeFilenames?: ReadonlySet<string>,
): Promise<{ figures: PythonFigure[]; totalFigureFiles: number }> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return { figures: [], totalFigureFiles: 0 };
  }

  const candidates = entries
    .filter((name) => FIGURE_MIME_BY_EXTENSION[extname(name).toLowerCase()])
    .filter((name) => !excludeFilenames?.has(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const figures: PythonFigure[] = [];
  for (const filename of candidates) {
    if (figures.length >= MAX_FIGURES) break;
    try {
      const filePath = join(directory, filename);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > MAX_FIGURE_BYTES) {
        continue;
      }
      const buffer = await readFile(filePath);
      figures.push({
        filename,
        mimeType: FIGURE_MIME_BY_EXTENSION[extname(filename).toLowerCase()],
        data: buffer.toString("base64"),
        bytes: buffer.length,
      });
    } catch {
      // Unreadable file — skip it rather than failing the whole run
    }
  }

  return { figures, totalFigureFiles: candidates.length };
}

// ────────────────────────────────────────────────────────────
// Input File Staging (execute_python `inputFiles`)
// ────────────────────────────────────────────────────────────
// Downloads/decodes each source (http(s) URL or data: URI) into the run's
// temp working directory BEFORE the user code executes, so the code can
// open("<filename>") them. The directory is per-invocation and wiped by
// the existing cleanup, so staged files need no extra lifecycle.

// Fallback-name extensions when the URL basename is unusable. Mirrors the
// common upload types; anything unknown lands as .bin.
const INPUT_EXTENSION_BY_MIME: Record<string, string> = {
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

// Names an input file must never claim: the staged script itself, plus the
// _prism_ prefix reserved for the figure epilogue's auto-captures.
const RESERVED_INPUT_FILENAMES = new Set(["script.py"]);
const RESERVED_INPUT_PREFIX = "_prism_";

export interface StagedInputFile {
  /** Filename relative to the run's working directory. */
  filename: string;
  bytes: number;
  mimeType: string;
}

/**
 * Normalize the tool's `inputFiles` parameter (single string or array of
 * strings) into a validated source list. Rejects non-strings, over-cap
 * batches, and the unresolved "attached" sentinel (standard error copy).
 */
export function normalizeInputFileSources(
  input: unknown,
): { sources: string[] } | { error: string } {
  if (input === undefined || input === null) return { sources: [] };
  const entries = Array.isArray(input) ? input : [input];
  if (
    entries.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    return {
      error:
        "'inputFiles' must be a string or an array of non-empty strings " +
        "(http(s) URL, data: URI, or the literal string 'attached')",
    };
  }
  if (entries.length > MAX_INPUT_FILES) {
    return {
      error: `Too many input files: ${entries.length} (max ${MAX_INPUT_FILES})`,
    };
  }
  if (entries.some((entry) => isUnresolvedAttachedSentinel(entry))) {
    return {
      error: buildAttachedSentinelError(
        "document",
        "an explicit http(s) URL or data: URI",
      ),
    };
  }
  return { sources: (entries as string[]).map((entry) => entry.trim()) };
}

/**
 * Reduce a URL path basename to a safe, workspace-relative filename.
 * Basename-only (no traversal), safe charset, no leading dots, and never
 * a name the run itself uses (script.py / _prism_* figure captures).
 * Returns null when nothing usable remains — caller falls back to
 * input_<n>.<ext>.
 */
export function sanitizeInputFilename(rawName: string): string | null {
  const base = rawName.split(/[/\\]/).pop() ?? "";
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // Malformed percent-encoding — sanitize the raw basename instead
  }
  const cleaned = decoded
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[.]+/, "")
    .slice(0, 100);
  if (!cleaned || /^[._-]+$/.test(cleaned)) return null;
  if (
    RESERVED_INPUT_FILENAMES.has(cleaned) ||
    cleaned.startsWith(RESERVED_INPUT_PREFIX)
  ) {
    return null;
  }
  return cleaned;
}

function extensionForMime(mimeType: string): string {
  const bare = mimeType.split(";")[0].trim().toLowerCase();
  return INPUT_EXTENSION_BY_MIME[bare] ?? "bin";
}

/** Short echo label for a source — avoids returning megabytes of base64. */
function describeInputSource(source: string): string {
  return source.startsWith("data:")
    ? `data: URI (${source.length} chars)`
    : source.length > 200
      ? source.slice(0, 200) + "…"
      : source;
}

type ResolvedInputSource =
  | { buffer: Buffer; mimeType: string; suggestedName: string | null }
  | { error: string };

async function resolveInputSource(
  source: string,
): Promise<ResolvedInputSource> {
  if (source.startsWith("data:")) {
    const commaIndex = source.indexOf(",");
    if (commaIndex === -1) {
      return { error: "Invalid data: URI (missing comma separator)" };
    }
    const header = source.slice(5, commaIndex);
    const payload = source.slice(commaIndex + 1);
    const mimeType =
      header.split(";")[0].trim().toLowerCase() || "application/octet-stream";
    let buffer: Buffer;
    try {
      buffer = header.includes("base64")
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf-8");
    } catch {
      return { error: "Invalid data: URI payload" };
    }
    if (buffer.length > MAX_INPUT_FILE_BYTES) {
      return {
        error: `Input file too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 40 MB)`,
      };
    }
    return { buffer, mimeType, suggestedName: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return {
      error:
        `Invalid input file source '${describeInputSource(source)}': ` +
        "must be an http(s) URL or a data: URI",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      error:
        `Unsupported scheme '${parsed.protocol}' — only http(s) URLs and ` +
        "data: URIs are allowed",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INPUT_FETCH_TIMEOUT_MS);
  try {
    // A model's URL: public, or one of our own services (SsrfGuard)
    const response = await fetchPublicOrOwnUrl(parsed.href, {
      signal: controller.signal,
      headers: { "User-Agent": randomUserAgent(), Accept: "*/*" },
    });
    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const contentLength = parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    if (contentLength > MAX_INPUT_FILE_BYTES) {
      return {
        error: `Input file too large: ${(contentLength / 1_048_576).toFixed(1)} MB (max: 40 MB)`,
      };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_INPUT_FILE_BYTES) {
      return {
        error: `Input file too large: ${(buffer.length / 1_048_576).toFixed(1)} MB (max: 40 MB)`,
      };
    }
    const mimeType =
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ||
      "application/octet-stream";
    return { buffer, mimeType, suggestedName: parsed.pathname };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        error: `Download timed out after ${INPUT_FETCH_TIMEOUT_MS / 1000}s`,
      };
    }
    return { error: `Download failed: ${errorMessage(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download/decode each source and write it into `directory` (the run's
 * working directory). Fails fast on the first bad entry — user code never
 * runs against a partial input set.
 */
export async function stageInputFiles(
  directory: string,
  sources: string[],
): Promise<{ files: StagedInputFile[] } | { error: string }> {
  const files: StagedInputFile[] = [];
  const usedNames = new Set<string>();

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const resolved = await resolveInputSource(source);
    if ("error" in resolved) {
      return { error: `inputFiles[${index}]: ${resolved.error}` };
    }

    let filename = resolved.suggestedName
      ? sanitizeInputFilename(resolved.suggestedName)
      : null;
    if (!filename) {
      filename = `input_${index + 1}.${extensionForMime(resolved.mimeType)}`;
    }
    if (usedNames.has(filename)) {
      filename = `input_${index + 1}_${filename}`.slice(0, 120);
    }

    try {
      await writeFile(join(directory, filename), resolved.buffer);
    } catch (error: unknown) {
      return {
        error: `inputFiles[${index}]: failed to write '${filename}': ${errorMessage(error)}`,
      };
    }
    usedNames.add(filename);
    files.push({
      filename,
      bytes: resolved.buffer.length,
      mimeType: resolved.mimeType,
    });
  }

  return { files };
}

// ────────────────────────────────────────────────────────────
// Execution Engine
// ────────────────────────────────────────────────────────────

export interface PythonExecutionOptions {
  timeout?: number;
  /**
   * Input files to stage into the working directory before the code runs.
   * A single source string or an array of http(s) URLs / data: URIs
   * (normalized + sentinel-checked via normalizeInputFileSources).
   */
  inputFiles?: string | string[];
}

export interface PythonExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTimeMs: number;
  timedOut: boolean;
  error?: string;
  /** Captured matplotlib figures / image files written by the script. */
  figures?: PythonFigure[];
  /** Total image files found (may exceed figures.length when capped). */
  totalFigureFiles?: number;
  /** Files staged into the working directory before the code ran. */
  inputFiles?: StagedInputFile[];
}

export interface PythonStreamingOptions extends PythonExecutionOptions {
  onChunk?: (stream: "stdout" | "stderr", chunk: string) => void;
}

export interface InterpreterInfo {
  available: boolean;
  version: string | null;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  memoryLimitMb?: number;
}

type StagedRun =
  | {
      temporaryDirectory: string;
      scriptPath: string;
      stagedInputFiles: StagedInputFile[];
    }
  | { stagingError: string };

/**
 * Create the run's temp working directory, stage any input files into it
 * (BEFORE the code runs, so open("<filename>") works), then write the
 * script. Any failure wipes the directory and aborts the run — user code
 * never executes against a partial input set.
 */
async function stageRun(
  code: string,
  inputFiles?: string | string[],
): Promise<StagedRun> {
  const normalized = normalizeInputFileSources(inputFiles);
  if ("error" in normalized) return { stagingError: normalized.error };

  let temporaryDirectory = "";
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "pyexec-"));
    let stagedInputFiles: StagedInputFile[] = [];
    if (normalized.sources.length > 0) {
      const staged = await stageInputFiles(
        temporaryDirectory,
        normalized.sources,
      );
      if ("error" in staged) {
        rm(temporaryDirectory, { recursive: true, force: true }).catch(
          () => {},
        );
        return {
          stagingError: `Failed to stage input files — code was not executed. ${staged.error}`,
        };
      }
      stagedInputFiles = staged.files;
    }
    // Write code to a temp file (avoids shell injection via -c)
    const scriptPath = join(temporaryDirectory, "script.py");
    await writeFile(
      scriptPath,
      PREAMBLE + "\n" + code + "\n" + EPILOGUE,
      "utf-8",
    );
    return { temporaryDirectory, scriptPath, stagedInputFiles };
  } catch (error: unknown) {
    if (temporaryDirectory) {
      rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
    return { stagingError: `Failed to stage script: ${errorMessage(error)}` };
  }
}

/**
 * Execute Python code in a sandboxed subprocess.
 */
export async function executePython(
  code: string,
  { timeout = DEFAULT_TIMEOUT_MS, inputFiles }: PythonExecutionOptions = {},
): Promise<PythonExecutionResult> {
  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);
  const startTime = performance.now();

  const stagedRun = await stageRun(code, inputFiles);
  if ("stagingError" in stagedRun) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: Math.round(performance.now() - startTime),
      timedOut: false,
      error: stagedRun.stagingError,
    };
  }
  const { temporaryDirectory, scriptPath, stagedInputFiles } = stagedRun;

  return new Promise<PythonExecutionResult>((resolve) => {
    const stdoutAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    const stderrAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    let timedOut = false;
    let settled = false;

    const child = spawn(PYTHON_BIN, ["-u", scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      // cwd is the temp dir so relative savefig()/open() writes land there
      // (collected as figures, then wiped) instead of in the service cwd.
      cwd: temporaryDirectory,
      env: {
        ...buildCommandEnv(),
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
        ...PYTHON_RUNTIME_ENV,
      },
      detached: false,
    });

    // Close stdin immediately — no interactive input
    if (child.stdin) {
      child.stdin.end();
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutAccumulator.append(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrAccumulator.append(chunk);
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, clampedTimeout);

    async function finish(exitCode: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const executionTimeMs = Math.round(performance.now() - startTime);

      // Collect figures before wiping the temp dir (staged inputs excluded)
      const { figures, totalFigureFiles } = await collectFigures(
        temporaryDirectory,
        new Set(stagedInputFiles.map((file) => file.filename)),
      );

      // Cleanup temp dir (includes the script file)
      if (temporaryDirectory) {
        rm(temporaryDirectory, { recursive: true, force: true }).catch(
          () => {},
        );
      }

      resolve({
        success: exitCode === 0 && !timedOut,
        stdout: stdoutAccumulator.toString(),
        stderr: stderrAccumulator.toString(),
        exitCode: timedOut ? null : exitCode,
        executionTimeMs,
        timedOut,
        ...(timedOut && {
          error: `Execution timed out after ${clampedTimeout}ms`,
        }),
        ...(figures.length > 0 && { figures, totalFigureFiles }),
        ...(stagedInputFiles.length > 0 && { inputFiles: stagedInputFiles }),
      });
    }

    child.on("close", (code: number | null) => void finish(code));
    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);

        // Cleanup
        if (scriptPath) {
          unlink(scriptPath).catch(() => {});
        }

        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          executionTimeMs: Math.round(performance.now() - startTime),
          timedOut: false,
          error: `Process error: ${error.message}`,
        });
      }
    });
  });
}

/**
 * Execute Python code with real-time output streaming.
 * Same sandbox as executePython, but invokes `onChunk` for each
 * stdout/stderr data event as it arrives.
 */
export async function executePythonStreaming(
  code: string,
  {
    timeout = DEFAULT_TIMEOUT_MS,
    inputFiles,
    onChunk,
  }: PythonStreamingOptions = {},
): Promise<PythonExecutionResult> {
  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);
  const startTime = performance.now();

  const stagedRun = await stageRun(code, inputFiles);
  if ("stagingError" in stagedRun) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: Math.round(performance.now() - startTime),
      timedOut: false,
      error: stagedRun.stagingError,
    };
  }
  const { temporaryDirectory, scriptPath, stagedInputFiles } = stagedRun;

  return new Promise<PythonExecutionResult>((resolve) => {
    const stdoutAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    const stderrAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    let streamedBytes = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn(PYTHON_BIN, ["-u", scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: temporaryDirectory,
      env: {
        ...buildCommandEnv(),
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
        ...PYTHON_RUNTIME_ENV,
      },
      detached: false,
    });

    if (child.stdin) {
      child.stdin.end();
    }

    // SSE emission stays capped; the buffered result keeps the tail.
    function streamChunk(type: "stdout" | "stderr", chunk: Buffer) {
      if (streamedBytes < MAX_OUTPUT_BYTES) {
        streamedBytes += chunk.length;
        onChunk?.(type, chunk.toString("utf-8"));
      }
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutAccumulator.append(chunk);
        streamChunk("stdout", chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrAccumulator.append(chunk);
        streamChunk("stderr", chunk);
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, clampedTimeout);

    async function finish(exitCode: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const { figures, totalFigureFiles } = await collectFigures(
        temporaryDirectory,
        new Set(stagedInputFiles.map((file) => file.filename)),
      );

      if (temporaryDirectory) {
        rm(temporaryDirectory, { recursive: true, force: true }).catch(
          () => {},
        );
      }

      resolve({
        success: exitCode === 0 && !timedOut,
        stdout: stdoutAccumulator.toString(),
        stderr: stderrAccumulator.toString(),
        exitCode: timedOut ? null : exitCode,
        executionTimeMs: Math.round(performance.now() - startTime),
        timedOut,
        ...(timedOut && {
          error: `Execution timed out after ${clampedTimeout}ms`,
        }),
        ...(figures.length > 0 && { figures, totalFigureFiles }),
        ...(stagedInputFiles.length > 0 && { inputFiles: stagedInputFiles }),
      });
    }

    child.on("close", (code: number | null) => void finish(code));
    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (scriptPath) {
          unlink(scriptPath).catch(() => {});
        }
        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          executionTimeMs: Math.round(performance.now() - startTime),
          timedOut: false,
          error: `Process error: ${error.message}`,
        });
      }
    });
  });
}


/**
 * Get interpreter metadata for health checks.
 */
export async function getInterpreterInfo(): Promise<InterpreterInfo> {
  try {
    const result = await executePython("import sys; print(f'{sys.version}')", {
      timeout: HEALTH_CHECK_TIMEOUT_MS,
    });
    return {
      available: result.success,
      version: result.stdout.trim(),
      maxTimeoutMs: MAX_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      memoryLimitMb: MEMORY_LIMIT_MB,
    };
  } catch {
    return { available: false, version: null };
  }
}
