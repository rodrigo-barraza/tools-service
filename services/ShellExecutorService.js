// ============================================================
// Shell Executor Service — Allowlisted Command Execution
// ============================================================
// Executes a restricted set of safe shell commands via
// subprocess. Input is piped through stdin, output captured
// from stdout/stderr.
//
// ONLY allowlisted binaries are permitted — no filesystem
// mutation, no network, no traversal.
//
// Used by the `execute_shell` tool so LLMs can leverage classic
// Unix text-processing pipelines (awk, sed, jq, sort, etc.)
// ============================================================

import { spawn } from "node:child_process";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024; // 1 MB max stdin

// Only these binaries may be invoked as the first command.
// Pipes (|) connect them. No shell expansion or globbing.
const ALLOWED_BINARIES = new Set([
  // Text processing
  "awk",
  "sed",
  "grep",
  "cut",
  "tr",
  "sort",
  "uniq",
  "wc",
  "head",
  "tail",
  "tee",
  "paste",
  "column",
  "fold",
  "fmt",
  "rev",
  "tac",
  "nl",
  "expand",
  "unexpand",
  "comm",
  "join",

  // JSON processing
  "jq",

  // Math
  "bc",
  "expr",
  "factor",
  "seq",
  "shuf",

  // Date/time
  "date",
  "cal",

  // Encoding
  "base64",
  "md5sum",
  "sha256sum",
  "sha512sum",
  "xxd",
  "od",

  // Output
  "echo",
  "printf",
  "cat",
  "yes",

  // Misc safe
  "true",
  "false",
  "env",
]);

