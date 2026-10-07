// ─── Workspace Hooks — a repository's own hooks, where the repository is ───
//
// prism-service runs the hooks a repository declares (`.prism/hooks.json`,
// Claude Code's / Codex's schema) and the user's `~/.prism/hooks.json`. They
// run on the machine that holds the repository: through the workspace
// bridge serving the path (hook.run / hooks.config / transcript.append), or
// here when no bridge serves it — with the same module the bridge runs
// (WorkspaceHooks.ts).

import { isAbsolute } from "node:path";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { errorMessage } from "../../utilities.ts";
import { ALLOWED_ROOTS, validatePath } from "../AgenticFileService.ts";
import {
  offlineRemoteRootForPath,
  resolveAndRouteToAgent,
  sendRpc,
} from "../AgentConnectionManager.ts";
import { buildCommandEnv } from "../AgenticCommandService.ts";
import { filterHookEnv } from "../HookCommandService.ts";
import type { HookCommandResult } from "../HookCommandService.ts";
import {
  appendTranscript,
  clampHookRunTimeout,
  containingRoot,
  hookEnvironment,
  readHooksConfig,
  runHookCommand,
} from "./WorkspaceHooks.ts";
import type { HookRunResult, HooksConfig } from "./WorkspaceHooks.ts";

type Refusal = { error: string };

/**
 * Route a workspace path: the bridge serving it, or — when the path belongs
 * to a bridge that is offline — a refusal (running it here would be the
 * wrong machine), or null for a path this service holds itself.
 */
function routeOrRefuse(
  path: string,
  capability: string,
  what: string,
): { agent: { id: string; name: string } | null } | Refusal {
  const agent = resolveAndRouteToAgent(path, ALLOWED_ROOTS[0]);
  if (agent) {
    if (!agent.capabilities.includes(capability)) {
      return { error: `The workspace agent "${agent.name}" serving ${path} cannot run ${what} — it needs an update.` };
    }
    return { agent };
  }
  const offlineRoot = offlineRemoteRootForPath(path, ALLOWED_ROOTS[0]);
  if (offlineRoot) {
    return { error: `The workspace agent serving '${offlineRoot}' is offline, so ${what} did NOT run (running it on the server would be the wrong machine). Reconnect the workspace agent and retry.` };
  }
  return { agent: null };
}

/** A local directory under this service's allowed roots, or a refusal. */
function localDirectory(path: string, field: string): { directory: string } | Refusal {
  const validation = validatePath(path);
  if (!validation.safe) return { error: `Invalid '${field}': ${validation.error}` };
  let isDirectory = false;
  try {
    isDirectory = statSync(validation.resolved).isDirectory();
  } catch {
    // Missing
  }
  if (!isDirectory) return { error: `'${field}' is not a directory: ${validation.resolved}` };
  return { directory: validation.resolved };
}

function toHookCommandResult(result: HookRunResult): HookCommandResult {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    durationMilliseconds: result.durationMs,
    ...(result.error && { error: result.error }),
  };
}

/**
 * One workspace hook command, in `cwd` (the directory holding `.prism`), with
 * `PRISM_PROJECT_DIR=<cwd>` and the caller's `PRISM_HOOK_*` variables.
 */
export async function executeWorkspaceHookCommand(
  command: string,
  {
    cwd,
    stdin,
    timeoutMilliseconds,
    env,
    signal,
  }: {
    cwd: string;
    stdin?: string;
    timeoutMilliseconds?: unknown;
    env?: Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<HookCommandResult | Refusal> {
  if (!isAbsolute(cwd)) return { error: "'cwd' must be an absolute path" };
  const timeoutMs = clampHookRunTimeout(timeoutMilliseconds);
  const hookVariables = { ...filterHookEnv(env), PRISM_PROJECT_DIR: cwd };

  const route = routeOrRefuse(cwd, "hooks", "this hook");
  if ("error" in route) return route;
  if (route.agent) {
    try {
      const result = (await sendRpc(route.agent.id, "hook.run", {
        command,
        cwd,
        stdin: stdin ?? "",
        env: hookVariables,
        timeoutMs,
      })) as HookRunResult;
      return toHookCommandResult(result);
    } catch (error: unknown) {
      return { error: `Agent RPC failed: ${errorMessage(error)}` };
    }
  }

  const local = localDirectory(cwd, "cwd");
  if ("error" in local) return local;
  return toHookCommandResult(
    await runHookCommand(
      {
        command,
        cwd: local.directory,
        stdin: stdin ?? "",
        // This service's environment is full of credentials: the command allowlist
        env: hookEnvironment(buildCommandEnv(), hookVariables),
        timeoutMs,
      },
      signal,
    ),
  );
}

/** The hooks files that apply to `root`: the nearest project file and the user's. */
export async function getWorkspaceHooksConfig(root: string): Promise<HooksConfig | Refusal> {
  if (!isAbsolute(root)) return { error: "'root' must be an absolute path" };
  const route = routeOrRefuse(root, "hooks", "a hooks lookup");
  if ("error" in route) return route;
  if (route.agent) {
    try {
      return (await sendRpc(route.agent.id, "hooks.config", { root })) as HooksConfig;
    } catch (error: unknown) {
      return { error: `Agent RPC failed: ${errorMessage(error)}` };
    }
  }

  const local = localDirectory(root, "root");
  if ("error" in local) return local;
  return readHooksConfig(local.directory, containingRoot(local.directory, ALLOWED_ROOTS) ?? local.directory, homedir());
}

/**
 * Claude Code-shaped transcript lines, appended where the hooks that read
 * them run: on the bridge serving `root`, or here.
 */
export async function appendWorkspaceTranscript(
  conversationId: string,
  lines: unknown,
  root: unknown,
): Promise<{ path: string } | Refusal> {
  if (typeof root === "string" && root.trim()) {
    if (!isAbsolute(root)) return { error: "'root' must be an absolute path" };
    const route = routeOrRefuse(root, "transcripts", "a transcript append");
    if ("error" in route) return route;
    if (route.agent) {
      try {
        return (await sendRpc(route.agent.id, "transcript.append", { conversationId, lines })) as { path: string };
      } catch (error: unknown) {
        return { error: `Agent RPC failed: ${errorMessage(error)}` };
      }
    }
  }
  try {
    return appendTranscript(conversationId, lines);
  } catch (error: unknown) {
    return { error: errorMessage(error) };
  }
}
