// ─── Workspace Tasks — background shells and monitors ───────
//
// Claude Code's background Bash and Monitor, for Prism. A task runs where its
// `cwd` lives: on the workspace bridge serving that path (task.* JSON-RPC over
// /ws/agent) or, for a path no bridge serves, in this service's own
// TaskEngine — the very module the bridge runs. Either way its notifications
// land in one view, keyed by task id:
//
//   taskId → { location, the last 500 notifications, subscribers }
//
// GET /agentic/tasks/:id/events replays what a listener has not seen and
// streams the rest. A bridge that registers (again) is re-read with
// task.list and its missed notifications back-filled with task.events; one
// that stays away for 60 s takes its running tasks with it — a synthetic
// `lost` exit.

import { EventEmitter } from "node:events";
import { requestLocalStorage } from "@rodrigo-barraza/utilities-library/service";
import logger from "../../logger.ts";
import { errorMessage } from "../../utilities.ts";
import { ALLOWED_ROOTS, validatePath } from "../AgenticFileService.ts";
import {
  agentEvents,
  getAgentSummary,
  listAgentSummaries,
  offlineRemoteRootForPath,
  resolveAndRouteToAgent,
  resolveWorkspaceTargetPath,
  sendRpc,
} from "../AgentConnectionManager.ts";
import { buildCommandEnv } from "../AgenticCommandService.ts";
import {
  FINISHED_TASK_TTL_MS,
  NOTIFICATION_BUFFER_SIZE,
  TASK_ID_PATTERN,
  TaskEngine,
} from "./TaskEngine.ts";
import type {
  TaskEventParams,
  TaskExitParams,
  TaskKind,
  TaskListEntry,
  TaskNotification,
  TaskOwner,
  TaskStartParams,
  TaskStartResult,
  TaskStatus,
  TaskStopResult,
} from "./TaskEngine.ts";

/** `lost`: the bridge running it went away and did not come back. */
export type TaskViewStatus = TaskStatus | "lost";

/** What a listener receives: the engine's notifications, plus a synthetic `lost` exit. */
export type TaskStreamNotification =
  | { method: "task.event"; params: TaskEventParams }
  | { method: "task.exit"; params: Omit<TaskExitParams, "status"> & { status: TaskExitParams["status"] | "lost" } };

export type TaskSummary = Omit<TaskListEntry, "status"> & { status: TaskViewStatus; location: string };

interface TaskView {
  taskId: string;
  kind: TaskKind;
  /** "agent:<name>" or "local" */
  location: string;
  agentId: string | null;
  status: TaskViewStatus;
  command?: string;
  wsUrl?: string;
  cwd: string;
  description: string;
  owner: TaskOwner;
  pid: number | null;
  outputFile: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  eventCount: number;
  lastSeq: number;
  buffer: TaskStreamNotification[];
  /** Arrived ahead of a gap, waiting for it to fill */
  pending: Map<number, TaskStreamNotification>;
  gapTimer: ReturnType<typeof setTimeout> | null;
  backfilling: boolean;
  lostTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Set<(notification: TaskStreamNotification) => void>;
}

/** Timings — mutable so tests can shorten them. */
export const TASK_STREAM_TIMING = {
  /** A bridge that stays away this long loses its running tasks. */
  lostAfterMs: 60_000,
  /** Right after this service starts, an unknown task id waits this long for its bridge. */
  bootGraceMs: 60_000,
  /** SSE keep-alive comment interval. */
  pingIntervalMs: 15_000,
  /** How long a notification that arrived ahead of a gap waits for the gap to fill. */
  gapWaitMs: 5_000,
};

const LOCAL = "local";
const serviceStartedAt = Date.now();
const views = new Map<string, TaskView>();
/** "synced" after every bridge sync — wakes requests waiting for an unknown task. */
const syncEvents = new EventEmitter();
syncEvents.setMaxListeners(0);

export class TaskRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ────────────────────────────────────────────────────────────
// The local engine (paths no bridge serves)
// ────────────────────────────────────────────────────────────

let localEngine: TaskEngine | null = null;

function engine(): TaskEngine {
  localEngine ??= new TaskEngine({
    notify: (notification) => ingest(upsertView(notification.params.taskId, null, LOCAL), notification),
    env: () => buildCommandEnv(),
    log: (level, message) => logger[level](`[WorkspaceTasks] ${message}`),
  });
  return localEngine;
}