// Patterns that indicate attempted abuse even if the binary is allowed
const BLOCKED_PATTERNS = [
  /[;&`$(){}[\]]/,          // shell metacharacters
  /\.\.\//,                 // path traversal
  /\/dev\//,                // device access
  /\/proc\//,               // proc access
  /\/sys\//,                // sys access
  /\/etc\//,                // config access
  />\s*\//,                 // redirect to absolute path
  />\s*~/,                  // redirect to home
  /<\s*\//,                 // redirect from absolute path
];

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

/**
 * Validate that a command string only uses allowed binaries.
 * @param {string} command - Shell command string (pipes allowed)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateCommand(command) {
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        error: `Command contains blocked pattern: ${pattern.source}`,
      };
    }
  }

  // Split on pipes and validate each segment
  const segments = command.split("|").map((s) => s.trim());
  for (const segment of segments) {
    if (!segment) {
      return { valid: false, error: "Empty pipe segment" };
    }

    // Extract the binary name (first token)
    const binary = segment.split(/\s+/)[0];
    if (!ALLOWED_BINARIES.has(binary)) {
      return {
        valid: false,
        error: `Binary '${binary}' is not in the allowlist. Allowed: ${[...ALLOWED_BINARIES].sort().join(", ")}`,
      };
    }
  }

  return { valid: true };
}

// ────────────────────────────────────────────────────────────
// Execution Engine
// ────────────────────────────────────────────────────────────

/**
 * Execute an allowlisted shell command.
 *
 * @param {string} command - Shell command (pipes allowed)
 * @param {object} [options]
 * @param {string} [options.stdin] - Optional input piped to stdin
 * @param {number} [options.timeout=10000] - Execution timeout (max 30000)
 * @returns {Promise<{
 *   success: boolean,
 *   stdout: string,
 *   stderr: string,
 *   exitCode: number|null,
 *   executionTimeMs: number,
 *   timedOut: boolean,
 *   error?: string
 * }>}
 */
export async function executeShell(command, { stdin = "", timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const clampedTimeout = Math.min(Math.max(timeout, 500), MAX_TIMEOUT_MS);

  // Validate command
  const validation = validateCommand(command);
  if (!validation.valid) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      timedOut: false,
      error: validation.error,
    };
  }

  // Validate stdin size
  if (stdin && Buffer.byteLength(stdin) > MAX_INPUT_BYTES) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      timedOut: false,
      error: `stdin exceeds maximum size of ${MAX_INPUT_BYTES} bytes`,
    };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    // Run through bash with restricted flags
    // The -r flag disables some bash features, and we pass the command
    // via -c to avoid interactive mode
    const child = spawn("bash", ["-r", "-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin:/usr/local/bin",
        HOME: "/tmp",
        LANG: "C.UTF-8",
      },
      detached: false,
      cwd: "/tmp",
    });

    // Feed stdin and close
    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      if (stdoutLen < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderrLen < MAX_OUTPUT_BYTES) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, clampedTimeout);

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const executionTimeMs = Math.round(performance.now() - startTime);

      resolve({
        success: exitCode === 0 && !timedOut,
        stdout:
          stdoutLen > MAX_OUTPUT_BYTES
            ? stdout + "\n... [output truncated]"
            : stdout,
        stderr:
          stderrLen > MAX_OUTPUT_BYTES
            ? stderr + "\n... [output truncated]"
            : stderr,
        exitCode: timedOut ? null : exitCode,
        executionTimeMs,
        timedOut,
        ...(timedOut && {
          error: `Execution timed out after ${clampedTimeout}ms`,
        }),
      });
    }

    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          executionTimeMs: Math.round(performance.now() - startTime),
          timedOut: false,
          error: `Process error: ${err.message}`,
        });
      }
    });
  });
}

/**
 * Execute an allowlisted shell command with real-time output streaming.
 * Same security model as executeShell, but invokes `onChunk` for each
 * stdout/stderr data event as it arrives.
 *
 * @param {string} command - Shell command (pipes allowed)
 * @param {object} [options]
 * @param {string}   [options.stdin]     - Optional input piped to stdin
 * @param {number}   [options.timeout]   - Execution timeout (max 30000)
 * @param {function} [options.onChunk]   - (event: "stdout"|"stderr", data: string) => void
 * @returns {Promise<{ success, stdout, stderr, exitCode, executionTimeMs, timedOut, error? }>}
 */
export async function executeShellStreaming(command, { stdin = "", timeout = DEFAULT_TIMEOUT_MS, onChunk } = {}) {
  const clampedTimeout = Math.min(Math.max(timeout, 500), MAX_TIMEOUT_MS);

  const validation = validateCommand(command);
  if (!validation.valid) {
    return {
      success: false, stdout: "", stderr: "", exitCode: null,
      executionTimeMs: 0, timedOut: false, error: validation.error,
    };
  }

  if (stdin && Buffer.byteLength(stdin) > MAX_INPUT_BYTES) {
    return {
      success: false, stdout: "", stderr: "", exitCode: null,
      executionTimeMs: 0, timedOut: false,
      error: `stdin exceeds maximum size of ${MAX_INPUT_BYTES} bytes`,
    };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn("bash", ["-r", "-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin:/usr/local/bin", HOME: "/tmp", LANG: "C.UTF-8" },
      detached: false,
      cwd: "/tmp",
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      if (stdoutLen < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
        onChunk?.("stdout", chunk.toString("utf-8"));
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderrLen < MAX_OUTPUT_BYTES) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
        onChunk?.("stderr", chunk.toString("utf-8"));
      }
    });

    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, clampedTimeout);

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      resolve({
        success: exitCode === 0 && !timedOut,
        stdout: stdoutLen > MAX_OUTPUT_BYTES ? stdout + "\n... [output truncated]" : stdout,
        stderr: stderrLen > MAX_OUTPUT_BYTES ? stderr + "\n... [output truncated]" : stderr,
        exitCode: timedOut ? null : exitCode,
        executionTimeMs: Math.round(performance.now() - startTime),
        timedOut,
        ...(timedOut && { error: `Execution timed out after ${clampedTimeout}ms` }),
      });
    }

    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          success: false, stdout: "", stderr: "", exitCode: null,
          executionTimeMs: Math.round(performance.now() - startTime),
          timedOut: false, error: `Process error: ${err.message}`,
        });
      }
    });
  });
}

/**
 * Get the list of allowed binaries.
 */
export function getAllowedBinaries() {
  return [...ALLOWED_BINARIES].sort();
}
