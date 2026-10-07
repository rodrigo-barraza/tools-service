import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import { ALLOWED_ROOTS } from "../src/services/AgenticFileService.ts";
import { coerceInt, coerceBool } from "../src/utilities/agenticCoercion.ts";
import { formatHashline, lineHash } from "../src/utilities/hashline.ts";
import fs from "fs";
import path from "path";
import { Express } from "express";

// Pins the workspace-tool hardening fixes against the exact bad inputs real
// models sent in production (see docs/CORE_WORKSPACE_TOOLS_AUDIT_2026-07-14.md).

describe("agenticCoercion helpers", () => {
  it("coerceInt accepts integer-like strings but rejects junk and floats", () => {
    expect(coerceInt("10", { name: "n" })).toMatchObject({ ok: true, value: 10 });
    expect(coerceInt(5, { name: "n" })).toMatchObject({ ok: true, value: 5 });
    expect(coerceInt("60s", { name: "n" }).ok).toBe(false);
    expect(coerceInt("abc", { name: "n" }).ok).toBe(false);
    expect(coerceInt(2.5, { name: "n" }).ok).toBe(false);
    expect(coerceInt(NaN, { name: "n" }).ok).toBe(false);
  });
  it("coerceInt clamps to range with a note, and defaults on empty", () => {
    expect(coerceInt(9, { name: "n", min: 1, max: 5 })).toMatchObject({ ok: true, value: 5 });
    expect(coerceInt(undefined, { name: "n", default: 3 })).toMatchObject({ ok: true, value: 3 });
    expect(coerceInt(undefined, { name: "n" }).ok).toBe(false);
  });
  it("coerceBool accepts real and string booleans, rejects other strings", () => {
    expect(coerceBool("true", "b", false)).toMatchObject({ ok: true, value: true });
    expect(coerceBool("false", "b", true)).toMatchObject({ ok: true, value: false });
    expect(coerceBool(true, "b", false)).toMatchObject({ ok: true, value: true });
    expect(coerceBool(undefined, "b", true)).toMatchObject({ ok: true, value: true });
    expect(coerceBool("yes", "b", false).ok).toBe(false);
  });
});

