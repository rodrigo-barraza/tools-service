import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createAuthMiddleware } from "@rodrigo-barraza/utilities-library/service";
import { DEFAULT_USERNAME } from "@rodrigo-barraza/utilities-library/taxonomy";
import { ALLOWED_ROOTS } from "../src/services/AgenticFileService.ts";
import { transcriptsDirectory } from "../src/services/tasks/WorkspaceHooks.ts";
import { connectBridge, NO_ANSWER, startServer } from "./fakeWorkspaceBridge.ts";
import type { FakeBridge, RpcAnswer } from "./fakeWorkspaceBridge.ts";

/**
 * A repository's own hooks: POST /agentic/hook-command/run with
 * { workspace: true, cwd }, GET /agentic/hooks/config and
 * POST /agentic/transcripts/:id/append — on the workspace bridge serving the
 * path, or here when none does. Real commands for the local half, a
 * scripted bridge over a real socket for the routed half.
 */

let baseUrl: string;
let wsUrl: string;
let server: import("node:http").Server;
let scratch: string;
let bridgeRoot: string;
let localRoot: string;
let fakeHome: string;
const previousHome = process.env.HOME;
const bridges: FakeBridge[] = [];

async function bridgeWith(answers: Record<string, RpcAnswer>) {
  const bridge = await connectBridge(wsUrl, { roots: [bridgeRoot], answers: new Map(Object.entries(answers)) });
  bridges.push(bridge);
  return bridge;
}

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-username": "rodrigo" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "workspace-hooks-test-")));
  bridgeRoot = join(scratch, "on-the-bridge");
  localRoot = join(scratch, "here");
  fakeHome = join(scratch, "home");
  for (const directory of [bridgeRoot, join(localRoot, "repo", "src"), fakeHome]) mkdirSync(directory, { recursive: true });
  if (!ALLOWED_ROOTS.includes(localRoot)) ALLOWED_ROOTS.push(localRoot);
  process.env.HOME = fakeHome;

  const { default: hookCommandRoutes } = await import("../src/routes/HookCommandRoutes.ts");
  const { default: workspaceHookRoutes } = await import("../src/routes/WorkspaceHookRoutes.ts");
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware({ defaultUsername: DEFAULT_USERNAME, traceContext: true }));
  app.use("/agentic/hook-command", hookCommandRoutes);
  app.use("/agentic", workspaceHookRoutes);
  ({ server, baseUrl, wsUrl } = await startServer(app));
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await Promise.all(bridges.map((bridge) => bridge.close()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

describe("POST /agentic/hook-command/run { workspace: true }", () => {
  it("runs here, in cwd, when no bridge serves it — PRISM_PROJECT_DIR and PRISM_HOOK_* only, no service secrets", async () => {
    process.env.MONGO_URI_TEST_SECRET = "mongodb://secret";
    try {
      const response = await post("/agentic/hook-command/run", {
        workspace: true,
        cwd: join(localRoot, "repo"),
        command: 'payload=$(cat); printf "%s|%s|%s|%s|%s|%s" "$payload" "$(pwd)" "$PRISM_PROJECT_DIR" "$PRISM_HOOK_EVENT" "${EVIL:-unset}" "${MONGO_URI_TEST_SECRET:-unset}"',
        stdin: '{"hook_event_name":"PreToolUse"}',
        env: { PRISM_HOOK_EVENT: "PreToolUse", EVIL: "1" },
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as Record<string, unknown>;
      const repo = join(localRoot, "repo");
      expect(result).toMatchObject({
        exitCode: 0,
        timedOut: false,
        stdout: `{"hook_event_name":"PreToolUse"}|${repo}|${repo}|PreToolUse|unset|unset`,
      });
      expect(typeof result.durationMilliseconds).toBe("number");
    } finally {
      delete process.env.MONGO_URI_TEST_SECRET;
    }
  });

  it("kills the group at its deadline (timeoutMilliseconds) and says timedOut", async () => {
    const marker = join(scratch, "survived");
    const response = await post("/agentic/hook-command/run", {
      workspace: true,
      cwd: localRoot,
      command: `(sleep 2; touch ${marker}) & sleep 10`,
      timeoutMilliseconds: 600,
    });
    expect(await response.json()).toMatchObject({ timedOut: true, exitCode: null });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(existsSync(marker)).toBe(false);
  }, 10_000);

  it("runs on the bridge serving cwd: hook.run with the payload, PRISM_PROJECT_DIR and the clamped timeout", async () => {
    const bridge = await bridgeWith({
      "hook.run": () => ({ exitCode: 2, stdout: "", stderr: "blocked by the repo", timedOut: false, durationMs: 12 }),
    });
    const response = await post("/agentic/hook-command/run", {
      workspace: true,
      cwd: bridgeRoot,
      command: "node .claude/hooks/prism.mjs pre",
      stdin: '{"tool_name":"execute_command"}',
      timeoutMilliseconds: 15_000,
      env: { PRISM_HOOK_EVENT: "PreToolUse", HOME: "/elsewhere" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "blocked by the repo",
      timedOut: false,
      durationMilliseconds: 12,
    });
    const run = bridge.requests.find((request) => request.method === "hook.run")!;
    expect(run.params).toEqual({
      command: "node .claude/hooks/prism.mjs pre",
      cwd: bridgeRoot,
      stdin: '{"tool_name":"execute_command"}',
      env: { PRISM_HOOK_EVENT: "PreToolUse", PRISM_PROJECT_DIR: bridgeRoot },
      timeoutMs: 15_000,
    });
    await bridge.close();
  });

  it("waits for the bridge as long as the hook's own timeout + 5 s, then gives up (per-call RPC timeout)", async () => {
    const bridge = await bridgeWith({ "hook.run": () => NO_ANSWER });
    const started = Date.now();
    const response = await post("/agentic/hook-command/run", {
      workspace: true,
      cwd: bridgeRoot,
      command: "sleep 100",
      timeoutMilliseconds: 500,
    });
    const elapsed = Date.now() - started;
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("RPC timeout (hook.run, 5500ms)");
    expect(elapsed).toBeGreaterThanOrEqual(5_400);
    expect(elapsed).toBeLessThan(9_000);
    await bridge.close();
  }, 15_000);

  it("refuses to run a hook of an offline bridge here (wrong machine)", async () => {
    const bridge = await bridgeWith({});
    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const response = await post("/agentic/hook-command/run", { workspace: true, cwd: bridgeRoot, command: "true" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("is offline");
  });

  it.each([
    [{ workspace: true, command: "true" }, "cwd"],
    [{ workspace: "yes", command: "true", cwd: "/x" }, "'workspace' must be a boolean"],
    [{ workspace: true, command: "true", cwd: "relative/dir" }, "absolute path"],
  ])("refuses %j", async (body, message) => {
    const response = await post("/agentic/hook-command/run", body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(message);
  });
});

describe("GET /agentic/hooks/config", () => {
  it("here: the nearest .prism/hooks.json walking up within the root, and the user's own", async () => {
    const projectContent = '{"hooks":{"PreToolUse":[{"matcher":"^(execute_command)$","hooks":[{"type":"command","command":"x"}]}]}}';
    mkdirSync(join(localRoot, "repo", ".prism"), { recursive: true });
    writeFileSync(join(localRoot, "repo", ".prism", "hooks.json"), projectContent);
    mkdirSync(join(fakeHome, ".prism"), { recursive: true });
    writeFileSync(join(fakeHome, ".prism", "hooks.json"), '{"description":"mine"}');

    const response = await fetch(`${baseUrl}/agentic/hooks/config?root=${encodeURIComponent(join(localRoot, "repo", "src"))}`);
    expect(response.status).toBe(200);
    const config = (await response.json()) as { project: Record<string, unknown>; user: Record<string, unknown> };
    expect(config.project).toEqual({
      path: join(localRoot, "repo", ".prism", "hooks.json"),
      dir: join(localRoot, "repo"),
      exists: true,
      content: projectContent,
      sha256: createHash("sha256").update(projectContent).digest("hex"),
    });
    expect(config.user).toMatchObject({ path: join(fakeHome, ".prism", "hooks.json"), dir: fakeHome, exists: true });

    // No project file between `root` and its allowed root: null
    const bare = (await (await fetch(`${baseUrl}/agentic/hooks/config?root=${encodeURIComponent(localRoot)}`)).json()) as { project: unknown };
    expect(bare.project).toBeNull();
  });

  it("on the bridge serving root: hooks.config", async () => {
    const answer = { project: null, user: { path: "/home/u/.prism/hooks.json", dir: "/home/u", exists: true, content: "{}", sha256: "abc" } };
    const bridge = await bridgeWith({ "hooks.config": () => answer });
    const response = await fetch(`${baseUrl}/agentic/hooks/config?root=${encodeURIComponent(bridgeRoot)}`);
    expect(await response.json()).toEqual(answer);
    expect(bridge.requests.find((request) => request.method === "hooks.config")!.params).toEqual({ root: bridgeRoot });
    await bridge.close();
  });

  it("needs an absolute root", async () => {
    expect((await fetch(`${baseUrl}/agentic/hooks/config`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/agentic/hooks/config?root=relative`)).status).toBe(400);
  });
});

describe("POST /agentic/transcripts/:conversationId/append", () => {
  it("here: appends JSONL to <tmp>/prism-<uid>/transcripts/<id>.jsonl", async () => {
    const conversationId = `tools-test-${process.pid}-${Date.now()}`;
    const path = join(transcriptsDirectory(), `${conversationId}.jsonl`);
    try {
      const response = await post(`/agentic/transcripts/${conversationId}/append`, {
        root: localRoot,
        lines: [{ type: "user", sessionId: conversationId, message: { role: "user", content: "hi" } }],
      });
      expect(await response.json()).toEqual({ path });
      expect(JSON.parse(readFileSync(path, "utf8").trim())).toMatchObject({ type: "user", sessionId: conversationId });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("on the bridge serving root: transcript.append", async () => {
    const bridge = await bridgeWith({ "transcript.append": (params) => ({ path: `/tmp/prism-1000/transcripts/${String(params.conversationId)}.jsonl` }) });
    const response = await post("/agentic/transcripts/conversation-9/append", { root: bridgeRoot, lines: [{ type: "assistant" }] });
    expect(await response.json()).toEqual({ path: "/tmp/prism-1000/transcripts/conversation-9.jsonl" });
    expect(bridge.requests.find((request) => request.method === "transcript.append")!.params).toEqual({
      conversationId: "conversation-9",
      lines: [{ type: "assistant" }],
    });
    await bridge.close();
  });

  it("refuses a malformed conversation id or lines", async () => {
    expect((await post("/agentic/transcripts/bad%20id/append", { lines: [] })).status).toBe(400);
    expect((await post("/agentic/transcripts/ok-id/append", { lines: "nope" })).status).toBe(400);
  });
});
