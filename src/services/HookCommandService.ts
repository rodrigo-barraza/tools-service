// ─── Prism `command` hook execution ─────────────────────────

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import logger from "../logger.ts";
import {
  HOOK_COMMAND_DEFAULT_TIMEOUT_MS,
  HOOK_COMMAND_MAX_TIMEOUT_MS,
  HOOK_COMMAND_MIN_TIMEOUT_MS,
  HOOK_COMMAND_MAX_OUTPUT_BYTES,
  HOOK_COMMAND_ENV_NAME_PATTERN,
  HOOK_COMMAND_ENV_VALUE_MAX_CHARS,
} from "../constants.ts";
import { RESOLVED_BASH_PATH } from "../utilities.ts";
import { buildCommandEnv } from "./AgenticCommandService.ts";

/**
 * HookCommandService — runs a prism-service `command` hook (Claude Code's
 * shell hook): the hook event as JSON on stdin, a decision back through the
 * exit code and stdout.
 *
 * It is NOT `/agentic/command/run`, on purpose:
 *   - **Where.** The working directory is a dedicated per-owner hooks
 *     directory (`HOOK_COMMANDS_DIRECTORY/<owner>`, created on demand), never
 *     a workspace root. A hook is infrastructure the owner installed, not
 *     something that runs inside the repository the agent is editing.
 *   - **stdin.** The payload is written to the command's stdin; the agentic
 *     command route closes stdin immediately.
 *   - **Timeout.** On timeout the whole process group is KILLED and the
 *     result says `timedOut: true`. The agentic route moves a slow command
 *     to the background instead — right for a build, wrong for a gate the
 *     agent loop is waiting on.
 *   - **Environment.** The same allowlist as agentic commands (no service
 *     credentials), plus only `PRISM_HOOK_*` variables from the caller.
 *
 * There is no OS sandbox (#14): a hook runs with this service's privileges.
 * prism-service therefore lets only owner-listed usernames create one.
 */

export interface HookCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMilliseconds: number;
  error?: string;
}

export interface HookCommandOptions {
  owner: string;
  stdin?: string;
  timeoutMilliseconds?: number;
  env?: Record<string, unknown>;
  signal?: AbortSignal;
}

/** Root of every owner's hooks directory. Read per call so tests can point it elsewhere. */
export function hooksRootDirectory(): string {
  return process.env.HOOK_COMMANDS_DIRECTORY || join(homedir(), ".prism", "hooks");
}

/** An owner name as a single safe path segment. */
export function ownerDirectoryName(owner: string): string {
  const cleaned = owner.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
  return cleaned.slice(0, 64) || "_";
}

/** The owner's hooks directory, created on demand. */
export function resolveHooksDirectory(owner: string): string {
  const directory = join(hooksRootDirectory(), ownerDirectoryName(owner));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

/** Only `PRISM_HOOK_*` names, only strings, each capped. Everything else is dropped. */
export function filterHookEnv(env: Record<string, unknown> | undefined): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    if (!HOOK_COMMAND_ENV_NAME_PATTERN.test(name) || typeof value !== "string") continue;
    filtered[name] = value.slice(0, HOOK_COMMAND_ENV_VALUE_MAX_CHARS);
  }
  return filtered;
}

export function clampHookTimeout(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : HOOK_COMMAND_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, HOOK_COMMAND_MIN_TIMEOUT_MS), HOOK_COMMAND_MAX_TIMEOUT_MS);
}

function killGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Append to a buffer capped at HOOK_COMMAND_MAX_OUTPUT_BYTES; the excess is dropped. */
function appendCapped(chunks: Buffer[], size: { bytes: number }, chunk: Buffer): void {
  const room = HOOK_COMMAND_MAX_OUTPUT_BYTES - size.bytes;
  if (room <= 0) return;
  const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
  chunks.push(kept);
  size.bytes += kept.length;
}

export async function executeHookCommand(
  command: string,
  options: HookCommandOptions,
): Promise<HookCommandResult> {
  const startedAt = Date.now();
  const timeoutMilliseconds = clampHookTimeout(options.timeoutMilliseconds);
  const cwd = resolveHooksDirectory(options.owner);

  return new Promise<HookCommandResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutSize = { bytes: 0 };
    const stderrSize = { bytes: 0 };
    let timedOut = false;
    let settled = false;

    const child = spawn(RESOLVED_BASH_PATH, ["-c", command], {
      cwd,
      env: {
        ...buildCommandEnv(),
        ...filterHookEnv(options.env),
        PRISM_HOOKS_DIR: cwd,
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    const finish = (exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: timedOut ? null : exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        durationMilliseconds: Date.now() - startedAt,
        ...(error && { error }),
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      logger.warn(`[HookCommandService] Hook command timed out after ${timeoutMilliseconds}ms — killing its process group`);
      killGroup(child);
    }, timeoutMilliseconds);

    const onAbort = () => killGroup(child);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => appendCapped(stdoutChunks, stdoutSize, chunk));
    child.stderr?.on("data", (chunk: Buffer) => appendCapped(stderrChunks, stderrSize, chunk));
    // A script that never reads its stdin closes the pipe under us; that is
    // not an error for the hook.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.stdin ?? "");

    child.on("error", (spawnError) => finish(null, spawnError.message));
    child.on("close", (code) => finish(code));
  });
}
