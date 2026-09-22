import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { createTestApp } from "./testApp.ts";
import { ALLOWED_ROOTS } from "../src/services/AgenticFileService.ts";

// Workspace snapshots for rewind (prism-service docs/prompts/15): a shadow
// commit under refs/prism/checkpoints/… built through a TEMPORARY index, so
// the user's index, HEAD and working tree are never touched by a snapshot.
// Every test runs against a real temporary git repository — no mocked git.

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, ...IDENTITY },
  }).toString();
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  if (!ALLOWED_ROOTS.includes(dir)) ALLOWED_ROOTS.push(dir);
  return dir;
}

/** A repo with one commit (a.txt, b.txt, c.txt, .gitignore). */
function makeRepo(): string {
  const dir = makeTempDir("prism-snapshot-");
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "a v1\n");
  writeFileSync(join(dir, "b.txt"), "b v1\n");
  writeFileSync(join(dir, "c.txt"), "c v1\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

function indexHash(dir: string): string {
  return createHash("sha256")
    .update(readFileSync(join(dir, ".git", "index")))
    .digest("hex");
}

function userState(dir: string) {
  return {
    status: git(dir, ["status", "--porcelain", "--untracked-files=all"]),
    index: indexHash(dir),
    head: git(dir, ["rev-parse", "HEAD"]).trim(),
    branch: git(dir, ["symbolic-ref", "HEAD"]).trim(),
    staged: git(dir, ["diff", "--cached"]),
  };
}

const read = (dir: string, file: string) =>
  readFileSync(join(dir, file), "utf-8");

const REF = (turn: string) => `refs/prism/checkpoints/conv-test/${turn}`;

let app: Express;

beforeAll(async () => {
  const { default: router } = await import("../src/routes/AgenticRoutes.ts");
  app = createTestApp("/agentic", router);
});

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

async function snapshot(workspaceRoot: string, ref: string) {
  return request(app).post("/agentic/git/snapshot").send({ workspaceRoot, ref });
}

async function restore(body: Record<string, unknown>) {
  return request(app).post("/agentic/git/restore").send(body);
}

describe("POST /agentic/git/snapshot", () => {
  it("leaves the user's index, HEAD and status untouched", async () => {
    const repo = makeRepo();
    // A realistic dirty tree: a staged edit, an unstaged edit, an untracked file.
    writeFileSync(join(repo, "a.txt"), "a staged\n");
    git(repo, ["add", "a.txt"]);
    writeFileSync(join(repo, "b.txt"), "b unstaged\n");
    writeFileSync(join(repo, "new.txt"), "brand new\n");
    const before = userState(repo);

    const response = await snapshot(repo, REF("1-1"));

    expect(response.status).toBe(200);
    expect(response.body.snapshotCapable).toBe(true);
    expect(userState(repo)).toEqual(before);
    // The shadow commit hangs off HEAD and lives only under refs/prism.
    const commit = git(repo, ["rev-parse", REF("1-1")]).trim();
    expect(response.body.commit).toBe(commit);
    expect(git(repo, ["rev-parse", `${commit}^`]).trim()).toBe(before.head);
    expect(git(repo, ["branch", "--list"]).trim()).toBe("* main");
  });

  it("includes new untracked files and the WORKING-TREE content of modified ones", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "a.txt"), "a staged\n");
    git(repo, ["add", "a.txt"]);
    writeFileSync(join(repo, "a.txt"), "a working tree\n");
    mkdirSync(join(repo, "deep", "dir"), { recursive: true });
    writeFileSync(join(repo, "deep", "dir", "untracked.txt"), "untracked\n");
    mkdirSync(join(repo, "ignored"));
    writeFileSync(join(repo, "ignored", "build.out"), "ignored\n");

    await snapshot(repo, REF("1-1"));

    const files = git(repo, ["ls-tree", "-r", "--name-only", REF("1-1")])
      .trim()
      .split("\n");
    expect(files).toContain("deep/dir/untracked.txt");
    expect(files).not.toContain("ignored/build.out");
    expect(git(repo, ["show", `${REF("1-1")}:a.txt`])).toBe("a working tree\n");
    expect(git(repo, ["show", `${REF("1-1")}:deep/dir/untracked.txt`])).toBe(
      "untracked\n",
    );
  });

  it("never runs hooks, even a failing pre-commit / reference-transaction hook", async () => {
    const repo = makeRepo();
    const markers = makeTempDir("prism-hook-markers-");
    const hooks = join(repo, ".git", "hooks");
    for (const hook of [
      "pre-commit",
      "commit-msg",
      "post-commit",
      "reference-transaction",
      "post-index-change",
      "post-checkout",
    ]) {
      const path = join(hooks, hook);
      writeFileSync(path, `#!/bin/sh\ntouch "${markers}/${hook}"\nexit 1\n`);
      chmodSync(path, 0o755);
    }
    // Point core.hooksPath at them too, so a config-level override can't hide a hook.
    git(repo, ["config", "core.hooksPath", hooks]);
    writeFileSync(join(repo, "new.txt"), "new\n");

    const taken = await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "a.txt"), "agent edit\n");
    const restored = await restore({ workspaceRoot: repo, ref: REF("1-1"), force: true });

    expect(taken.status).toBe(200);
    expect(taken.body.snapshotCapable).toBe(true);
    expect(restored.status).toBe(200);
    expect(read(repo, "a.txt")).toBe("a v1\n");
    expect(existsSync(join(markers, "pre-commit"))).toBe(false);
    expect(existsSync(join(markers, "reference-transaction"))).toBe(false);
    expect(existsSync(join(markers, "post-index-change"))).toBe(false);
    expect(existsSync(join(markers, "post-checkout"))).toBe(false);
    // Control: the hooks are live — plain git trips reference-transaction.
    expect(() => git(repo, ["update-ref", "refs/prism/checkpoints/control/x", "HEAD"])).toThrow();
    expect(existsSync(join(markers, "reference-transaction"))).toBe(true);
  });

  it("snapshots a repository with no commits yet (no parent)", async () => {
    const repo = makeTempDir("prism-unborn-");
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "first.txt"), "first\n");

    const response = await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "second.txt"), "second\n");
    const restored = await restore({ workspaceRoot: repo, ref: REF("1-1"), force: true });

    expect(response.status).toBe(200);
    expect(response.body.head).toBeNull();
    expect(git(repo, ["show", `${REF("1-1")}:first.txt`])).toBe("first\n");
    expect(restored.body.removed).toEqual(["second.txt"]);
    expect(existsSync(join(repo, "second.txt"))).toBe(false);
    expect(() => git(repo, ["rev-parse", "--verify", "HEAD"])).toThrow();
  });

  it("works in a linked git worktree without touching the worktree's own index", async () => {
    const repo = makeRepo();
    const worktree = join(makeTempDir("prism-linked-"), "wt");
    git(repo, ["worktree", "add", "-q", worktree, "-b", "feature"]);
    writeFileSync(join(worktree, "a.txt"), "a in worktree\n");
    git(worktree, ["add", "a.txt"]);
    const before = git(worktree, ["status", "--porcelain"]);

    const response = await snapshot(worktree, REF("1-1"));
    writeFileSync(join(worktree, "b.txt"), "b agent\n");
    const restored = await restore({ workspaceRoot: worktree, ref: REF("1-1"), force: true });

    expect(response.status).toBe(200);
    expect(restored.body.restored).toEqual(["b.txt"]);
    expect(git(worktree, ["status", "--porcelain"])).toBe(before);
    // Refs are shared across worktrees: the main checkout sees the snapshot.
    expect(git(repo, ["show", `${REF("1-1")}:a.txt`])).toBe("a in worktree\n");
  });

  it("reports a non-git workspace as not snapshot-capable instead of succeeding", async () => {
    const plain = makeTempDir("prism-plain-");
    writeFileSync(join(plain, "file.txt"), "x\n");

    const taken = await snapshot(plain, REF("1-1"));
    const restored = await restore({ workspaceRoot: plain, ref: REF("1-1") });

    expect(taken.status).toBe(200);
    expect(taken.body.snapshotCapable).toBe(false);
    expect(taken.body.reason).toMatch(/not a git repository/i);
    expect(taken.body.commit).toBeUndefined();
    expect(restored.body.snapshotCapable).toBe(false);
    expect(restored.body.reason).toMatch(/not a git repository/i);
  });

  it("rejects refs outside refs/prism/checkpoints/ and malformed refs", async () => {
    const repo = makeRepo();
    for (const ref of [
      "refs/heads/main",
      "refs/prism/checkpoints/../../heads/main",
      "refs/prism/checkpoints/conv/-x",
      "refs/prism/checkpoints/conv/a b",
      "--output=/tmp/x",
    ]) {
      const response = await snapshot(repo, ref);
      expect(response.status, ref).toBe(400);
    }
    expect(git(repo, ["rev-parse", "main"]).trim()).toBe(
      git(repo, ["rev-parse", "HEAD"]).trim(),
    );
  });
});

