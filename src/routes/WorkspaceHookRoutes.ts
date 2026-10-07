import express from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import {
  appendWorkspaceTranscript,
  getWorkspaceHooksConfig,
} from "../services/tasks/WorkspaceHookService.ts";

/**
 * A repository's own hooks, for prism-service (mounted at /agentic):
 *
 *   GET  /hooks/config?root=<abs>
 *        → { project: {path, dir, exists, content, sha256} | null, user: … | null }:
 *          the nearest `.prism/hooks.json` at or above `root` (never above the
 *          registered root holding it) and `~/.prism/hooks.json` — from the
 *          workspace bridge serving `root`, or computed here.
 *   POST /transcripts/:conversationId/append   body { lines, root }
 *        → { path }: Claude Code-shaped JSONL for hooks that read
 *          `transcript_path`, appended on the bridge serving `root` (or here).
 *
 * The hook commands themselves run through POST /agentic/hook-command/run
 * with `{ workspace: true, cwd }` (HookCommandRoutes.ts).
 */
const router = express.Router();

router.get(
  "/hooks/config",
  asyncHandler(async (req: Request, res: Response) => {
    const root = typeof req.query.root === "string" ? req.query.root : "";
    if (!root) return res.status(400).json({ error: "Query parameter 'root' (an absolute path) is required" });
    const result = await getWorkspaceHooksConfig(root);
    if ("error" in result) return res.status(400).json(result);
    res.json(result);
  }),
);

router.post(
  "/transcripts/:conversationId/append",
  asyncHandler(async (req: Request, res: Response) => {
    const { lines, root } = req.body ?? {};
    const result = await appendWorkspaceTranscript(String(req.params.conversationId), lines, root);
    if ("error" in result) return res.status(400).json(result);
    res.json(result);
  }),
);

export default router;
