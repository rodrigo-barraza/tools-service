import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createAuthMiddleware } from "@rodrigo-barraza/utilities-library/service";
import { DEFAULT_USERNAME } from "@rodrigo-barraza/utilities-library/taxonomy";
import { ALLOWED_ROOTS } from "../src/services/AgenticFileService.ts";
import { rpcTimeoutFor } from "../src/services/AgentConnectionManager.ts";
import { TASK_STREAM_TIMING } from "../src/services/tasks/WorkspaceTaskService.ts";
import { connectBridge, readEvents, sleep, startServer } from "./fakeWorkspaceBridge.ts";
import type { FakeBridge, RpcAnswer } from "./fakeWorkspaceBridge.ts";

/**
 * /agentic/tasks — routing a task to the workspace bridge that serves its
 * cwd (or running it here), the SSE stream (replay after=, live, the end
 * right after the exit, 404), the view surviving a bridge that leaves
 * (synthetic `lost`) or comes back (task.list + task.events back-fill), and
 * the background command and streaming paths that ride on the same socket.
 * A real server, a real socket, a scripted bridge.
 */

let baseUrl: string;
let wsUrl: string;
let server: import("node:http").Server;
let bridgeRoot: string;
let auxRoot: string;
let localRoot: string;
const bridges: FakeBridge[] = [];

async function bridgeWith(answers: Record<string, RpcAnswer>, options: { agentId?: string } = {}) {
  const bridge = await connectBridge(wsUrl, {
    roots: [bridgeRoot],
    auxRoots: [auxRoot],
    answers: new Map(Object.entries(answers)),
    ...options,
  });
  bridges.push(bridge);
  return bridge;
}

const startAnswer = (taskId: string): RpcAnswer => () => ({
  taskId,
  kind: taskId.startsWith("monitor-") ? "monitor" : "shell",
  pid: 4242,
  outputFile: join(auxRoot, "tasks", `${taskId}.output`),
  startedAt: new Date().toISOString(),
  timeoutMs: taskId.startsWith("monitor-") ? 300_000 : null,
});

const event = (taskId: string, seq: number, lines: string[]) => ({ taskId, seq, lines, at: new Date().toISOString() });
const exit = (taskId: string, seq: number, status = "completed", eventCount = 0) => ({
  taskId,
  seq,
  kind: taskId.startsWith("monitor-") ? "monitor" : "shell",
  status,
  exitCode: status === "completed" ? 0 : null,
  signal: null,
  eventCount,
  durationMs: 5,
  outputFile: join(auxRoot, "tasks", `${taskId}.output`),
  outputTail: "",
  at: new Date().toISOString(),
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  TASK_STREAM_TIMING.bootGraceMs = 0;
  TASK_STREAM_TIMING.lostAfterMs = 400;
  TASK_STREAM_TIMING.gapWaitMs = 1_000;

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "workspace-tasks-test-")));
  bridgeRoot = join(scratch, "bridge-workspace");
  auxRoot = join(scratch, "bridge-aux");
  localRoot = join(scratch, "local-workspace");
  for (const directory of [bridgeRoot, auxRoot, localRoot]) mkdirSync(directory, { recursive: true });
  if (!ALLOWED_ROOTS.includes(localRoot)) ALLOWED_ROOTS.push(localRoot);

  const { default: taskRoutes } = await import("../src/routes/WorkspaceTaskRoutes.ts");
  const { default: agenticRoutes } = await import("../src/routes/AgenticRoutes.ts");
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware({ defaultUsername: DEFAULT_USERNAME, traceContext: true }));
  app.use("/agentic/tasks", taskRoutes);
  app.use("/agentic", agenticRoutes);
  ({ server, baseUrl, wsUrl } = await startServer(app));
  return () => rmSync(scratch, { recursive: true, force: true });
});

