import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { createTestApp } from "./testApp.ts";
import { filterHookEnv, ownerDirectoryName } from "../src/services/HookCommandService.ts";

/**
 * POST /agentic/hook-command/run — prism's `command` hooks, run for real:
 * temporary scripts in a temporary hooks root, payload on stdin, the exit
 * code and stdout back, a timeout that KILLS.
 */
describe("Hook command endpoint", () => {
  let app: Express;
  const hooksRoot = mkdtempSync(join(tmpdir(), "prism-hooks-root-"));
  const previousRoot = process.env.HOOK_COMMANDS_DIRECTORY;

  function install(owner: string, name: string, body: string): void {
    const directory = join(hooksRoot, owner);
    // The service creates the directory on first use; tests may run first.
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  }

  const run = (body: Record<string, unknown>) =>
    request(app).post("/agentic/hook-command/run").send(body);

  beforeAll(async () => {
    process.env.HOOK_COMMANDS_DIRECTORY = hooksRoot;
    const { default: router } = await import("../src/routes/HookCommandRoutes.ts");
    app = createTestApp("/agentic/hook-command", router);
  });

  afterAll(() => {
    if (previousRoot === undefined) delete process.env.HOOK_COMMANDS_DIRECTORY;
    else process.env.HOOK_COMMANDS_DIRECTORY = previousRoot;
    rmSync(hooksRoot, { recursive: true, force: true });
  });

  it("runs in the owner's hooks directory with the payload on stdin", async () => {
    install("rodrigo", "echo-tool.sh", `payload=$(cat); printf '{"seen":%s,"cwd":"%s"}' "$payload" "$(pwd)"`);
    const response = await run({
      command: "./echo-tool.sh",
      owner: "rodrigo",
      stdin: '{"tool_name":"execute_shell"}',
    }).expect(200);

    expect(response.body.exitCode).toBe(0);
    expect(response.body.timedOut).toBe(false);
    const output = JSON.parse(response.body.stdout);
    expect(output.seen).toEqual({ tool_name: "execute_shell" });
    expect(output.cwd).toBe(join(hooksRoot, "rodrigo"));
  });

  it("reports exit 2 and stderr as they are — the verdict is prism's to read", async () => {
    install("rodrigo", "block.sh", `echo "no force pushes" >&2; exit 2`);
    const response = await run({ command: "./block.sh", owner: "rodrigo" }).expect(200);
    expect(response.body).toMatchObject({ exitCode: 2, stderr: "no force pushes\n", timedOut: false });
  });

  it("kills a command that overruns its timeout, children included", async () => {
    const marker = join(hooksRoot, "survived");
    const started = Date.now();
    const response = await run({
      command: `(sleep 3; touch ${marker}) & sleep 10`,
      owner: "rodrigo",
      timeoutMilliseconds: 600,
    }).expect(200);
    expect(response.body).toMatchObject({ timedOut: true, exitCode: null });
    expect(Date.now() - started).toBeLessThan(3_000);
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(existsSync(marker), "the backgrounded child must die with the group").toBe(false);
  });

  it("passes only PRISM_HOOK_* variables from the caller, and never the service's secrets", async () => {
    process.env.MONGO_URI_TEST_SECRET = "mongodb://secret";
    const response = await run({
      command: 'printf "%s|%s|%s" "$PRISM_HOOK_EVENT" "${EVIL:-unset}" "${MONGO_URI_TEST_SECRET:-unset}"',
      owner: "rodrigo",
      env: { PRISM_HOOK_EVENT: "PreToolUse", EVIL: "1", PATH: "/nowhere" },
    }).expect(200);
    delete process.env.MONGO_URI_TEST_SECRET;
    expect(response.body.stdout).toBe("PreToolUse|unset|unset");
  });

  it("keeps each owner in their own directory, whatever the name", async () => {
    await run({ command: "true", owner: "../../etc" }).expect(200);
    expect(ownerDirectoryName("../../etc")).not.toContain("/");
    expect(statSync(join(hooksRoot, ownerDirectoryName("../../etc"))).isDirectory()).toBe(true);
    expect(existsSync(join(hooksRoot, "..", "..", "etc", "passwd.prism"))).toBe(false);
  });

  it("does not fail when the script ignores its stdin", async () => {
    const response = await run({ command: "exit 0", owner: "rodrigo", stdin: "x".repeat(200_000) }).expect(200);
    expect(response.body.exitCode).toBe(0);
  });

  it.each([
    [{ owner: "rodrigo" }, "command"],
    [{ command: "true" }, "owner"],
    [{ command: "true", owner: "rodrigo", stdin: 5 }, "stdin"],
    [{ command: "true", owner: "rodrigo", env: ["A=1"] }, "env"],
  ])("rejects a malformed request %j", async (body, field) => {
    const response = await run(body as Record<string, unknown>).expect(400);
    expect(response.body.error).toContain(field);
  });

  it("filterHookEnv drops everything but string PRISM_HOOK_* values", () => {
    expect(
      filterHookEnv({ PRISM_HOOK_A: "a", PRISM_HOOK_B: 1, prism_hook_c: "c", HOME: "/root", PRISM_HOOKS_DIR: "/x" }),
    ).toEqual({ PRISM_HOOK_A: "a" });
  });
});