export function runningLocalTaskCount(): number {
  return localEngine?.runningCount() ?? 0;
}

/** Shutdown: stop every task this service runs itself. */
export function stopLocalTasks(): void {
  localEngine?.dispose();
}

// ────────────────────────────────────────────────────────────
// Starting
// ────────────────────────────────────────────────────────────

/** The owner the request names, else who is asking (the identity headers). */
export function ownerOf(owner: unknown): Record<string, unknown> {
  if (typeof owner === "object" && owner !== null && !Array.isArray(owner) && Object.keys(owner).length > 0) {
    return owner as Record<string, unknown>;
  }
  const store = requestLocalStorage.getStore();
  const fromIdentity: Record<string, unknown> = {};
  for (const key of ["conversationId", "project", "username"] as const) {
    const value = store?.[key];
    if (typeof value === "string" && value) fromIdentity[key] = value;
  }
  return fromIdentity;
}

/** `task.start` on the bridge that serves `cwd`, or here. */
export async function startTask(body: Record<string, unknown>): Promise<TaskStartResult & { location: string }> {
  const rawCwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  const cwd = rawCwd ? resolveWorkspaceTargetPath(rawCwd, ALLOWED_ROOTS[0]) : null;
  const isSocketMonitor = body.kind === "monitor" && body.ws !== undefined && body.ws !== null && body.command === undefined;
  if (!cwd && !isSocketMonitor) {
    throw new TaskRequestError(400, "'cwd' is required for a command task (an absolute path)");
  }
  const params: Record<string, unknown> = { ...body, owner: ownerOf(body.owner), ...(cwd ? { cwd } : {}) };

  if (cwd) {
    const agent = resolveAndRouteToAgent(cwd, ALLOWED_ROOTS[0]);
    if (agent) {
      if (!agent.capabilities.includes("tasks")) {
        throw new TaskRequestError(400, `The workspace agent "${agent.name}" serving ${cwd} cannot run background tasks — it needs an update.`);
      }
      let started: TaskStartResult;
      try {
        started = (await sendRpc(agent.id, "task.start", params)) as TaskStartResult;
      } catch (error: unknown) {
        throw new TaskRequestError(400, errorMessage(error));
      }
      const location = `agent:${agent.name}`;
      adopt(started, agent.id, location, params);
      return { ...started, location };
    }
    const offlineRoot = offlineRemoteRootForPath(cwd, ALLOWED_ROOTS[0]);
    if (offlineRoot) {
      throw new TaskRequestError(400, `The workspace agent serving '${offlineRoot}' is offline, so this task was NOT started (running it locally on the server would run it on the wrong machine). Reconnect the workspace agent and retry.`);
    }
    const validation = validatePath(cwd);
    if (!validation.safe) {
      throw new TaskRequestError(400, `Invalid working directory: ${validation.error}`);
    }
    params.cwd = validation.resolved;
  }

  let started: TaskStartResult;
  try {
    started = engine().start(params as unknown as TaskStartParams);
  } catch (error: unknown) {
    throw new TaskRequestError(400, errorMessage(error));
  }
  adopt(started, null, LOCAL, params);
  return { ...started, location: LOCAL };
}

/** execute_command with run_in_background, where no bridge serves the cwd. */
export function startLocalShell({ command, cwd, description, owner }: {
  command: string;
  cwd: string;
  description: string;
  owner: Record<string, unknown>;
}): TaskStartResult {
  const params = { kind: "shell" as const, command, cwd, description, owner };
  const started = engine().start(params);
  adopt(started, null, LOCAL, params);
  return started;
}

/** execute_command with run_in_background, run by a bridge: its events come here. */
export function adoptAgentShell(
  agent: { id: string; name: string },
  result: { taskId?: string; outputFile?: string; pid?: number | null },
  params: Record<string, unknown>,
): void {
  if (!result.taskId) return;
  adopt(
    {
      taskId: result.taskId,
      kind: "shell",
      pid: result.pid ?? null,
      outputFile: result.outputFile ?? "",
      startedAt: new Date().toISOString(),
      timeoutMs: null,
    },
    agent.id,
    `agent:${agent.name}`,
    params,
  );
}