afterAll(async () => {
  await Promise.all(bridges.map((bridge) => bridge.close()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /agentic/tasks — routing by cwd", () => {
  it("sends a task whose cwd a bridge serves to that bridge, with the owner, and answers with its location", async () => {
    const bridge = await bridgeWith({ "task.start": startAnswer("monitor-aaaaaaaa") });
    const response = await post(
      "/agentic/tasks",
      { kind: "monitor", command: "tail -f build.log | grep --line-buffered ERROR", cwd: join(bridgeRoot, "src"), description: "errors in build.log" },
      { "x-username": "rodrigo", "x-conversation-id": "conversation-7", "x-project": "prism-test" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      taskId: "monitor-aaaaaaaa",
      kind: "monitor",
      pid: 4242,
      timeoutMs: 300_000,
      location: "agent:fake-bridge",
    });
    const start = bridge.requests.find((request) => request.method === "task.start")!;
    expect(start.params).toMatchObject({
      kind: "monitor",
      cwd: join(bridgeRoot, "src"),
      description: "errors in build.log",
      owner: { conversationId: "conversation-7", project: "prism-test", username: "rodrigo" },
    });
    await bridge.close();
  });

  it("runs a task here when no bridge serves its cwd — and its output file reads through /agentic/file/read", async () => {
    const response = await post("/agentic/tasks", { kind: "shell", command: "echo local-output", cwd: localRoot });
    const started = (await response.json()) as { taskId: string; outputFile: string; location: string };
    expect(response.status).toBe(200);
    expect(started.location).toBe("local");
    expect(started.taskId).toMatch(/^shell-[0-9a-z]{8}$/);

    const { frames, ended } = await readEvents(`${baseUrl}/agentic/tasks/${started.taskId}/events`);
    expect(ended).toBe(true);
    expect(frames.at(-1)).toMatchObject({ method: "task.exit", params: { status: "completed", exitCode: 0 } });

    const read = await post("/agentic/file/read", { absolutePath: started.outputFile });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { content: string }).content).toContain("local-output");
    // …and never written through the file tools
    const write = await post("/agentic/file/write", { path: started.outputFile, content: "tampered" });
    expect(write.status).not.toBe(200);
  });

  it("refuses a command task without a cwd", async () => {
    const response = await post("/agentic/tasks", { kind: "shell", command: "true" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("'cwd' is required");
  });
});

describe("GET /agentic/tasks/:taskId/events — the SSE stream", () => {
  it("replays what came after `after`, streams the rest live, and ends right after the exit", async () => {
    const bridge = await bridgeWith({ "task.start": startAnswer("monitor-bbbbbbbb") });
    await post("/agentic/tasks", { kind: "monitor", command: "watch", cwd: bridgeRoot });
    bridge.notify("task.event", event("monitor-bbbbbbbb", 1, ["first"]));
    bridge.notify("task.event", event("monitor-bbbbbbbb", 2, ["second"]));
    await sleep(100);

    const reading = readEvents(`${baseUrl}/agentic/tasks/monitor-bbbbbbbb/events?after=1`);
    await sleep(200);
    bridge.notify("task.event", event("monitor-bbbbbbbb", 3, ["third", "fourth"]));
    bridge.notify("task.exit", exit("monitor-bbbbbbbb", 4, "exited", 4));
    const { frames, ended } = await reading;

    expect(ended).toBe(true);
    expect(frames.map((frame) => [frame.method, frame.params.seq])).toEqual([
      ["task.event", 2],
      ["task.event", 3],
      ["task.exit", 4],
    ]);
    expect(frames[1].params.lines).toEqual(["third", "fourth"]);

    // A listener that already has the exit gets an empty stream that ends at once
    const again = await readEvents(`${baseUrl}/agentic/tasks/monitor-bbbbbbbb/events?after=4`);
    expect(again).toMatchObject({ status: 200, frames: [], ended: true });
    await bridge.close();
  });

  it("is a 404 JSON for a task nobody knows", async () => {
    for (const taskId of ["shell-zzzzzzzz", "not-a-task-id"]) {
      const response = await fetch(`${baseUrl}/agentic/tasks/${taskId}/events`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: `Unknown task: ${taskId}` });
    }
  });

  it("holds a notification that arrives ahead of a gap and back-fills the gap from the bridge (task.events)", async () => {
    const taskId = "monitor-cccccccc";
    const bridge = await bridgeWith({
      "task.start": startAnswer(taskId),
      "task.events": (params) => ({
        status: "running",
        notifications: [
          { method: "task.event", params: event(taskId, 1, ["one"]) },
          { method: "task.event", params: event(taskId, 2, ["two"]) },
        ].filter((notification) => notification.params.seq > Number(params.afterSeq)),
      }),
    });
    await post("/agentic/tasks", { kind: "monitor", command: "watch", cwd: bridgeRoot });
    const reading = readEvents(`${baseUrl}/agentic/tasks/${taskId}/events`);
    await sleep(150);
    // seq 1 never arrives live
    bridge.notify("task.event", event(taskId, 2, ["two"]));
    await sleep(150);
    bridge.notify("task.exit", exit(taskId, 3, "exited", 2));
    const { frames } = await reading;
    expect(frames.map((frame) => frame.params.seq)).toEqual([1, 2, 3]);
    expect(bridge.requests.some((request) => request.method === "task.events" && request.params.afterSeq === 0)).toBe(true);
    await bridge.close();
  });

  it("ends with a synthetic `lost` exit when the bridge leaves and does not come back", async () => {
    const taskId = "shell-dddddddd";
    const bridge = await bridgeWith({ "task.start": startAnswer(taskId) });
    await post("/agentic/tasks", { kind: "shell", command: "make", cwd: bridgeRoot });
    bridge.notify("task.event", event(taskId, 1, ["progress"]));
    const reading = readEvents(`${baseUrl}/agentic/tasks/${taskId}/events`);
    await sleep(150);
    await bridge.close();

    const { frames, ended } = await reading;
    expect(ended).toBe(true);
    expect(frames.at(-1)).toMatchObject({ method: "task.exit", params: { taskId, seq: 2, status: "lost" } });

    const stop = await post(`/agentic/tasks/${taskId}/stop`, {});
    expect(await stop.json()).toEqual({ stopped: false, status: "lost" });
  });

  it("a bridge that comes back in time is re-read (task.list) and back-filled (task.events) — no `lost`", async () => {
    TASK_STREAM_TIMING.lostAfterMs = 3_000;
    const taskId = "shell-eeeeeeee";
    const agentId = "fixed-agent-id";
    const first = await bridgeWith({ "task.start": startAnswer(taskId) }, { agentId });
    await post("/agentic/tasks", { kind: "shell", command: "make", cwd: bridgeRoot });
    const reading = readEvents(`${baseUrl}/agentic/tasks/${taskId}/events`);
    await sleep(150);
    await first.close();

    // While it was away the task printed and finished; the bridge kept both
    const missed = [
      { method: "task.event", params: event(taskId, 1, ["built"]) },
      { method: "task.exit", params: exit(taskId, 2, "completed", 1) },
    ];
    const second = await bridgeWith(
      {
        "task.list": () => [
          {
            taskId,
            kind: "shell",
            status: "completed",
            command: "make",
            cwd: bridgeRoot,
            description: "",
            owner: {},
            pid: 4242,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            exitCode: 0,
            eventCount: 1,
            outputFile: join(auxRoot, "tasks", `${taskId}.output`),
            lastSeq: 2,
          },
        ],
        "task.events": (params) => ({
          status: "completed",
          notifications: missed.filter((notification) => notification.params.seq > Number(params.afterSeq)),
        }),
      },
      { agentId },
    );

    const { frames, ended } = await reading;
    expect(ended).toBe(true);
    expect(frames.map((frame) => [frame.method, frame.params.seq, frame.params.status])).toEqual([
      ["task.event", 1, undefined],
      ["task.exit", 2, "completed"],
    ]);
    TASK_STREAM_TIMING.lostAfterMs = 400;
    await second.close();
  });
});

describe("stop and list", () => {
  it("POST /:taskId/stop goes to the bridge running it; GET / lists every bridge's tasks and the local ones", async () => {
    const taskId = "monitor-ffffffff";
    const bridge = await bridgeWith({
      "task.start": startAnswer(taskId),
      "task.stop": (params) => ({ stopped: params.taskId === taskId, status: "killed" }),
      "task.list": () => [
        {
          taskId,
          kind: "monitor",
          status: "running",
          command: "watch",
          cwd: bridgeRoot,
          description: "on the bridge",
          owner: {},
          pid: 4242,
          startedAt: new Date().toISOString(),
          eventCount: 0,
          outputFile: join(auxRoot, "tasks", `${taskId}.output`),
          lastSeq: 0,
        },
      ],
    });
    await post("/agentic/tasks", { kind: "monitor", command: "watch", cwd: bridgeRoot });
    const local = (await (await post("/agentic/tasks", { kind: "monitor", command: "sleep 30", cwd: localRoot })).json()) as { taskId: string };

    const stop = await post(`/agentic/tasks/${taskId}/stop`, {});
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ stopped: true, status: "killed" });

    const listed = (await (await fetch(`${baseUrl}/agentic/tasks`)).json()) as Array<{ taskId: string; location: string; status: string }>;
    expect(listed.find((entry) => entry.taskId === taskId)).toMatchObject({ location: "agent:fake-bridge", status: "running" });
    expect(listed.find((entry) => entry.taskId === local.taskId)).toMatchObject({ location: "local", status: "running" });

    const localStop = await post(`/agentic/tasks/${local.taskId}/stop`, {});
    expect(await localStop.json()).toEqual({ stopped: true, status: "killed" });
    expect((await post("/agentic/tasks/shell-zzzzzzzz/stop", {})).status).toBe(404);
    await bridge.close();
  });
});

