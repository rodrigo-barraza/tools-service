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
import { routeForPath, sendRpc, sendRpcStreaming } from "./AgentConnectionManager.js";

// Agent routing helper
async function tryAgentRouteCommand(method, params, cwd) {
  if (!cwd) return null;
  const agent = routeForPath(cwd);
  if (!agent) return null;
  try {
    return await sendRpc(agent.id, method, params);
  } catch (err) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: `Agent RPC failed: ${err.message}` };
  }
}

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

// Patterns that indicate abuse attempts.
// NOTE: The binary allowlist (ALLOWED_COMMANDS) is the primary defense.
// These patterns catch shell-level abuse that bypasses binary checks.
// We intentionally allow $ (variable expansion) and {..} (brace expansion)
// since they're essential for normal bash usage (for loops, env vars, etc.).
const BLOCKED_PATTERNS = [
  /`/,                  // backtick command substitution (use $() if needed — caught below only for dangerous cases)
  /\$\(/,              // $() command substitution — can execute arbitrary commands
  /\.\.\//,             // path traversal
  /\/dev\//,            // device access
  /\/proc\//,           // proc access
  /\/sys\//,            // sys access
  /\/etc\//,            // config access
  />\s*\//,             // redirect to absolute path
  />\s*~/,              // redirect to home
  /rm\s+-rf/i,          // destructive rm
  /\|\s*(bash|sh|zsh|dash)\b/, // piping into a shell
  /eval\s+/,            // eval calls
  /source\s+/,          // sourcing arbitrary scripts
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
export async function executeCommand(command, { cwd, timeout = DEFAULT_TIMEOUT_MS, signal } = {}) {
  // Agent routing — if CWD is served by a remote agent, proxy the command
  const agentResult = await tryAgentRouteCommand("command.run", { command, cwd, timeout }, cwd);
  if (agentResult) return agentResult;

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

  // Fast path: already aborted before we spawn
  if (signal?.aborted) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, aborted: true, error: "Command aborted before execution" };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let aborted = false;
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

    // Kill child process when upstream abort signal fires (user pressed Stop)
    const onAbort = () => {
      if (!settled) {
        aborted = true;
        child.kill("SIGKILL");
      }
    };
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const executionTimeMs = Math.round(performance.now() - startTime);

      resolve({
        success: exitCode === 0 && !timedOut && !aborted,
        stdout: stdoutLen > MAX_OUTPUT_BYTES ? stdout + "\n... [output truncated]" : stdout,
        stderr: stderrLen > MAX_OUTPUT_BYTES ? stderr + "\n... [output truncated]" : stderr,
        exitCode: (timedOut || aborted) ? null : exitCode,
        executionTimeMs,
        timedOut,
        ...(aborted && { aborted: true, error: "Command aborted (session stopped)" }),
        ...(timedOut && !aborted && { error: `Command timed out after ${clampedTimeout}ms` }),
      });
    }

    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
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
export async function executeCommandStreaming(command, { cwd, timeout = DEFAULT_TIMEOUT_MS, onChunk, signal } = {}) {
  // Agent routing for streaming commands
  if (cwd) {
    const agent = routeForPath(cwd);
    if (agent) {
      try {
        return await sendRpcStreaming(agent.id, "command.stream", { command, cwd, timeout }, (method, params) => {
          if (method === "command.stdout") onChunk?.("stdout", params.data);
          else if (method === "command.stderr") onChunk?.("stderr", params.data);
        });
      } catch (err) {
        return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: `Agent RPC failed: ${err.message}` };
      }
    }
  }

  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);

  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: validation.error };
  }

  const cwdValidation = validatePath(cwd || process.env.HOME);
  if (!cwdValidation.safe) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, error: `Invalid working directory: ${cwdValidation.error}` };
  }

  // Fast path: already aborted before we spawn
  if (signal?.aborted) {
    return { success: false, stdout: "", stderr: "", exitCode: null, executionTimeMs: 0, aborted: true, error: "Command aborted before execution" };
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let aborted = false;
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

    // Kill child process when upstream abort signal fires (user pressed Stop)
    const onAbort = () => {
      if (!settled) {
        aborted = true;
        child.kill("SIGKILL");
      }
    };
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      resolve({
        success: exitCode === 0 && !timedOut && !aborted,
        stdout: stdoutLen > MAX_OUTPUT_BYTES ? stdout + "\n... [output truncated]" : stdout,
        stderr: stderrLen > MAX_OUTPUT_BYTES ? stderr + "\n... [output truncated]" : stderr,
        exitCode: (timedOut || aborted) ? null : exitCode,
        executionTimeMs: Math.round(performance.now() - startTime),
        timedOut,
        ...(aborted && { aborted: true, error: "Command aborted (session stopped)" }),
        ...(timedOut && !aborted && { error: `Command timed out after ${clampedTimeout}ms` }),
      });
    }

    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
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

/**
 * Kill a process tree by PID.
 * Attempts SIGTERM first, then SIGKILL after a grace period.
 *
 * @param {number} pid - Process ID to kill
 * @param {object} [options]
 * @param {number} [options.gracePeriodMs=3000] - Time to wait before escalating to SIGKILL
 * @returns {Promise<object>} Result with killed status
 */
export async function killProcessTree(pid, { gracePeriodMs = 3000 } = {}) {
  if (!pid || typeof pid !== "number" || pid <= 0) {
    return { success: false, error: "Valid PID is required (positive integer)" };
  }

  // Safety: refuse to kill PID 1 or our own process
  if (pid === 1 || pid === process.pid) {
    return { success: false, error: `Refusing to kill PID ${pid} (protected process)` };
  }

  try {
    // Check if the process exists first
    process.kill(pid, 0); // Signal 0 = existence check, no actual signal sent
  } catch {
    return { success: false, error: `Process ${pid} not found or not accessible` };
  }

  try {
    // Try to kill the entire process group (negative PID)
    // This catches child processes spawned by the target
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // If process group kill fails (e.g. not a group leader), kill just the process
      process.kill(pid, "SIGTERM");
    }

    // Wait for grace period then check if still alive
    await new Promise((resolve) => setTimeout(resolve, gracePeriodMs));

    try {
      process.kill(pid, 0); // Still alive?
      // Escalate to SIGKILL
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
      return { success: true, pid, signal: "SIGKILL", escalated: true };
    } catch {
      // Process is gone — SIGTERM was sufficient
      return { success: true, pid, signal: "SIGTERM", escalated: false };
    }
  } catch (err) {
    return { success: false, pid, error: `Failed to kill process: ${err.message}` };
  }
}
