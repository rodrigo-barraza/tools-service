import express from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import {
  HOOK_COMMAND_MAX_COMMAND_CHARS,
  HOOK_COMMAND_MAX_STDIN_CHARS,
} from "../constants.ts";
import { executeHookCommand } from "../services/HookCommandService.ts";
import { executeWorkspaceHookCommand } from "../services/tasks/WorkspaceHookService.ts";

/**
 * POST /agentic/hook-command/run — prism-service's `command` hook handler.
 *
 * Body: { command, owner, stdin?, timeoutMilliseconds?, env? }
 *   - `owner`  the username the hook belongs to; selects its hooks directory
 *              (the command's working directory).
 *   - `stdin`  the hook payload JSON, written to the command's stdin.
 *   - `env`    only `PRISM_HOOK_*` string variables are passed through.
 *
 * With `{ workspace: true, cwd }` it is a repository's own hook (its
 * `.prism/hooks.json`; `cwd` is the directory holding `.prism`): it runs IN
 * `cwd`, on the workspace bridge serving it (or here when none does), with
 * `PRISM_PROJECT_DIR=<cwd>` plus the `PRISM_HOOK_*` variables, for up to 600 s.
 * `owner` is not needed then.
 *
 * 200: { exitCode, stdout, stderr, timedOut, durationMilliseconds } — a
 * non-zero exit or a timeout is still a 200: the request worked, the verdict
 * is in the fields. 400: a malformed request, or a workspace hook that could
 * not be run (its agent offline, `cwd` outside the workspace).
 */
const router = express.Router();

router.post(
  "/run",
  asyncHandler(async (req: Request, res: Response) => {
    const { command, owner, stdin, timeoutMilliseconds, env, workspace, cwd } = req.body ?? {};
    if (typeof command !== "string" || !command.trim()) {
      return res.status(400).json({ error: "Request body must include 'command' (string)" });
    }
    if (command.length > HOOK_COMMAND_MAX_COMMAND_CHARS) {
      return res.status(400).json({ error: `'command' is limited to ${HOOK_COMMAND_MAX_COMMAND_CHARS} characters` });
    }
    if (workspace !== undefined && typeof workspace !== "boolean") {
      return res.status(400).json({ error: "'workspace' must be a boolean" });
    }
    if (workspace) {
      if (typeof cwd !== "string" || !cwd.trim()) {
        return res.status(400).json({ error: "A workspace hook needs 'cwd' (the absolute directory holding .prism)" });
      }
    } else if (typeof owner !== "string" || !owner.trim()) {
      return res.status(400).json({ error: "Request body must include 'owner' (string)" });
    }
    if (stdin !== undefined && typeof stdin !== "string") {
      return res.status(400).json({ error: "'stdin' must be a string" });
    }
    if (typeof stdin === "string" && stdin.length > HOOK_COMMAND_MAX_STDIN_CHARS) {
      return res.status(400).json({ error: `'stdin' is limited to ${HOOK_COMMAND_MAX_STDIN_CHARS} characters` });
    }
    if (env !== undefined && (typeof env !== "object" || env === null || Array.isArray(env))) {
      return res.status(400).json({ error: "'env' must be an object" });
    }

    // The caller going away (prism's own hook deadline) kills the command.
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    if (workspace) {
      const result = await executeWorkspaceHookCommand(command, {
        cwd: cwd.trim(),
        stdin,
        timeoutMilliseconds,
        env,
        signal: abortController.signal,
      });
      if (res.headersSent || res.writableEnded) return;
      if (!("exitCode" in result)) return res.status(400).json(result);
      return res.json(result);
    }

    const result = await executeHookCommand(command, {
      owner: owner.trim(),
      stdin,
      timeoutMilliseconds,
      env,
      signal: abortController.signal,
    });
    if (res.headersSent || res.writableEnded) return;
    res.json(result);
  }),
);

export default router;
