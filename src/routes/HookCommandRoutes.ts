import express from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import {
  HOOK_COMMAND_MAX_COMMAND_CHARS,
  HOOK_COMMAND_MAX_STDIN_CHARS,
} from "../constants.ts";
import { executeHookCommand } from "../services/HookCommandService.ts";

/**
 * POST /agentic/hook-command/run — prism-service's `command` hook handler.
 *
 * Body: { command, owner, stdin?, timeoutMilliseconds?, env? }
 *   - `owner`  the username the hook belongs to; selects its hooks directory
 *              (the command's working directory).
 *   - `stdin`  the hook payload JSON, written to the command's stdin.
 *   - `env`    only `PRISM_HOOK_*` string variables are passed through.
 *
 * 200: { exitCode, stdout, stderr, timedOut, durationMilliseconds } — a
 * non-zero exit or a timeout is still a 200: the request worked, the verdict
 * is in the fields. 400: a malformed request.
 */
const router = express.Router();

router.post(
  "/run",
  asyncHandler(async (req: Request, res: Response) => {
    const { command, owner, stdin, timeoutMilliseconds, env } = req.body ?? {};
    if (typeof command !== "string" || !command.trim()) {
      return res.status(400).json({ error: "Request body must include 'command' (string)" });
    }
    if (command.length > HOOK_COMMAND_MAX_COMMAND_CHARS) {
      return res.status(400).json({ error: `'command' is limited to ${HOOK_COMMAND_MAX_COMMAND_CHARS} characters` });
    }
    if (typeof owner !== "string" || !owner.trim()) {
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
