import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { offlineRemoteRootForPath } from "../src/services/AgentConnectionManager.ts";
import { executeCommand } from "../src/services/AgenticCommandService.ts";
import { connectBridge, startServer } from "./fakeWorkspaceBridge.ts";

/**
 * A bridge in WSL/standalone mode registers the virtual root "/" and names the
 * folders it really serves as display roots. When it drops, a command under a
 * display root this host does not have must be refused as offline — not run
 * here, on the tools-service host (found live 2026-10-06: a background run
 * started while the bridge was away ran on the wrong machine).
 */

let server: import("node:http").Server;
let wsUrl: string;
let scratch: string;
const remoteOnly = `/nonexistent-claude-parity-${process.pid}/repo`;

beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "bridge-display-roots-")));
  ({ server, wsUrl } = await startServer(express()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

describe("a '/'-rooted bridge's display roots after it drops", () => {
  it("refuses a command under a display root this host does not have", async () => {
    const bridge = await connectBridge(wsUrl, { roots: ["/"], displayRoots: [remoteOnly, scratch] });
    expect(offlineRemoteRootForPath(`${remoteOnly}/src`)).toBeNull();
    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(offlineRemoteRootForPath(`${remoteOnly}/src`)).toBe(remoteOnly);
    const result = await executeCommand("echo ran-here", { cwd: remoteOnly });
    expect(result.success).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.error).toContain("is offline");
  });

  it("leaves a display root this host has to local routing (the same filesystem)", () => {
    expect(offlineRemoteRootForPath(join(scratch, "x"))).toBeNull();
  });
});
