import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";

// Worktrees land under this test's own temp dir, not the shared
// /tmp/prism-worktrees (config.ts reads WORKTREE_DIR at import).
const { worktreeBase } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = mkdtempSync(join(tmpdir(), "worktree-base-"));
  process.env.WORKTREE_DIR = base;
  return { worktreeBase: base };
});

import { createTestApp } from "./testApp.ts";
import { ALLOWED_ROOTS } from "../src/services/AgenticFileService.ts";
import {
  agenticGitWorktreeCreate,
  agenticGitWorktreeCommit,
  agenticGitWorktreeMerge,
  agenticGitWorktreeRemove,
  type WorktreeDiff,
} from "../src/services/AgenticGitService.ts";

/**
 * The diff contract prism-service's sub-agent merge-back consumes. The SAME
 * bytes live in prism-service/tests/fixtures/worktree-diff-contract.json; both
 * repos pin this hash, so editing one copy fails until the other matches.
 */
const CONTRACT_FIXTURE = join(
  import.meta.dirname,
  "fixtures",
  "worktree-diff-contract.json",
);
const CONTRACT_FIXTURE_SHA256 =
  "8d3de76a47c14c60b26c8b4176a6c0262f7d1f0014f232f3a36a2ac74c10460d";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...IDENTITY },
  });
}

const tempDirs: string[] = [worktreeBase];

/** A repo on `main` with three files and one commit, under an allowed root. */
function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-repo-")));
  tempDirs.push(dir);
  if (!ALLOWED_ROOTS.includes(dir)) ALLOWED_ROOTS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, "change.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "remove.txt"), "remove me\n");
  writeFileSync(join(dir, "keep.txt"), "keep\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

function branches(repo: string): string[] {
  return git(repo, ["branch", "--format=%(refname:short)"])
    .split("\n")
    .filter(Boolean);
}

/** The contract scenario: one added, one modified and one deleted file. */
function editLikeASubAgent(worktreePath: string) {
  mkdirSync(join(worktreePath, "notes"), { recursive: true });
  writeFileSync(join(worktreePath, "notes/hello.txt"), "hello from a sub-agent\n");
  writeFileSync(join(worktreePath, "change.txt"), "one\n2\nthree\n");
  unlinkSync(join(worktreePath, "remove.txt"));
}

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

describe("git worktree create — the branch is the name asked for", () => {
  it("creates `orchestrator/abc` (not `orchestrator_abc`) and returns that name", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/abc");

    expect(created.error).toBeUndefined();
    expect(created.branch).toBe("orchestrator/abc");
    expect(branches(repo)).toContain("orchestrator/abc");
    expect(git(created.worktreePath!, ["branch", "--show-current"]).trim()).toBe(
      "orchestrator/abc",
    );
  });

  it.each([
    ["a space", "orchestrator/has space"],
    ["'..'", "orchestrator/a..b"],
    ["a leading '-'", "-orchestrator"],
    ["'@{-1}' (expands to another branch)", "@{-1}"],
  ])("rejects a name with %s, clearly and without creating anything", async (_label, name) => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, name);

    expect(created.error).toMatch(/branch name/);
    expect(created.worktreePath).toBeUndefined();
    expect(branches(repo)).toEqual(["main"]);
  });
});

