// ─── Sandboxed Project Command Execution ────────────────────

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { validatePath, ALLOWED_ROOTS } from "./AgenticFileService.ts";
import {
  resolveAndRouteToAgent,
  sendRpc,
  sendRpcStreaming,
  offlineRemoteRootForPath,
} from "./AgentConnectionManager.ts";
import * as BackgroundProcessRegistry from "./BackgroundProcessRegistry.ts";
import logger from "../logger.ts";
import {
  AGENTIC_COMMAND_DEFAULT_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
  AGENTIC_COMMAND_MAX_TIMEOUT_MS as MAX_TIMEOUT_MS,
  AGENTIC_COMMAND_MAX_OUTPUT_BYTES as MAX_OUTPUT_BYTES,
  AGENTIC_COMMAND_BACKGROUND_WARMUP_MS as BACKGROUND_WARMUP_MS,
  AGENTIC_COMMAND_KILL_GRACE_PERIOD_MS as KILL_GRACE_PERIOD_MS,
  AGENTIC_COMMAND_ENV_ALLOWED_NAMES as ENV_ALLOWED_NAMES,
  AGENTIC_COMMAND_ENV_ALLOWED_PREFIXES as ENV_ALLOWED_PREFIXES,
} from "../constants.ts";
import { errorMessage, RESOLVED_BASH_PATH } from "../utilities.ts";
import { OutputAccumulator } from "../utilities/OutputAccumulator.ts";
import type { ChildProcess } from "node:child_process";


import type { CommandExecutionResult } from "@rodrigo-barraza/utilities-library";
export type { CommandExecutionResult };

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

// No command allowlist — the Docker container (or workspace agent sandbox)
// is the security boundary. CWD is still validated against ALLOWED_ROOTS
// to ensure commands execute within permitted directories.

function validateCommand(command: string): { valid: boolean; error?: string } {
  if (!command) {
    return { valid: false, error: "Command is required (string)" };
  }
  return { valid: true };
}

// ────────────────────────────────────────────────────────────
// Spawn Environment
// ────────────────────────────────────────────────────────────

/**
 * Environment for spawned commands: allowlisted passthrough of shell and
 * toolchain plumbing only — the service's own env carries API keys and DB
 * credentials that arbitrary commands must not inherit.
 */
export function buildCommandEnv(): NodeJS.ProcessEnv {
  if (process.env.AGENTIC_COMMAND_INHERIT_FULL_ENV === "true") {
    return {
      ...process.env,
      CI: "true", // Disable interactive features
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    };
  }

  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      ENV_ALLOWED_NAMES.has(name) ||
      ENV_ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      env[name] = value;
    }
  }
  env.CI = "true";
  env.FORCE_COLOR = "0";
  env.NO_COLOR = "1";
  return env;
}

/**
 * Kill a spawned command's entire process group (children spawn detached,
 * so the bash child is its group leader). Signaling only the direct child
 * orphans grandchildren — npm→node, python -m http.server, etc.
 */
function killChildGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

// ────────────────────────────────────────────────────────────
// Execution Engine
// ────────────────────────────────────────────────────────────

/**
 * Sentinel returned by tryAgentRouteCommand when no remote agent serves the
 * cwd, so callers fall back to local execution. Mirrors the NO_AGENT sentinel
 * in AgenticFileService: a remote result can never be mistaken for "no agent"
 * and silently re-run locally on the wrong machine.
 */
const NO_AGENT = Symbol("no-agent");

// Agent routing helper
async function tryAgentRouteCommand(
  method: string,
  params: Record<string, unknown>,
  resolvedCwd: string,
): Promise<CommandExecutionResult | typeof NO_AGENT> {
  const agent = resolveAndRouteToAgent(resolvedCwd, ALLOWED_ROOTS[0]);
  if (!agent) {
    const offlineRoot = offlineRemoteRootForPath(resolvedCwd, ALLOWED_ROOTS[0]);
    if (offlineRoot) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        executionTimeMs: 0,
        error: `The workspace agent serving '${offlineRoot}' is offline, so this command was NOT run (running it locally on the server would execute on the wrong machine). Reconnect the workspace agent and retry.`,
      };
    }
    return NO_AGENT;
  }
  try {
    return (await sendRpc(agent.id, method, params)) as CommandExecutionResult;
  } catch (error: unknown) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      error: `Agent RPC failed: ${errorMessage(error)}`,
    };
  }
}

/**
 * Execute a project-scoped command.
 *
 * Supports two non-blocking strategies for long-running processes:
 *   1. **Explicit `runInBackground`** — model sets this to true; the command
 *      spawns, collects warmup output (~2.5s), then returns with a `pid`.
 *   2. **Auto-background on timeout** — instead of killing the process,
 *      it's promoted to the background registry and returns what we have.
 */