describe("POST /agentic/git/restore", () => {
  it("restores modified and deleted files and removes files created after the snapshot", async () => {
    const repo = makeRepo();
    // The user's own staged change must survive the whole cycle.
    writeFileSync(join(repo, "c.txt"), "c staged by user\n");
    git(repo, ["add", "c.txt"]);
    await snapshot(repo, REF("1-1"));
    // The "agent" writes: modify, delete, create (nested, to exercise dir pruning).
    writeFileSync(join(repo, "a.txt"), "a agent\n");
    rmSync(join(repo, "b.txt"));
    mkdirSync(join(repo, "made", "by"), { recursive: true });
    writeFileSync(join(repo, "made", "by", "agent.txt"), "agent\n");
    await snapshot(repo, REF("1-1-after"));
    const staged = git(repo, ["diff", "--cached"]);
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    const index = indexHash(repo);

    const response = await restore({
      workspaceRoot: repo,
      ref: REF("1-1"),
      againstRef: REF("1-1-after"),
    });

    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(true);
    expect(response.body.restored.sort()).toEqual(["a.txt", "b.txt"]);
    expect(response.body.removed).toEqual(["made/by/agent.txt"]);
    expect(read(repo, "a.txt")).toBe("a v1\n");
    expect(read(repo, "b.txt")).toBe("b v1\n");
    expect(existsSync(join(repo, "made"))).toBe(false);
    // Never the user's index or HEAD.
    expect(git(repo, ["diff", "--cached"])).toBe(staged);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(indexHash(repo)).toBe(index);
    // A forced mistake is recoverable: the pre-restore state is kept under undoRef.
    expect(git(repo, ["show", `${response.body.undoRef}:a.txt`])).toBe("a agent\n");
  });

  it("dry-run lists the files and changes nothing", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "a.txt"), "a agent\n");
    writeFileSync(join(repo, "created.txt"), "created\n");
    await snapshot(repo, REF("1-1-after"));

    const response = await restore({
      workspaceRoot: repo,
      ref: REF("1-1"),
      againstRef: REF("1-1-after"),
      dryRun: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.applied).toBe(false);
    expect(response.body.restored).toEqual(["a.txt"]);
    expect(response.body.removed).toEqual(["created.txt"]);
    expect(read(repo, "a.txt")).toBe("a agent\n");
    expect(existsSync(join(repo, "created.txt"))).toBe(true);
  });

  it("refuses when the user changed a file after the latest snapshot, unless forced", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "a.txt"), "a agent\n");
    await snapshot(repo, REF("1-1-after"));
    // The user edits after the agent's last write.
    writeFileSync(join(repo, "c.txt"), "c edited by user\n");

    const refused = await restore({
      workspaceRoot: repo,
      ref: REF("1-1"),
      againstRef: REF("1-1-after"),
    });

    expect(refused.status).toBe(409);
    expect(refused.body.refused).toBe(true);
    expect(refused.body.conflicts).toEqual(["c.txt"]);
    expect(read(repo, "a.txt")).toBe("a agent\n");
    expect(read(repo, "c.txt")).toBe("c edited by user\n");

    const forced = await restore({
      workspaceRoot: repo,
      ref: REF("1-1"),
      againstRef: REF("1-1-after"),
      force: true,
    });

    expect(forced.status).toBe(200);
    expect(forced.body.applied).toBe(true);
    expect(read(repo, "a.txt")).toBe("a v1\n");
    expect(read(repo, "c.txt")).toBe("c v1\n");
  });

  it("compares against the latest snapshot of the conversation when no againstRef is given", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "a.txt"), "a agent\n");
    await snapshot(repo, REF("1-1-after"));

    const clean = await restore({ workspaceRoot: repo, ref: REF("1-1"), dryRun: true });
    writeFileSync(join(repo, "b.txt"), "b edited by user\n");
    const dirty = await restore({ workspaceRoot: repo, ref: REF("1-1"), dryRun: true });

    expect(clean.status).toBe(200);
    expect(clean.body.conflicts).toEqual([]);
    expect(dirty.status).toBe(409);
    expect(dirty.body.conflicts).toEqual(["b.txt"]);
  });

  it("leaves ignored files and paths outside the requested paths alone", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "a.txt"), "a agent\n");
    writeFileSync(join(repo, "b.txt"), "b agent\n");
    mkdirSync(join(repo, "ignored"));
    writeFileSync(join(repo, "ignored", "cache.bin"), "cache\n");
    await snapshot(repo, REF("1-1-after"));

    const response = await restore({
      workspaceRoot: repo,
      ref: REF("1-1"),
      paths: ["a.txt"],
    });

    expect(response.status).toBe(200);
    expect(response.body.restored).toEqual(["a.txt"]);
    expect(read(repo, "a.txt")).toBe("a v1\n");
    expect(read(repo, "b.txt")).toBe("b agent\n");
    expect(read(repo, "ignored/cache.bin")).toBe("cache\n");
  });

  it("scopes a snapshot and restore to a workspace that is a subdirectory of the repo", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "pkg"));
    writeFileSync(join(repo, "pkg", "inside.txt"), "inside v1\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "pkg"]);
    const workspace = join(repo, "pkg");
    await snapshot(workspace, REF("1-1"));
    writeFileSync(join(repo, "pkg", "inside.txt"), "inside agent\n");
    writeFileSync(join(repo, "pkg", "extra.txt"), "extra\n");
    writeFileSync(join(repo, "a.txt"), "outside edit\n");
    await snapshot(workspace, REF("1-1-after"));

    const response = await restore({ workspaceRoot: workspace, ref: REF("1-1") });

    expect(response.status).toBe(200);
    expect(response.body.restored).toEqual(["inside.txt"]);
    expect(response.body.removed).toEqual(["extra.txt"]);
    expect(read(repo, "pkg/inside.txt")).toBe("inside v1\n");
    expect(existsSync(join(repo, "pkg", "extra.txt"))).toBe(false);
    expect(read(repo, "a.txt")).toBe("outside edit\n");
  });

  it("returns 404 for a snapshot ref that does not exist", async () => {
    const repo = makeRepo();
    const response = await restore({ workspaceRoot: repo, ref: REF("9-9") });
    expect(response.status).toBe(404);
  });
});