describe("POST /agentic/git/worktree/diff — the contract", () => {
  it("returns added, modified and deleted files with their statuses — exactly the pinned fixture", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/agent-contract");
    editLikeASubAgent(created.worktreePath!);
    const commit = await agenticGitWorktreeCommit(
      repo,
      created.worktreePath!,
      "orchestrator: contract",
    );
    expect(commit).toMatchObject({ branch: "orchestrator/agent-contract", committed: true });

    const response = await request(app)
      .post("/agentic/git/worktree/diff")
      .send({ path: repo, branch: "orchestrator/agent-contract" });

    expect(response.status).toBe(200);
    const body = response.body as WorktreeDiff;
    expect(body.files).toEqual([
      { path: "change.txt", status: "modified" },
      { path: "notes/hello.txt", status: "added" },
      { path: "remove.txt", status: "deleted" },
    ]);
    expect(body.stats).toEqual({ filesChanged: 3, additions: 2, deletions: 2 });
    expect(body).toEqual(JSON.parse(readFileSync(CONTRACT_FIXTURE, "utf8")));
  });

  it("the fixture is the one prism-service pins (same bytes, same hash)", () => {
    const digest = createHash("sha256")
      .update(readFileSync(CONTRACT_FIXTURE))
      .digest("hex");
    expect(digest).toBe(CONTRACT_FIXTURE_SHA256);
  });

  it("reports a renamed file with its previous path", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/renamer");
    git(created.worktreePath!, ["mv", "keep.txt", "kept.txt"]);
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "rename");

    const response = await request(app)
      .post("/agentic/git/worktree/diff")
      .send({ path: repo, branch: "orchestrator/renamer" });

    expect(response.body.files).toEqual([
      { path: "kept.txt", status: "renamed", previousPath: "keep.txt" },
    ]);
  });

  it("an unknown branch is an error, not an empty diff", async () => {
    const repo = makeRepo();
    const response = await request(app)
      .post("/agentic/git/worktree/diff")
      .send({ path: repo, branch: "orchestrator/never-created" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/bad revision|unknown revision/);
    expect(response.body.files).toBeUndefined();
  });
});

describe("git worktree commit", () => {
  it("a clean worktree commits nothing and says so", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/clean");
    const commit = await agenticGitWorktreeCommit(repo, created.worktreePath!, "nothing");

    expect(commit).toEqual({ branch: "orchestrator/clean", committed: false });
  });

  it("only commits in a worktree git registered for that repo", async () => {
    const repo = makeRepo();
    const other = makeRepo();
    const commit = await agenticGitWorktreeCommit(repo, other, "not mine");

    expect(commit.error).toMatch(/not a linked worktree/);
  });

  it("commits a message with quotes and $(...) verbatim — no shell", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/quoting");
    writeFileSync(join(created.worktreePath!, "x.txt"), "x\n");
    const message = `orchestrator: "quoted" $(touch pwned) — done`;
    await agenticGitWorktreeCommit(repo, created.worktreePath!, message);

    expect(git(created.worktreePath!, ["log", "-1", "--format=%s"]).trim()).toBe(message);
    expect(existsSync(join(created.worktreePath!, "pwned"))).toBe(false);
  });
});