export async function executeCommand(
  command: string,
  {
    cwd,
    timeout = DEFAULT_TIMEOUT_MS,
    signal,
    runInBackground = false,
  }: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    runInBackground?: boolean;
  } = {},
): Promise<CommandExecutionResult> {
  const resolvedCwd = cwd || ALLOWED_ROOTS[0];

  // Agent routing — if CWD is served by a remote agent, proxy the command
  const agentResult = await tryAgentRouteCommand(
    "command.run",
    { command, cwd: resolvedCwd, timeout, runInBackground },
    resolvedCwd,
  );
  if (agentResult !== NO_AGENT) return agentResult;

  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);

  // Validate command
  const validation = validateCommand(command);
  if (!validation.valid) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      error: validation.error,
    };
  }

  // Validate CWD
  const cwdValidation = validatePath(resolvedCwd);
  if (!cwdValidation.safe) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      error: `Invalid working directory: ${cwdValidation.error}`,
    };
  }
  // Check the cwd actually exists — otherwise the spawn fails with a cryptic
  // "spawn bash ENOENT" that reads as "bash is missing", not "cwd not found".
  if (!existsSync(cwdValidation.resolved)) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      error: `Working directory does not exist: ${cwdValidation.resolved}. Pass an existing absolute 'cwd', or create it first.`,
    };
  }

  // Fast path: already aborted before we spawn
  if (signal?.aborted) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      aborted: true,
      error: "Command aborted before execution",
    };
  }

  const startTime = performance.now();

  return new Promise<CommandExecutionResult>((resolve) => {
    const stdoutAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    const stderrAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    const timedOut = false;
    let aborted = false;
    let settled = false;

    // Use bash -l -c to get full PATH (conda, nvm, etc.)
    // detached: true makes the bash child a process-group leader so
    // kill(-pid) reaches grandchildren (npm→node, dev servers).
    const child = spawn(RESOLVED_BASH_PATH, ["-l", "-c", command], {
      cwd: cwdValidation.resolved,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCommandEnv(),
      detached: true,
    });

    child.stdin.end();

    // ── Helper: background the process and resolve immediately ────
    function backgroundAndResolve(reason: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);

      const executionTimeMs = Math.round(performance.now() - startTime);

      // Register in the background process registry
      BackgroundProcessRegistry.register(child, {
        command,
        cwd: cwdValidation.resolved || "",
      });
      logger.info(
        `[AgenticCommandService] Backgrounded PID ${child.pid}: ${reason} (${command.slice(0, 60)})`,
      );

      resolve({
        success: true,
        stdout: stdoutAccumulator.toString(),
        stderr: stderrAccumulator.toString(),
        exitCode: null,
        executionTimeMs,
        backgrounded: true,
        pid: child.pid,
        backgroundReason: reason,
      });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutAccumulator.append(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrAccumulator.append(chunk);
    });

    // Tier 3: On timeout, auto-background instead of killing
    const timer = setTimeout(() => {
      if (!settled) {
        // If the process is still alive and producing output, background it
        // instead of killing it. This handles unexpected long-running commands.
        backgroundAndResolve("auto_backgrounded_timeout");
      }
    }, clampedTimeout);

    // Kill child process when upstream abort signal fires (user pressed Stop)
    const onAbort = () => {
      if (!settled) {
        aborted = true;
        killChildGroup(child, "SIGKILL");
      }
    };
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Tier 1: Explicit run_in_background — warmup then return
    if (runInBackground) {
      setTimeout(() => {
        if (!settled) {
          backgroundAndResolve("run_in_background");
        }
      }, BACKGROUND_WARMUP_MS);
    }

    function finish(exitCode: number | null, signalName?: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);

      const executionTimeMs = Math.round(performance.now() - startTime);

      // A process killed by a signal (OOM SIGKILL, segfault SIGSEGV, …) exits
      // with code null and signalName set. Without this the model saw a bare
      // { success:false, exitCode:null } with no reason and usually just retried.
      const killedBySignal =
        exitCode === null && signalName && !timedOut && !aborted;

      resolve({
        success: exitCode === 0 && !timedOut && !aborted,
        stdout: stdoutAccumulator.toString(),
        stderr: stderrAccumulator.toString(),
        exitCode: timedOut || aborted ? null : exitCode,
        executionTimeMs,
        timedOut,
        ...(aborted
          ? { aborted: true, error: "Command aborted (session stopped)" }
          : {}),
        ...(timedOut && !aborted
          ? { error: `Command timed out after ${clampedTimeout}ms` }
          : {}),
        ...(killedBySignal
          ? {
              error: `Process terminated by signal ${signalName}${signalName === "SIGKILL" ? " (often an out-of-memory kill)" : ""}.`,
            }
          : {}),
      });
    }

    child.on("close", (code: number | null, signalName: NodeJS.Signals | null) =>
      finish(code, signalName),
    );
    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          executionTimeMs: Math.round(performance.now() - startTime),
          error: `Process error: ${error.message}`,
        });
      }
    });
  });
}

/**
 * Execute a command with SSE streaming output.
 */
