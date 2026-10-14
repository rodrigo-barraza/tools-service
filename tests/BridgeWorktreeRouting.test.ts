import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { requestLocalStorage } from "@rodrigo-barraza/utilities-library/service";
import {
  isSubAgentWorktree,
  resolveAndRouteToAgent,
  sendRpc,
} from "../src/services/AgentConnectionManager.ts";
import {
  agenticGitWorktreeCleanup,
  agenticGitWorktreeCommit,
  agenticGitWorktreeCreate,
  agenticGitWorktreeDiff,
  agenticGitWorktreeMerge,
  agenticGitWorktreeRemove,
} from "../src/services/AgenticGitService.ts";
import { connectBridge, startServer, type FakeBridge, type RpcAnswer } from "./fakeWorkspaceBridge.ts";

/**
 * A sub-agent's worktree in a repository a bridge serves is the bridge's to
 * make (workspace-service GitWorktreeHandler): this host does not have the
 * repository, and running git here once sent every isolated sub-agent back
 * to the shared root. The six operations go to the bridge with their
 * arguments; with the bridge gone they are refused, never run here; and a
 * sub-agent's relative paths resolve inside its worktree, not the bridge's
 * first root.
 */

// A path this host does not have: a local fallback could only fail
const bridgedRoot = `/nonexistent-bridge-worktrees-${process.pid}`;
const repo = `${bridgedRoot}/app`;
const worktree = `${repo}/.claude/worktrees/orchestrator_agent-1`;

let server: import("node:http").Server;
let wsUrl: string;
let bridge: FakeBridge;
const answers = new Map<string, RpcAnswer>();

beforeAll(async () => {
  ({ server, wsUrl } = await startServer(express()));
  bridge = await connectBridge(wsUrl, { roots: [bridgedRoot], answers });
});

afterAll(async () => {
  await bridge.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  bridge.requests.length = 0;
  answers.clear();
});

function lastRequest() {
  return bridge.requests[bridge.requests.length - 1];
}

describe("worktree operations on a bridged repository go to its bridge", () => {
  it("create: the bridge's answer, with the bridge's repoPath and links", async () => {
    answers.set("git.worktreeCreate", () => ({
      worktreePath: worktree,
      branch: "orchestrator/agent-1",
      repoPath: repo,
      linked: ["."],
    }));
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/agent-1");
    expect(created).toEqual({ worktreePath: worktree, branch: "orchestrator/agent-1", repoPath: repo, linked: ["."] });
    expect(lastRequest()).toMatchObject({ method: "git.worktreeCreate", params: { path: repo, branch: "orchestrator/agent-1" } });
  });

  it("commit, diff, merge, remove and cleanup carry their arguments", async () => {
    for (const method of ["git.worktreeCommit", "git.worktreeDiff", "git.worktreeMerge", "git.worktreeRemove", "git.worktreeCleanup"]) {
      answers.set(method, () => ({ ok: method }));
    }
    await agenticGitWorktreeCommit(repo, worktree, "work");
    expect(lastRequest()).toMatchObject({ method: "git.worktreeCommit", params: { path: repo, worktreePath: worktree, message: "work" } });
    await agenticGitWorktreeDiff(repo, "orchestrator/agent-1");
    expect(lastRequest()).toMatchObject({ method: "git.worktreeDiff", params: { path: repo, branch: "orchestrator/agent-1" } });
    await agenticGitWorktreeMerge(repo, "orchestrator/agent-1", { message: "Merge" });
    expect(lastRequest()).toMatchObject({ method: "git.worktreeMerge", params: { path: repo, branch: "orchestrator/agent-1", message: "Merge" } });
    await agenticGitWorktreeRemove(repo, worktree, { force: true });
    expect(lastRequest()).toMatchObject({ method: "git.worktreeRemove", params: { path: repo, worktreePath: worktree, deleteBranch: true, force: true } });
    await agenticGitWorktreeCleanup(repo);
    expect(lastRequest()).toMatchObject({ method: "git.worktreeCleanup", params: { path: repo } });
  });

  it("passes a protected-branch refusal through as the bridge said it", async () => {
    answers.set("git.worktreeMerge", () => ({ error: "Not merging into master", reason: "protected-branch", into: "master" }));
    const merged = await agenticGitWorktreeMerge(repo, "orchestrator/agent-1");
    expect(merged).toMatchObject({ reason: "protected-branch", into: "master" });
  });
});

describe("a sub-agent's worktree as the request's override", () => {
  it("is honoured when a bridge serves it, and not otherwise", () => {
    expect(isSubAgentWorktree(worktree)).toBe(true);
    expect(isSubAgentWorktree("/tmp/prism-worktrees/orchestrator_agent-1-123")).toBe(true);
    expect(isSubAgentWorktree(`/elsewhere-${process.pid}/app/.claude/worktrees/x`)).toBe(false);
    expect(isSubAgentWorktree(`${repo}/src`)).toBe(false);
  });

  it("resolves a relative path inside the worktree before it reaches the bridge", async () => {
    answers.set("file.read", () => ({ content: "" }));
    await requestLocalStorage.run({ workspaceOverride: worktree, workspaceRoot: bridgedRoot }, async () => {
      const agent = resolveAndRouteToAgent("src/a.ts");
      expect(agent).not.toBeNull();
      await sendRpc(agent!.id, "file.read", { path: "src/a.ts", paths: ["b.ts", 7] });
    });
    expect(lastRequest()).toMatchObject({
      method: "file.read",
      params: { path: `${worktree}/src/a.ts`, paths: [`${worktree}/b.ts`, 7] },
    });
  });

  it("resolves against the request's root when there is no worktree", async () => {
    answers.set("file.read", () => ({ content: "" }));
    await requestLocalStorage.run({ workspaceRoot: repo }, async () => {
      await sendRpc(resolveAndRouteToAgent("README.md")!.id, "file.read", { path: "README.md" });
    });
    expect(lastRequest().params.path).toBe(`${repo}/README.md`);
  });
});

describe("with the bridge gone", () => {
  it("refuses the worktree operations instead of running git on this host", async () => {
    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/agent-2");
    expect(created.error).toContain("is offline");
    expect(created.worktreePath).toBeUndefined();
  });
});