function adopt(started: TaskStartResult, agentId: string | null, location: string, params: Record<string, unknown>): void {
  const view = upsertView(started.taskId, agentId, location);
  view.kind = started.kind;
  view.pid = started.pid;
  view.outputFile = started.outputFile;
  view.startedAt = started.startedAt;
  if (typeof params.command === "string") view.command = params.command;
  const socket = params.ws as { url?: unknown } | undefined;
  if (typeof socket?.url === "string") view.wsUrl = socket.url;
  if (typeof params.cwd === "string") view.cwd = params.cwd;
  if (typeof params.description === "string") view.description = params.description.trim();
  view.owner = stringEntries(params.owner);
}

function stringEntries(value: unknown): TaskOwner {
  const entries: TaskOwner = {};
  if (typeof value !== "object" || value === null) return entries;
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") entries[key] = entry;
  return entries;
}

// ────────────────────────────────────────────────────────────
// The view
// ────────────────────────────────────────────────────────────

function upsertView(taskId: string, agentId: string | null, location: string): TaskView {
  let view = views.get(taskId);
  if (!view) {
    view = {
      taskId,
      kind: taskId.startsWith("monitor-") ? "monitor" : "shell",
      location,
      agentId,
      status: "running",
      cwd: "",
      description: "",
      owner: {},
      pid: null,
      outputFile: "",
      startedAt: new Date().toISOString(),
      eventCount: 0,
      lastSeq: 0,
      buffer: [],
      pending: new Map(),
      gapTimer: null,
      backfilling: false,
      lostTimer: null,
      subscribers: new Set(),
    };
    views.set(taskId, view);
  }
  view.agentId = agentId;
  view.location = location;
  return view;
}

function fromListEntry(view: TaskView, entry: TaskListEntry): void {
  view.kind = entry.kind;
  view.pid = entry.pid;
  view.outputFile = entry.outputFile;
  view.startedAt = entry.startedAt;
  view.cwd = entry.cwd;
  view.description = entry.description;
  view.owner = entry.owner ?? {};
  if (entry.command !== undefined) view.command = entry.command;
  if (entry.wsUrl !== undefined) view.wsUrl = entry.wsUrl;
}

/**
 * Take a notification in seq order. One that arrives ahead of a gap waits
 * (the bridge keeps the last 500, so a back-fill fetches what is missing);
 * after `gapWaitMs` it is applied anyway.
 */
function ingest(view: TaskView, notification: TaskStreamNotification): void {
  const seq = notification.params.seq;
  if (!Number.isInteger(seq) || seq <= view.lastSeq || view.status !== "running") return;
  view.pending.set(seq, notification);
  drainPending(view);
  if (view.pending.size === 0) return;
  if (view.agentId && !view.backfilling) void backfill(view);
  view.gapTimer ??= setTimeout(() => flushPending(view), TASK_STREAM_TIMING.gapWaitMs);
}

function drainPending(view: TaskView): void {
  for (let next = view.pending.get(view.lastSeq + 1); next; next = view.pending.get(view.lastSeq + 1)) {
    view.pending.delete(view.lastSeq + 1);
    apply(view, next);
  }
  if (view.pending.size === 0 && view.gapTimer) {
    clearTimeout(view.gapTimer);
    view.gapTimer = null;
  }
}

/** Apply whatever waits, in seq order, gaps and all. */
function flushPending(view: TaskView): void {
  if (view.gapTimer) clearTimeout(view.gapTimer);
  view.gapTimer = null;
  for (const seq of [...view.pending.keys()].sort((a, b) => a - b)) {
    const notification = view.pending.get(seq)!;
    view.pending.delete(seq);
    if (seq > view.lastSeq && view.status === "running") apply(view, notification);
  }
}

function apply(view: TaskView, notification: TaskStreamNotification): void {
  view.lastSeq = notification.params.seq;
  view.buffer.push(notification);
  if (view.buffer.length > NOTIFICATION_BUFFER_SIZE) view.buffer.shift();
  if (notification.method === "task.event") {
    view.eventCount += Array.isArray(notification.params.lines) ? notification.params.lines.length : 0;
  } else {
    const exit = notification.params;
    view.status = exit.status;
    view.exitCode = exit.exitCode;
    view.eventCount = exit.eventCount;
    view.endedAt = exit.at;
    if (view.lostTimer) clearTimeout(view.lostTimer);
    view.lostTimer = null;
    view.pending.clear();
    // Kept as long as the engine keeps a finished task
    setTimeout(() => {
      if (views.get(view.taskId) === view) views.delete(view.taskId);
    }, FINISHED_TASK_TTL_MS).unref();
  }
  for (const subscriber of [...view.subscribers]) subscriber(notification);
}