export async function executeCommandStreaming(
  command: string,
  {
    cwd,
    timeout = DEFAULT_TIMEOUT_MS,
    onChunk,
    signal,
  }: {
    cwd?: string;
    timeout?: number;
    onChunk?: (type: "stdout" | "stderr", chunk: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<CommandExecutionResult> {
  const resolvedCwd = cwd || ALLOWED_ROOTS[0];

  // Agent routing for streaming commands
  const agent = resolveAndRouteToAgent(resolvedCwd, ALLOWED_ROOTS[0]);
  if (agent) {
    try {
      return (await sendRpcStreaming(
        agent.id,
        "command.stream",
        { command, cwd: resolvedCwd, timeout },
        (method: string, params: Record<string, unknown>) => {
          if (method === "command.stdout")
            onChunk?.("stdout", params.data as string);
          else if (method === "command.stderr")
            onChunk?.("stderr", params.data as string);
        },
      )) as CommandExecutionResult;
    } catch (error: unknown) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        executionTimeMs: 0,
        error: `Agent RPC failed: ${errorMessage(error)}`,
      };
    }
  }

  const clampedTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);

  const validation = validateCommand(command);
  if (!validation.valid) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      error: validation.error,
    };
  }

  const cwdValidation = validatePath(resolvedCwd);
  if (!cwdValidation.safe) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      error: `Invalid working directory: ${cwdValidation.error}`,
    };
  }

  // Fast path: already aborted before we spawn
  if (signal?.aborted) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      aborted: true,
      error: "Command aborted before execution",
    };
  }

  const startTime = performance.now();

  return new Promise<CommandExecutionResult>((resolve) => {
    const stdoutAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    const stderrAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    let streamedBytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const child = spawn(RESOLVED_BASH_PATH, ["-l", "-c", command], {
      cwd: cwdValidation.resolved,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCommandEnv(),
      detached: true,
    });

    child.stdin.end();

    // SSE emission stays capped so a runaway command can't flood the
    // client; the buffered result keeps the tail via the accumulator.
    function streamChunk(type: "stdout" | "stderr", chunk: Buffer) {
      if (streamedBytes < MAX_OUTPUT_BYTES) {
        streamedBytes += chunk.length;
        onChunk?.(type, chunk.toString("utf-8"));
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutAccumulator.append(chunk);
      streamChunk("stdout", chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrAccumulator.append(chunk);
      streamChunk("stderr", chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killChildGroup(child, "SIGKILL");
    }, clampedTimeout);

    // Kill child process when upstream abort signal fires (user pressed Stop)
    const onAbort = () => {
      if (!settled) {
        aborted = true;
        killChildGroup(child, "SIGKILL");
      }
    };
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    function finish(exitCode: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        success: exitCode === 0 && !timedOut && !aborted,
        stdout: stdoutAccumulator.toString(),
        stderr: stderrAccumulator.toString(),
        exitCode: timedOut || aborted ? null : exitCode,
        executionTimeMs: Math.round(performance.now() - startTime),
        timedOut,
        ...(aborted
          ? { aborted: true, error: "Command aborted (session stopped)" }
          : {}),
        ...(timedOut && !aborted
          ? { error: `Command timed out after ${clampedTimeout}ms` }
          : {}),
      });
    }

    child.on("close", (code: number | null) => finish(code));
    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          executionTimeMs: Math.round(performance.now() - startTime),
          error: `Process error: ${error.message}`,
        });
      }
    });
  });
}

/**
 * Get the list of allowed commands.
 * Returns an empty array — all commands are now permitted.
 * The Docker container / workspace agent sandbox is the security boundary.
 */
export function getAllowedCommands(): string[] {
  return [];
}

/**
 * List all background processes.
 */
export function listBackgroundProcesses(): BackgroundProcessRegistry.ProcessListEntry[] {
  return BackgroundProcessRegistry.list();
}

/**
 * Get a specific background process by PID.
 */
export function getBackgroundProcess(pid: number) {
  return BackgroundProcessRegistry.getProcess(pid);
}

/**
 * Kill a tracked background process (registry-scoped, process-group aware).
 * Unlike killProcessTree this only touches PIDs in the background registry.
 */
export function killBackgroundProcess(pid: number) {
  return BackgroundProcessRegistry.kill(pid);
}

/**
 * Kill a process tree by PID.
 * Attempts SIGTERM first, then SIGKILL after a grace period.
 */
export async function killProcessTree(
  pid: number,
  { gracePeriodMs = KILL_GRACE_PERIOD_MS }: { gracePeriodMs?: number } = {},
): Promise<{
  success: boolean;
  pid?: number;
  signal?: string;
  escalated?: boolean;
  error?: string;
  message?: string;
}> {
  if (!pid || typeof pid !== "number" || pid <= 0) {
    return {
      success: false,
      error: "Valid PID is required (positive integer)",
    };
  }

  // Safety: refuse to kill PID 1 or our own process
  if (pid === 1 || pid === process.pid) {
    return {
      success: false,
      error: `Refusing to kill PID ${pid} (protected process)`,
    };
  }

  try {
    // Check if the process exists first
    process.kill(pid, 0); // Signal 0 = existence check, no actual signal sent
  } catch {
    return {
      success: false,
      error: `Process ${pid} not found or not accessible`,
    };
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
    await new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs));

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
  } catch (error: unknown) {
    return {
      success: false,
      pid,
      error: `Failed to kill process: ${errorMessage(error)}`,
    };
  }
}