describe("merge-back and safe cleanup", () => {
  it("merges the branch into the repo's current branch, then removes the worktree and deletes the branch", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/merged");
    editLikeASubAgent(created.worktreePath!);
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "edits");

    const merged = await agenticGitWorktreeMerge(repo, "orchestrator/merged", {
      message: "merge sub-agent",
    });
    expect(merged).toMatchObject({ merged: "orchestrator/merged", into: "main" });
    expect(readFileSync(join(repo, "notes/hello.txt"), "utf8")).toBe("hello from a sub-agent\n");

    const removed = await agenticGitWorktreeRemove(repo, created.worktreePath!);
    expect(removed).toMatchObject({ branch: "orchestrator/merged", branchDeleted: true });
    expect(existsSync(created.worktreePath!)).toBe(false);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("an empty diff cleans up: worktree removed, branch deleted", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/empty");
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "nothing");

    const removed = await agenticGitWorktreeRemove(repo, created.worktreePath!);
    expect(removed).toMatchObject({ branchDeleted: true });
    expect(branches(repo)).toEqual(["main"]);
  });

  it("never removes over unmerged commits unless forced: worktree AND branch kept", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/unmerged");
    editLikeASubAgent(created.worktreePath!);
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "edits");

    const removed = await agenticGitWorktreeRemove(repo, created.worktreePath!);
    expect(removed.kept).toBe(true);
    expect(removed.error).toMatch(/does not contain/);
    expect(existsSync(join(created.worktreePath!, "notes/hello.txt"))).toBe(true);
    expect(branches(repo)).toContain("orchestrator/unmerged");

    const forced = await agenticGitWorktreeRemove(repo, created.worktreePath!, { force: true });
    expect(forced).toMatchObject({ branchDeleted: true });
    expect(branches(repo)).toEqual(["main"]);
  });

  it("never removes over uncommitted edits unless forced", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/dirty");
    writeFileSync(join(created.worktreePath!, "draft.txt"), "not committed\n");

    const removed = await agenticGitWorktreeRemove(repo, created.worktreePath!);
    expect(removed.kept).toBe(true);
    expect(existsSync(join(created.worktreePath!, "draft.txt"))).toBe(true);
    expect(branches(repo)).toContain("orchestrator/dirty");
  });

  it("the remove route is safe by default too (no --force, no branch -D)", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/route");
    editLikeASubAgent(created.worktreePath!);
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "edits");

    const response = await request(app)
      .post("/agentic/git/worktree/remove")
      .send({ path: repo, worktreePath: created.worktreePath });

    expect(response.status).toBe(400);
    expect(response.body.kept).toBe(true);
    expect(branches(repo)).toContain("orchestrator/route");
  });

  it("a conflicting merge is aborted, names the files, and leaves the parent tree as it was", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/conflict");
    writeFileSync(join(created.worktreePath!, "change.txt"), "one\nsub-agent\nthree\n");
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "sub-agent edit");
    writeFileSync(join(repo, "change.txt"), "one\nparent\nthree\n");
    git(repo, ["commit", "-qam", "parent edit"]);
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    const merged = await agenticGitWorktreeMerge(repo, "orchestrator/conflict");

    expect(merged).toMatchObject({ reason: "conflict", conflictingFiles: ["change.txt"] });
    expect(merged.error).toMatch(/aborted/);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(repo, "change.txt"), "utf8")).toBe("one\nparent\nthree\n");
  });

  it("a merge blocked by the parent's uncommitted edit names the file and touches nothing", async () => {
    const repo = makeRepo();
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/blocked");
    writeFileSync(join(created.worktreePath!, "change.txt"), "one\nsub-agent\nthree\n");
    await agenticGitWorktreeCommit(repo, created.worktreePath!, "sub-agent edit");
    writeFileSync(join(repo, "change.txt"), "one\nparent, uncommitted\nthree\n");

    const merged = await agenticGitWorktreeMerge(repo, "orchestrator/blocked");

    expect(merged).toMatchObject({ reason: "local-changes", conflictingFiles: ["change.txt"] });
    expect(readFileSync(join(repo, "change.txt"), "utf8")).toBe("one\nparent, uncommitted\nthree\n");
  });

  it("commits and merges in a repo with no identity configured", async () => {
    const repo = makeRepo();
    git(repo, ["config", "--unset", "user.email"]);
    git(repo, ["config", "--unset", "user.name"]);
    // No guessing user@hostname: without an identity, git must refuse.
    git(repo, ["config", "user.useConfigOnly", "true"]);
    const created = await agenticGitWorktreeCreate(repo, "orchestrator/anonymous");
    writeFileSync(join(created.worktreePath!, "x.txt"), "x\n");

    const env = { ...process.env };
    for (const key of Object.keys(IDENTITY)) delete process.env[key];
    process.env.HOME = worktreeBase; // no ~/.gitconfig identity either
    process.env.XDG_CONFIG_HOME = worktreeBase;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    try {
      const commit = await agenticGitWorktreeCommit(repo, created.worktreePath!, "anon");
      expect(commit).toMatchObject({ committed: true });
      const merged = await agenticGitWorktreeMerge(repo, "orchestrator/anonymous");
      expect(merged.error).toBeUndefined();
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in env)) delete process.env[key];
      }
      Object.assign(process.env, env);
    }
  });
});