/** What the bridge still has after our last seq (task.events). */
async function backfill(view: TaskView): Promise<void> {
  if (!view.agentId || view.backfilling) return;
  view.backfilling = true;
  try {
    const result = (await sendRpc(view.agentId, "task.events", {
      taskId: view.taskId,
      afterSeq: view.lastSeq,
    })) as { notifications?: TaskNotification[]; error?: string };
    for (const notification of result.notifications ?? []) {
      if (notification.params.seq > view.lastSeq) view.pending.set(notification.params.seq, notification);
    }
  } catch (error: unknown) {
    logger.warn(`[WorkspaceTasks] Back-filling ${view.taskId} failed: ${errorMessage(error)}`);
  } finally {
    view.backfilling = false;
    // The bridge's answer is everything there is: apply it, gaps and all
    flushPending(view);
  }
}

/** The bridge running it is gone for good: a synthetic exit ends every stream. */
function markLost(view: TaskView): void {
  if (view.lostTimer) clearTimeout(view.lostTimer);
  view.lostTimer = null;
  flushPending(view);
  if (view.status !== "running") return;
  logger.warn(`[WorkspaceTasks] ${view.taskId} lost with its workspace agent (${view.location})`);
  apply(view, {
    method: "task.exit",
    params: {
      taskId: view.taskId,
      seq: view.lastSeq + 1,
      kind: view.kind,
      status: "lost",
      exitCode: null,
      signal: null,
      eventCount: view.eventCount,
      durationMs: Math.max(0, Date.now() - Date.parse(view.startedAt)),
      outputFile: view.outputFile,
      outputTail: "",
      at: new Date().toISOString(),
    },
  });
}

// ────────────────────────────────────────────────────────────
// Bridges coming and going
// ────────────────────────────────────────────────────────────

/** Re-read a bridge's tasks (task.list) and back-fill what we missed (task.events). */
async function syncAgent(agentId: string): Promise<void> {
  const agent = getAgentSummary(agentId);
  if (!agent || !agent.capabilities.includes("tasks")) return;
  let entries: TaskListEntry[];
  try {
    entries = (await sendRpc(agentId, "task.list", {})) as TaskListEntry[];
  } catch (error: unknown) {
    logger.warn(`[WorkspaceTasks] task.list on "${agent.name}" failed: ${errorMessage(error)}`);
    return;
  }
  const listed = new Set<string>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.taskId !== "string" || !TASK_ID_PATTERN.test(entry.taskId)) continue;
    listed.add(entry.taskId);
    const view = upsertView(entry.taskId, agentId, `agent:${agent.name}`);
    fromListEntry(view, entry);
    if (view.lostTimer) clearTimeout(view.lostTimer);
    view.lostTimer = null;
    if (entry.lastSeq > view.lastSeq) await backfill(view);
  }
  // This bridge no longer runs a task we thought it did: that process is gone
  for (const view of views.values()) {
    if (view.agentId === agentId && view.status === "running" && !listed.has(view.taskId)) markLost(view);
  }
  syncEvents.emit("synced");
}

agentEvents.on("registered", (agentId: string) => {
  void syncAgent(agentId);
});

agentEvents.on("deregistered", (agentId: string) => {
  for (const view of views.values()) {
    if (view.agentId !== agentId || view.status !== "running" || view.lostTimer) continue;
    view.lostTimer = setTimeout(() => markLost(view), TASK_STREAM_TIMING.lostAfterMs);
  }
});

agentEvents.on("task-notification", (agentId: string, notification: TaskNotification) => {
  const taskId = notification?.params?.taskId;
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) return;
  const agent = getAgentSummary(agentId);
  const view = upsertView(taskId, agentId, `agent:${agent?.name ?? agentId.slice(0, 8)}`);
  // Hearing from it means it is back
  if (view.lostTimer) clearTimeout(view.lostTimer);
  view.lostTimer = null;
  ingest(view, notification);
});

// ────────────────────────────────────────────────────────────
// Reading
// ────────────────────────────────────────────────────────────

/**
 * A task by id. One this service has not heard of may belong to a bridge
 * that has not re-registered since this service restarted: ask the connected
 * ones, and right after boot wait for the others to come back.
 */