describe("Agentic workspace router hardening", () => {
  let app: Express;
  const testRoot = "/tmp/agentic-hardening-test";

  beforeAll(async () => {
    if (!ALLOWED_ROOTS.includes(testRoot)) ALLOWED_ROOTS.push(testRoot);
    fs.mkdirSync(testRoot, { recursive: true });
    const { default: router } = await import("../src/routes/AgenticRoutes.ts");
    app = createTestApp("/agentic", router);
  });

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("read_file accepts `path` alias and coerces string line numbers", async () => {
    const file = path.join(testRoot, "alias.txt");
    fs.writeFileSync(file, "one\ntwo\nthree\nfour\n");
    const res = await request(app)
      .post("/agentic/file/read")
      .send({ path: file, startLine: "2", endLine: "3" });
    expect(res.status).toBe(200);
    expect(res.body.startLine).toBe(2);
    expect(res.body.endLine).toBe(3);
    expect(res.body.content).toContain(formatHashline(2, "two"));
  });

  it("read_file rejects a degenerate range instead of returning 0 lines", async () => {
    const file = path.join(testRoot, "degenerate.txt");
    fs.writeFileSync(file, "a\nb\nc\n");
    const res = await request(app)
      .post("/agentic/file/read")
      .send({ absolutePath: file, startLine: 50, endLine: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds the file length|greater than endLine/);
  });

  it("read_file rejects an uninterpretable startLine with a teaching error", async () => {
    const file = path.join(testRoot, "badline.txt");
    fs.writeFileSync(file, "a\nb\n");
    const res = await request(app)
      .post("/agentic/file/read")
      .send({ absolutePath: file, startLine: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startLine/);
  });

  it("list_directory rejects a string boolean instead of silently ignoring it", async () => {
    const res = await request(app)
      .post("/agentic/directory/list")
      .send({ path: testRoot, recursive: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recursive/);
  });

  it("grep includes globs like **/*.ts actually match nested files", async () => {
    const nested = path.join(testRoot, "src", "deep");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "widget.ts"), "export const NEEDLE = 1;\n");
    fs.writeFileSync(path.join(testRoot, "readme.md"), "NEEDLE here too\n");
    const res = await request(app)
      .post("/agentic/search/grep")
      .send({ pattern: "NEEDLE", searchPath: testRoot, includes: ["**/*.ts"] });
    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(res.body.results)).toContain("widget.ts");
    expect(JSON.stringify(res.body.results)).not.toContain("readme.md");
  });

  it("replace_in_file round-trips a hashline read anchor through /file/edit", async () => {
    const file = path.join(testRoot, "anchored.txt");
    fs.writeFileSync(file, "keep\nchange me\nkeep too\n");
    // Read through the route to get the real anchor for line 2…
    const read = await request(app)
      .post("/agentic/file/read")
      .send({ absolutePath: file });
    expect(read.status).toBe(200);
    const anchor = read.body.content.split("\n")[1].split("|")[0];
    expect(anchor).toBe(`2:${lineHash("change me")}`);
    // …and edit that line by its anchor.
    const res = await request(app)
      .post("/agentic/file/edit")
      .send({ path: file, edits: [{ anchor, content: "changed" }] });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe("keep\nchanged\nkeep too\n");
  });

  it("execute_command rejects a sub-second numeric timeout as probable seconds", async () => {
    const res = await request(app)
      .post("/agentic/command/run")
      .send({ command: "echo hi", cwd: testRoot, timeout: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/millisecond/i);
  });

  it("execute_command kills the whole group at its timeout — never backgrounds it — and keeps the output so far", async () => {
    // Children inherit the ignored SIGTERM: only the SIGKILL 2 s later stops them
    const started = Date.now();
    const res = await request(app)
      .post("/agentic/command/run")
      .send({ command: 'trap "" TERM; echo before; sleep 300 & echo "CHILD:$!"; wait', cwd: testRoot, timeout: 1500 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, timedOut: true, exitCode: null, error: "Command timed out after 1500ms" });
    expect(res.body.backgrounded).toBeUndefined();
    expect(res.body.stdout).toContain("before");
    expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
    const childPid = Number(res.body.stdout.match(/CHILD:(\d+)/)[1]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 15_000);

  it("execute_command run_in_background answers at once with a task id and an output file", async () => {
    const started = Date.now();
    const res = await request(app)
      .post("/agentic/command/run")
      .send({ command: "sleep 0.5; echo done-in-background", cwd: testRoot, run_in_background: true, description: "Echo later" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, backgrounded: true, exitCode: null, stdout: "", stderr: "" });
    expect(res.body.taskId).toMatch(/^shell-[0-9a-z]{8}$/);
    expect(res.body.message).toBe(
      `Command running in background with ID: ${res.body.taskId}. Output is being written to: ${res.body.outputFile}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(fs.readFileSync(res.body.outputFile, "utf8")).toBe("done-in-background\n");
  });

  it("the background-process routes are gone (task_stop and read_file replace them)", async () => {
    expect((await request(app).post("/agentic/command/kill").send({ pid: 1 })).status).toBe(404);
    expect((await request(app).get("/agentic/command/background/list")).status).toBe(404);
  });

  it("notebook edit rejects a non-integer cellIndex instead of splicing cell 0", async () => {
    const nb = path.join(testRoot, "nb.ipynb");
    fs.writeFileSync(
      nb,
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          { cell_type: "code", source: ["print(1)"], metadata: {}, outputs: [], execution_count: null },
          { cell_type: "code", source: ["print(2)"], metadata: {}, outputs: [], execution_count: null },
        ],
      }),
    );
    const res = await request(app)
      .post("/agentic/notebook/edit")
      .send({ path: nb, action: "delete_cell", cellIndex: "last" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cellIndex/);
    // Cell 0 must still be present.
    const after = JSON.parse(fs.readFileSync(nb, "utf-8"));
    expect(after.cells.length).toBe(2);
  });
});
