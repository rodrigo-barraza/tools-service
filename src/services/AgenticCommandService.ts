// ─── Sandboxed Project Command Execution ────────────────────

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { validatePath, ALLOWED_ROOTS } from "./AgenticFileService.ts";
import {
  resolveAndRouteToAgent,
  resolveWorkspaceTargetPath,
  sendRpc,
  sendRpcStreaming,
  offlineRemoteRootForPath,
} from "./AgentConnectionManager.ts";
import { adoptAgentShell, ownerOf, startLocalShell } from "./tasks/WorkspaceTaskService.ts";
import {
  KILL_GRACE_MS,
  backgroundCommandResult,
  clampCommandTimeout,
  signalProcessGroup,
  terminateProcessGroup,
} from "./tasks/TaskEngine.ts";
import type { TaskOwner } from "./tasks/TaskEngine.ts";
import {
  AGENTIC_COMMAND_MAX_OUTPUT_BYTES as MAX_OUTPUT_BYTES,
  AGENTIC_COMMAND_ENV_ALLOWED_NAMES as ENV_ALLOWED_NAMES,
  AGENTIC_COMMAND_ENV_ALLOWED_PREFIXES as ENV_ALLOWED_PREFIXES,
} from "../constants.ts";
import { errorMessage, RESOLVED_BASH_PATH } from "../utilities.ts";
import { OutputAccumulator } from "../utilities/OutputAccumulator.ts";
import type { ChildProcess } from "node:child_process";
import type { CommandExecutionResult as LibraryCommandExecutionResult } from "@rodrigo-barraza/utilities-library";

/**
 * A command's result. A background run (run_in_background) answers at once,
 * as Claude Code's Bash does: `backgrounded`, the `taskId`, its `outputFile`
 * and the line the model reads (`message`).
 */
export type CommandExecutionResult = Omit<LibraryCommandExecutionResult, "pid"> & {
  pid?: number | null;
  taskId?: string;
  outputFile?: string;
  message?: string;
};

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
 * At the deadline: SIGTERM the command's process group, SIGKILL it 2 s later
 * (children spawn detached, so the bash child leads the group and the signal
 * reaches npm→node and the like). A descendant outside the group that kept
 * our pipes must not hold the answer back, so they close soon after.
 */
function killAtDeadline(child: ChildProcess): ReturnType<typeof setTimeout> {
  terminateProcessGroup(child);
  return setTimeout(() => {
    child.stdout?.destroy();
    child.stderr?.destroy();
  }, KILL_GRACE_MS + 500);
}

/**
 * The working directory: `cwd` (a relative one is the request's workspace's),
 * or the request's worktree / workspace root, or the first allowed root.
 */
function commandWorkingDirectory(cwd: string | undefined): string {
  return resolveWorkspaceTargetPath(cwd || ".", ALLOWED_ROOTS[0]) ?? cwd ?? ALLOWED_ROOTS[0];
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
    const result = (await sendRpc(agent.id, method, params)) as CommandExecutionResult;
    // A background run is a task on that agent: its events come back here
    if (result.backgrounded && result.taskId) adoptAgentShell(agent, result, params);
    return result;
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
 * Execute a project-scoped command, as Claude Code's Bash does:
 *   - foreground: `timeout` defaults to 120 s, at most 600 s; past it the
 *     process group is killed and the result carries the output so far and
 *     "Command timed out after <N>ms". It is never moved to the background.
 *   - `runInBackground`: a shell task (TaskEngine) — detached, no time limit,
 *     its output in a file; the answer comes at once with the task id.
 * Where the cwd is served by a workspace agent, the agent runs it.
 */
export async function executeCommand(
  command: string,
  {
    cwd,
    timeout,
    signal,
    runInBackground = false,
    description = "",
    owner = {},
  }: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    runInBackground?: boolean;
    description?: string;
    owner?: TaskOwner;
  } = {},
): Promise<CommandExecutionResult> {
  const resolvedCwd = commandWorkingDirectory(cwd);
  const clampedTimeout = clampCommandTimeout(timeout);
  // A background run belongs to whoever asks, unless told otherwise
  const taskOwner = ownerOf(owner);

  // Agent routing — if CWD is served by a remote agent, proxy the command
  const agentResult = await tryAgentRouteCommand(
    "command.run",
    { command, cwd: resolvedCwd, timeout: clampedTimeout, runInBackground, description, owner: taskOwner },
    resolvedCwd,
  );
  if (agentResult !== NO_AGENT) return agentResult;

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

  if (runInBackground) {
    try {
      return backgroundCommandResult(
        startLocalShell({ command, cwd: cwdValidation.resolved, description, owner: taskOwner }),
      );
    } catch (error: unknown) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        executionTimeMs: 0,
        error: `Could not start the background command: ${errorMessage(error)}`,
      };
    }
  }

  const startTime = performance.now();

  return new Promise<CommandExecutionResult>((resolve) => {
    const stdoutAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    const stderrAccumulator = new OutputAccumulator(MAX_OUTPUT_BYTES);
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;

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

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutAccumulator.append(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrAccumulator.append(chunk);
    });

    // At the deadline the group is killed — never moved to the background
    const timer = setTimeout(() => {
      timedOut = true;
      forceCloseTimer = killAtDeadline(child);
    }, clampedTimeout);

    // Kill child process when upstream abort signal fires (user pressed Stop)
    const onAbort = () => {
      if (!settled) {
        aborted = true;
        signalProcessGroup(child, "SIGKILL");
      }
    };
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    function finish(exitCode: number | null, signalName?: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
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
        if (forceCloseTimer) clearTimeout(forceCloseTimer);
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
    timeout,
    onChunk,
    signal,
  }: {
    cwd?: string;
    timeout?: number;
    onChunk?: (type: "stdout" | "stderr", chunk: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<CommandExecutionResult> {
  const resolvedCwd = commandWorkingDirectory(cwd);
  const clampedTimeout = clampCommandTimeout(timeout);

  // Agent routing for streaming commands
  const agent = resolveAndRouteToAgent(resolvedCwd, ALLOWED_ROOTS[0]);
  if (agent) {
    try {
      return (await sendRpcStreaming(
        agent.id,
        "command.stream",
        { command, cwd: resolvedCwd, timeout: clampedTimeout },
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
    let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;

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
      forceCloseTimer = killAtDeadline(child);
    }, clampedTimeout);

    // Kill child process when upstream abort signal fires (user pressed Stop)
    const onAbort = () => {
      if (!settled) {
        aborted = true;
        signalProcessGroup(child, "SIGKILL");
      }
    };
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    function finish(exitCode: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
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
        if (forceCloseTimer) clearTimeout(forceCloseTimer);
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
