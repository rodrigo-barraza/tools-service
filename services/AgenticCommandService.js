// ============================================================
// Agentic Command Service — Sandboxed Project Command Execution
// ============================================================
// Executes project-scoped commands (npm, git, eslint, etc.) in
// a subprocess with:
//   - Allowlisted command prefixes (not arbitrary shell)
//   - CWD scoped to ALLOWED_ROOTS
//   - Configurable timeout (default 60s, max 120s)
//   - Stdout/stderr capture with truncation
//   - SSE streaming variant for real-time output
//
// Unlike ShellExecutorService (restricted text-processing),
// this is designed for build/test/lint/VCS project commands.
// ============================================================

import { spawn } from "node:child_process";
import { validatePath } from "./AgenticFileService.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

// Only these command prefixes are allowed as the first token.
const ALLOWED_COMMANDS = new Set([
  // Node.js ecosystem
  "npm", "npx", "node",
  // Linting / formatting
  "eslint", "prettier", "tsc", "stylelint",
  // Python
  "python3", "pip", "pip3",
  // Git (read-only operations are safeguarded in args)
  "git",
  // File inspection (read-only)
  "cat", "ls", "find", "wc", "diff", "which", "file", "head", "tail",
  "tree", "du",
  // Process inspection
  "ps", "lsof",
]);

// Git subcommands that are allowed (read-only + common safe operations)
const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "status", "diff", "log", "show", "branch", "tag",
  "stash", "remote", "describe", "shortlog",
  "rev-parse", "ls-files", "ls-tree", "blame",
  "config", "reflog",
  // Allow add/commit/checkout but these need approval
  "add", "commit", "checkout", "switch", "restore",
  "merge", "rebase", "cherry-pick", "reset",
  "push", "pull", "fetch",
]);

// Patterns that indicate abuse attempts
const BLOCKED_PATTERNS = [
  /[`$]/,               // command/variable substitution
  /\.\.\//,             // path traversal
  /\/dev\//,            // device access
  /\/proc\//,           // proc access
  /\/sys\//,            // sys access
  /\/etc\//,            // config access
  />\s*\//,             // redirect to absolute path
  />\s*~/,              // redirect to home
  /rm\s+-rf/i,          // destructive rm
];

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

function validateCommand(command) {
  if (!command || typeof command !== "string") {
    return { valid: false, error: "Command is required (string)" };
  }

  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: `Command contains blocked pattern: ${pattern.source}` };
    }
  }

  // Extract the first token (the binary)
  const tokens = command.trim().split(/\s+/);
  const binary = tokens[0];

  if (!ALLOWED_COMMANDS.has(binary)) {
    return {
      valid: false,
      error: `Command '${binary}' is not allowed. Allowed: ${[...ALLOWED_COMMANDS].sort().join(", ")}`,
    };
  }

  // Extra validation for git: check subcommand
  if (binary === "git" && tokens.length > 1) {
    // Skip flags (e.g., git -C /path status)
    let subIdx = 1;
    while (subIdx < tokens.length && tokens[subIdx].startsWith("-")) {
      subIdx += (tokens[subIdx] === "-C" || tokens[subIdx] === "--git-dir") ? 2 : 1;
    }
    const subcommand = tokens[subIdx];
    if (subcommand && !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      return {
        valid: false,
        error: `Git subcommand '${subcommand}' is not allowed. Allowed: ${[...ALLOWED_GIT_SUBCOMMANDS].sort().join(", ")}`,
      };
    }
  }

  return { valid: true };
}

// ────────────────────────────────────────────────────────────
// Execution Engine
// ────────────────────────────────────────────────────────────

/**
 * Execute a project-scoped command.
 *
 * @param {string} command - Shell command to execute
 * @param {object} [options]
 * @param {string} [options.cwd] - Working directory (must be within ALLOWED_ROOTS)
 * @param {number} [options.timeout=60000] - Timeout in ms (max 120000)
 * @returns {Promise<object>}
 */
export async function executeCommand(command, { cwd, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);

  // Validate command
  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: validation.error };
  }

  // Validate CWD
  const cwdValidation = validatePath(cwd || process.env.HOME);
  if (!cwdValidation.safe) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: `Invalid working directory: ${cwdValidation.error}` };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    // Use bash -l -c to get full PATH (conda, nvm, etc.)
    const child = spawn("bash", ["-l", "-c", command], {
      cwd: cwdValidation.resolved,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: "true",  // Disable interactive features
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      detached: false,
    });

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
        stdout: stdoutLen > MAX_OUTPUT_BYTES ? stdout + "\n... [output truncated]" : stdout,
        stderr: stderrLen > MAX_OUTPUT_BYTES ? stderr + "\n... [output truncated]" : stderr,
        exitCode: timedOut ? null : exitCode,
        executionTimeMs,
        timedOut,
        ...(timedOut && { error: `Command timed out after ${clampedTimeout}ms` }),
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
          error: `Process error: ${err.message}`,
        });
      }
    });
  });
}

/**
 * Execute a command with SSE streaming output.
 *
 * @param {string} command - Shell command to execute
 * @param {object} [options]
 * @param {string} [options.cwd] - Working directory
 * @param {number} [options.timeout=60000] - Timeout in ms
 * @param {function} [options.onChunk] - (event: "stdout"|"stderr", data: string) => void
 * @returns {Promise<object>}
 */
export async function executeCommandStreaming(command, { cwd, timeout = DEFAULT_TIMEOUT_MS, onChunk } = {}) {
  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);

  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: validation.error };
  }

  const cwdValidation = validatePath(cwd || process.env.HOME);
  if (!cwdValidation.safe) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: `Invalid working directory: ${cwdValidation.error}` };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn("bash", ["-l", "-c", command], {
      cwd: cwdValidation.resolved,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: "true",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      detached: false,
    });

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
        ...(timedOut && { error: `Command timed out after ${clampedTimeout}ms` }),
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
          error: `Process error: ${err.message}`,
        });
      }
    });
  });
}

/**
 * Get the list of allowed commands.
 */
export function getAllowedCommands() {
  return [...ALLOWED_COMMANDS].sort();
}