describe("POST /agentic/git/restore with agentRanges — only the agent's changes", () => {
  /** Turn 1 writes a.txt; turn 2 rewrites it and creates b.txt. Returns the refs. */
  async function twoAgentTurns(repo: string) {
    await snapshot(repo, REF("1-1"));
    writeFileSync(join(repo, "a.txt"), "turn one\n");
    await snapshot(repo, REF("1-1-after"));
    await snapshot(repo, REF("2-1"));
    writeFileSync(join(repo, "a.txt"), "turn two\n");
    writeFileSync(join(repo, "b.txt.new"), "bee\n");
    await snapshot(repo, REF("2-1-after"));
    return { target: REF("2-1"), ranges: [{ from: REF("2-1"), to: REF("2-1-after") }] };
  }

  it("restores the agent's files and leaves the user's unrelated staged and untracked changes alone", async () => {
    const repo = makeRepo();
    const { target, ranges } = await twoAgentTurns(repo);
    // The user stages an unrelated change and drops an untracked file.
    writeFileSync(join(repo, "c.txt"), "c staged by user\n");
    git(repo, ["add", "c.txt"]);
    writeFileSync(join(repo, "notes.md"), "mine\n");
    const staged = git(repo, ["diff", "--cached"]);
    const index = indexHash(repo);

    const response = await restore({ workspaceRoot: repo, ref: target, agentRanges: ranges });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ applied: true, restored: ["a.txt"], removed: ["b.txt.new"], conflicts: [] });
    expect(read(repo, "a.txt")).toBe("turn one\n");
    expect(existsSync(join(repo, "b.txt.new"))).toBe(false);
    expect(read(repo, "c.txt")).toBe("c staged by user\n");
    expect(read(repo, "notes.md")).toBe("mine\n");
    expect(git(repo, ["diff", "--cached"])).toBe(staged);
    expect(indexHash(repo)).toBe(index);
  });

  it("an agent-changed file the user edited afterwards is a conflict, unless forced", async () => {
    const repo = makeRepo();
    const { target, ranges } = await twoAgentTurns(repo);
    writeFileSync(join(repo, "a.txt"), "user touched it\n");
    writeFileSync(join(repo, "c.txt"), "unrelated user edit\n");

    const refused = await restore({ workspaceRoot: repo, ref: target, agentRanges: ranges });
    const forced = await restore({ workspaceRoot: repo, ref: target, agentRanges: ranges, force: true });

    expect(refused.status).toBe(409);
    expect(refused.body.conflicts).toEqual(["a.txt"]);
    expect(forced.status).toBe(200);
    expect(read(repo, "a.txt")).toBe("turn one\n");
    // Forcing overwrites the conflict only — never the user's unrelated file.
    expect(read(repo, "c.txt")).toBe("unrelated user edit\n");
  });

  it("a user edit BETWEEN two agent batches to a path the agent touched is a conflict", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("2-1"));
    writeFileSync(join(repo, "a.txt"), "agent 1\n");
    await snapshot(repo, REF("2-1-after"));
    writeFileSync(join(repo, "a.txt"), "user between turns\n");
    await snapshot(repo, REF("3-1"));
    writeFileSync(join(repo, "b.txt"), "agent 2\n");
    await snapshot(repo, REF("3-1-after"));

    const response = await restore({
      workspaceRoot: repo,
      ref: REF("2-1"),
      agentRanges: [
        { from: REF("2-1"), to: REF("2-1-after") },
        { from: REF("3-1"), to: REF("3-1-after") },
      ],
      dryRun: true,
    });

    expect(response.status).toBe(409);
    expect(response.body.conflicts).toEqual(["a.txt"]);
    expect(response.body.restored.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("an earlier restore counts as the agent's change, not the user's", async () => {
    const repo = makeRepo();
    const { target, ranges } = await twoAgentTurns(repo);
    const first = await restore({ workspaceRoot: repo, ref: target, agentRanges: ranges });
    expect(first.status).toBe(200);
    // The conversation goes on: turn 3 writes a.txt again.
    await snapshot(repo, REF("3-1"));
    writeFileSync(join(repo, "a.txt"), "turn three\n");
    await snapshot(repo, REF("3-1-after"));

    const again = await restore({
      workspaceRoot: repo,
      ref: target,
      agentRanges: [
        ...ranges,
        { from: first.body.undoRef, to: first.body.afterRef },
        { from: REF("3-1"), to: REF("3-1-after") },
      ],
    });

    expect(again.status).toBe(200);
    expect(again.body.conflicts).toEqual([]);
    expect(read(repo, "a.txt")).toBe("turn one\n");
  });

  it("rejects a malformed range", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    const response = await restore({ workspaceRoot: repo, ref: REF("1-1"), agentRanges: [{ from: "refs/heads/main", to: null }] });
    expect(response.status).toBe(400);
  });
});