describe("execute_command through the bridge", () => {
  it("run_in_background: the bridge's shell task is adopted — its events stream from /agentic/tasks", async () => {
    const taskId = "shell-gggggggg";
    const outputFile = join(auxRoot, "tasks", `${taskId}.output`);
    const bridge = await bridgeWith({
      "command.run": () => ({
        success: true,
        backgrounded: true,
        taskId,
        outputFile,
        pid: 77,
        stdout: "",
        stderr: "",
        exitCode: null,
        executionTimeMs: 0,
        message: `Command running in background with ID: ${taskId}. Output is being written to: ${outputFile}`,
      }),
    });
    const response = await post("/agentic/command/run", {
      command: "npm run build",
      cwd: bridgeRoot,
      run_in_background: true,
      description: "Build the client",
    });
    expect(await response.json()).toMatchObject({ backgrounded: true, taskId, outputFile });
    const run = bridge.requests.find((request) => request.method === "command.run")!;
    expect(run.params).toMatchObject({ runInBackground: true, description: "Build the client", timeout: 120_000 });

    const reading = readEvents(`${baseUrl}/agentic/tasks/${taskId}/events`);
    await sleep(150);
    bridge.notify("task.exit", exit(taskId, 1));
    const { frames } = await reading;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ method: "task.exit", params: { status: "completed" } });
    await bridge.close();
  });

  it("command.stream output reaches only the request it names (requestId), so concurrent streams never cross", async () => {
    const bridge = await bridgeWith({
      "command.stream": async (_params, id) => {
        bridge.notify("command.stdout", { data: "for someone else\n", requestId: "another-request" });
        bridge.notify("command.stdout", { data: "mine\n", requestId: id });
        await sleep(50);
        return { success: true, stdout: "mine\n", stderr: "", exitCode: 0, executionTimeMs: 3 };
      },
    });
    const response = await post("/agentic/command/stream", { command: "echo mine", cwd: bridgeRoot });
    const text = await response.text();
    expect(text).toContain('"data":"mine\\n"');
    expect(text).not.toContain("for someone else");
    await bridge.close();
  });

  it("reads under a bridge's aux root go to the bridge; writes there never do", async () => {
    const bridge = await bridgeWith({
      "file.read": (params) => ({ filePath: params.path, content: "1: from the bridge", totalLines: 1 }),
      "file.write": () => ({ error: "must never be asked" }),
    });
    const outputFile = join(auxRoot, "tasks", "shell-hhhhhhhh.output");
    const read = await post("/agentic/file/read", { absolutePath: outputFile });
    expect(await read.json()).toMatchObject({ content: "1: from the bridge" });

    const write = await post("/agentic/file/write", { path: outputFile, content: "x" });
    expect(write.status).not.toBe(200);
    expect(bridge.requests.some((request) => request.method === "file.write")).toBe(false);
    await bridge.close();
  });
});

describe("RPC timeouts are per call", () => {
  it("a command waits its own timeout + 15 s; a hook its own + 5 s; task.* 15 s", () => {
    expect(rpcTimeoutFor("command.run", {})).toBe(135_000);
    expect(rpcTimeoutFor("command.run", { timeout: 600_000 })).toBe(615_000);
    expect(rpcTimeoutFor("command.stream", { timeout: 10_000 })).toBe(25_000);
    expect(rpcTimeoutFor("command.run", { timeout: 99_999_999 })).toBe(615_000);
    expect(rpcTimeoutFor("hook.run", { timeoutMs: 30_000 })).toBe(35_000);
    expect(rpcTimeoutFor("hook.run", {})).toBe(65_000);
    for (const method of ["task.start", "task.stop", "task.list", "task.events"]) {
      expect(rpcTimeoutFor(method, {})).toBe(15_000);
    }
    expect(rpcTimeoutFor("file.read", {})).toBe(10_000);
  });
});
