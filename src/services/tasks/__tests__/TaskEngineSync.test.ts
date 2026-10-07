import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The shared task engine is ONE module in two repositories
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// The workspace bridge (workspace-service) runs the same TaskEngine.ts and
// WorkspaceHooks.ts this service runs in local mode, so a command behaves
// the same whichever runs it. The copies must stay byte-identical: edit one,
// copy it over the other. Skipped, visibly, when there is no
// workspace-service checkout beside this one (a lone clone, a container).

const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The workspace-service checkout that belongs with this one:
 * `WORKSPACE_SERVICE_DIR`, else a worktree of the same name (the task branch,
 * or `batch`) beside this one's, else the bridge's main checkout next to
 * this repository's.
 */
function siblingBridgeCheckout(): string | null {
  const override = process.env.WORKSPACE_SERVICE_DIR;
  if (override) return existsSync(override) ? override : null;
  const worktree = SERVICE_ROOT.match(/^(.*)\/tools-service\/\.claude\/worktrees\/([^/]+)$/);
  const candidates = worktree
    ? [join(worktree[1], "workspace-service/.claude/worktrees", worktree[2]), join(worktree[1], "workspace-service")]
    : [join(dirname(SERVICE_ROOT), "workspace-service")];
  return candidates.find((candidate) => existsSync(join(candidate, "package.json"))) ?? null;
}

const BRIDGE = siblingBridgeCheckout();
const SHARED_FILES = ["TaskEngine.ts", "WorkspaceHooks.ts"];

describe("shared task engine", () => {
  for (const file of SHARED_FILES) {
    const theirs = BRIDGE && join(BRIDGE, "src/handlers", file);
    it.skipIf(!theirs || !existsSync(theirs))(
      `src/services/tasks/${file} is byte-identical to the bridge's (${theirs ?? "no workspace-service checkout"})`,
      () => {
        const ours = readFileSync(join(SERVICE_ROOT, "src/services/tasks", file), "utf8");
        expect(
          readFileSync(theirs!, "utf8") === ours,
          `copy tools-service/src/services/tasks/${file} over workspace-service/src/handlers/${file} (or the other way round)`,
        ).toBe(true);
      },
    );
  }
});