describe("POST /agentic/git/snapshot/delete", () => {
  it("deletes a conversation's refs by prefix and only those", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    await snapshot(repo, REF("1-1-after"));
    await snapshot(repo, "refs/prism/checkpoints/other-conv/1-1");

    const response = await request(app)
      .post("/agentic/git/snapshot/delete")
      .send({ workspaceRoot: repo, prefix: "refs/prism/checkpoints/conv-test/" });

    expect(response.status).toBe(200);
    expect(response.body.deleted.sort()).toEqual([REF("1-1"), REF("1-1-after")]);
    const remaining = git(repo, ["for-each-ref", "--format=%(refname)", "refs/prism/"])
      .trim()
      .split("\n");
    expect(remaining).toEqual(["refs/prism/checkpoints/other-conv/1-1"]);
  });

  it("deletes only refs older than the cutoff when olderThanMs is given", async () => {
    const repo = makeRepo();
    await snapshot(repo, REF("1-1"));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const cutoffAge = 800;
    const fresh = await snapshot(repo, REF("2-1"));
    expect(fresh.status).toBe(200);

    const response = await request(app)
      .post("/agentic/git/snapshot/delete")
      .send({
        workspaceRoot: repo,
        prefix: "refs/prism/checkpoints/",
        olderThanMs: cutoffAge,
      });

    expect(response.status).toBe(200);
    expect(response.body.deleted).toEqual([REF("1-1")]);
  });

  it("refuses a prefix outside refs/prism/checkpoints/", async () => {
    const repo = makeRepo();
    const response = await request(app)
      .post("/agentic/git/snapshot/delete")
      .send({ workspaceRoot: repo, prefix: "refs/heads/" });
    expect(response.status).toBe(400);
    expect(git(repo, ["rev-parse", "--verify", "main"]).trim()).not.toBe("");
  });
});
