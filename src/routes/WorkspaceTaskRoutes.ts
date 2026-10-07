import express from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import {
  TASK_STREAM_TIMING,
  TaskRequestError,
  findTask,
  listTasks,
  startTask,
  stopTask,
  subscribeTask,
} from "../services/tasks/WorkspaceTaskService.ts";
import type { TaskStreamNotification } from "../services/tasks/WorkspaceTaskService.ts";

/**
 * /agentic/tasks — background shells and monitors (Claude Code's background
 * Bash and Monitor), run by the workspace bridge serving `cwd` or, for a path
 * no bridge serves, by this service.
 *
 *   POST /                    body = task.start params → { taskId, kind, pid, outputFile,
 *                             startedAt, timeoutMs, location: "agent:<name>" | "local" }
 *   GET  /                    every task (each bridge's task.list + local), with `location`
 *   GET  /:taskId/events?after=<seq>
 *                             SSE: `data: {"method": "task.event"|"task.exit", "params": {…}}`
 *                             — the kept notifications with seq > after, then live ones; the
 *                             stream ENDS right after the exit. `: ping` every 15 s. 404 for an
 *                             unknown task.
 *   POST /:taskId/stop        → the task.stop result
 */
const router = express.Router();

router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return res.status(400).json({ error: "Request body must be the task.start params (an object)" });
    }
    try {
      res.json(await startTask(body as Record<string, unknown>));
    } catch (error: unknown) {
      if (error instanceof TaskRequestError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }),
);

router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await listTasks());
  }),
);

router.get(
  "/:taskId/events",
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const after = Number.parseInt(String(req.query.after ?? "0"), 10);
    const afterSeq = Number.isFinite(after) && after > 0 ? after : 0;

    const view = await findTask(taskId);
    if (!view) return res.status(404).json({ error: `Unknown task: ${taskId}` });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let subscription: ReturnType<typeof subscribeTask> = null;
    let ended = false;
    let lastSent = afterSeq;
    const ping = setInterval(() => res.write(": ping\n\n"), TASK_STREAM_TIMING.pingIntervalMs);
    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(ping);
      subscription?.unsubscribe();
      res.end();
    };
    const send = (notification: TaskStreamNotification) => {
      if (ended || notification.params.seq <= lastSent) return;
      lastSent = notification.params.seq;
      res.write(`data: ${JSON.stringify({ method: notification.method, params: notification.params })}\n\n`);
      if (notification.method === "task.exit") end();
    };

    res.on("close", end);
    subscription = subscribeTask(taskId, afterSeq, send);
    if (!subscription) return end();
    for (const notification of subscription.replay) send(notification);
    // Finished, and the listener already has its exit: nothing more will come
    if (view.status !== "running" && lastSent >= view.lastSeq) end();
  }),
);

router.post(
  "/:taskId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const { status, body } = await stopTask(String(req.params.taskId));
    res.status(status).json(body);
  }),
);

export default router;