export async function findTask(taskId: string): Promise<TaskView | null> {
  if (!TASK_ID_PATTERN.test(taskId)) return null;
  const known = views.get(taskId);
  if (known) return known;

  await Promise.all(
    listAgentSummaries()
      .filter((agent) => agent.capabilities.includes("tasks"))
      .map((agent) => syncAgent(agent.id)),
  );
  if (views.has(taskId)) return views.get(taskId)!;

  const graceLeft = TASK_STREAM_TIMING.bootGraceMs - (Date.now() - serviceStartedAt);
  if (graceLeft > 0) {
    await new Promise<void>((done) => {
      const check = () => {
        if (views.has(taskId)) finish();
      };
      const finish = () => {
        clearTimeout(timer);
        syncEvents.off("synced", check);
        done();
      };
      const timer = setTimeout(finish, graceLeft);
      syncEvents.on("synced", check);
    });
  }
  return views.get(taskId) ?? null;
}

/**
 * Listen to a task: the kept notifications after `afterSeq` (to send first),
 * then `listener` for each new one.
 */
export function subscribeTask(
  taskId: string,
  afterSeq: number,
  listener: (notification: TaskStreamNotification) => void,
): { replay: TaskStreamNotification[]; unsubscribe: () => void } | null {
  const view = views.get(taskId);
  if (!view) return null;
  const replay = view.buffer.filter((notification) => notification.params.seq > afterSeq);
  view.subscribers.add(listener);
  return { replay, unsubscribe: () => view.subscribers.delete(listener) };
}

function summaryOf(view: TaskView): TaskSummary {
  return {
    taskId: view.taskId,
    kind: view.kind,
    status: view.status,
    ...(view.command !== undefined && { command: view.command }),
    ...(view.wsUrl !== undefined && { wsUrl: view.wsUrl }),
    cwd: view.cwd,
    description: view.description,
    owner: view.owner,
    pid: view.pid,
    startedAt: view.startedAt,
    ...(view.endedAt !== undefined && { endedAt: view.endedAt, exitCode: view.exitCode }),
    eventCount: view.eventCount,
    outputFile: view.outputFile,
    lastSeq: view.lastSeq,
    location: view.location,
  };
}

/** Every task: each connected bridge's task.list, this service's own, and those whose bridge is away. */
export async function listTasks(): Promise<TaskSummary[]> {
  const summaries: TaskSummary[] = [];
  const answered = new Set<string>();
  await Promise.all(
    listAgentSummaries()
      .filter((agent) => agent.capabilities.includes("tasks"))
      .map(async (agent) => {
        try {
          const entries = (await sendRpc(agent.id, "task.list", {})) as TaskListEntry[];
          for (const entry of entries) summaries.push({ ...entry, location: `agent:${agent.name}` });
          answered.add(agent.id);
        } catch (error: unknown) {
          logger.warn(`[WorkspaceTasks] task.list on "${agent.name}" failed: ${errorMessage(error)}`);
        }
      }),
  );
  if (localEngine) {
    for (const entry of localEngine.list()) summaries.push({ ...entry, location: LOCAL });
  }
  for (const view of views.values()) {
    if (view.location !== LOCAL && !answered.has(view.agentId ?? "")) summaries.push(summaryOf(view));
  }
  return summaries;
}

/** task.stop where the task runs. */
export async function stopTask(taskId: string): Promise<{ status: number; body: TaskStopResult | { stopped: false; status: "lost" } }> {
  const view = await findTask(taskId);
  if (!view) return { status: 404, body: { stopped: false, error: `Unknown task: ${taskId}` } };
  if (view.location === LOCAL) return { status: 200, body: engine().stop(taskId) };
  if (view.status === "lost") return { status: 200, body: { stopped: false, status: "lost" } };
  if (view.status !== "running") return { status: 200, body: { stopped: false, status: view.status } };
  const agent = view.agentId ? getAgentSummary(view.agentId) : null;
  if (!agent) {
    return {
      status: 503,
      body: { stopped: false, error: `The workspace agent running ${taskId} (${view.location}) is offline, so it cannot be stopped now; it is reported lost if it does not come back within ${Math.round(TASK_STREAM_TIMING.lostAfterMs / 1000)}s.` },
    };
  }
  try {
    return { status: 200, body: (await sendRpc(agent.id, "task.stop", { taskId })) as TaskStopResult };
  } catch (error: unknown) {
    return { status: 502, body: { stopped: false, error: `Agent RPC failed: ${errorMessage(error)}` } };
  }
}
