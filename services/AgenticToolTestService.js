// ============================================================
// Agentic Tool Test Service — Smoke Tests for Agent Tools
// ============================================================
// Provides predefined, non-destructive smoke tests for each
// agentic tool with the "coding" label. Tests run in the
// configured workspace root using temporary fixtures that are
// automatically cleaned up.
//
// Each test returns { success, duration, message, details }.
// ============================================================

import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  agenticReadFile,
  agenticListDirectory,
  agenticGrepSearch,
  agenticGlobFiles,
  agenticMultiFileRead,
  agenticFileInfo,
  agenticWriteFile,
  agenticDeleteFile,
  agenticStrReplace,
  agenticPatchFile,
  agenticFileDiff,
  agenticMoveFile,
} from "./AgenticFileService.js";
import { agenticFetchUrl, agenticWebSearch } from "./AgenticWebService.js";
import { executeCommand } from "./AgenticCommandService.js";
import { agenticProjectSummary } from "./AgenticProjectService.js";
import { agenticToolSearch } from "./AgenticToolSearchService.js";
import { WORKSPACE_ROOTS } from "../secrets.js";

// ── Test Fixture ─────────────────────────────────────────────

const FIXTURE_DIR = join(resolve(WORKSPACE_ROOTS[0]), ".tool-test-fixtures");
const FIXTURE_FILE = join(FIXTURE_DIR, "test_fixture.js");
const FIXTURE_CONTENT = `// Tool test fixture — auto-generated, safe to delete
export function greet(name) {
  return \`Hello, \${name}!\`;
}

export const PI = 3.14159;

export class Calculator {
  add(a, b) { return a + b; }
  subtract(a, b) { return a - b; }
}
`;

async function ensureFixture() {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(FIXTURE_FILE, FIXTURE_CONTENT, "utf-8");
}

async function cleanupFixture() {
  // Remove any leftover test files
  const candidates = [
    FIXTURE_FILE,
    join(FIXTURE_DIR, "write_test.txt"),
    join(FIXTURE_DIR, "delete_test.txt"),
    join(FIXTURE_DIR, "move_src.txt"),
    join(FIXTURE_DIR, "move_dst.txt"),
    join(FIXTURE_DIR, "str_replace_test.js"),
    join(FIXTURE_DIR, "patch_test.js"),
    join(FIXTURE_DIR, "diff_b.js"),
  ];
  for (const f of candidates) {
    try { await unlink(f); } catch { /* ignore */ }
  }
  try {
    const { rmdir } = await import("node:fs/promises");
    await rmdir(FIXTURE_DIR);
  } catch { /* ignore — dir might not be empty */ }
}

// ── Test Runner ──────────────────────────────────────────────

async function runTest(name, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);

    // Check if the service returned an error object
    if (result?.error) {
      return {
        tool: name,
        success: false,
        duration,
        message: result.error,
        details: result,
      };
    }

    return {
      tool: name,
      success: true,
      duration,
      message: "OK",
      details: result,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    return {
      tool: name,
      success: false,
      duration,
      message: error.message || String(error),
    };
  }
}

// ── Test Definitions ─────────────────────────────────────────
// Every tool with label "coding" in TOOL_LABELS gets a test.
// Tests call the actual service functions with correct positional
// argument signatures.
//
// Grouped by domain for readability.

const TESTS = {
  // ── File Operations ──────────────────────────────────────

  read_file: () =>
    runTest("read_file", () =>
      agenticReadFile(FIXTURE_FILE),
    ),

  write_file: () =>
    runTest("write_file", async () => {
      const testFile = join(FIXTURE_DIR, "write_test.txt");
      const result = await agenticWriteFile(testFile, "smoke test\n");
      try { await unlink(testFile); } catch { /* ignore */ }
      return result;
    }),

  str_replace_file: () =>
    runTest("str_replace_file", async () => {
      // Create a dedicated copy for this test
      const testFile = join(FIXTURE_DIR, "str_replace_test.js");
      await writeFile(testFile, FIXTURE_CONTENT, "utf-8");
      const result = await agenticStrReplace(testFile, "3.14159", "3.14");
      try { await unlink(testFile); } catch { /* ignore */ }
      return result;
    }),

  patch_file: () =>
    runTest("patch_file", async () => {
      const testFile = join(FIXTURE_DIR, "patch_test.js");
      await writeFile(testFile, "line1\nline2\nline3\n", "utf-8");
      // agenticPatchFile expects a unified diff string
      const unifiedPatch =
        "--- a/patch_test.js\n" +
        "+++ b/patch_test.js\n" +
        "@@ -1,3 +1,3 @@\n" +
        " line1\n" +
        "-line2\n" +
        "+PATCHED\n" +
        " line3\n";
      const result = await agenticPatchFile(testFile, unifiedPatch);
      try { await unlink(testFile); } catch { /* ignore */ }
      return result;
    }),

  multi_file_read: () =>
    runTest("multi_file_read", () =>
      agenticMultiFileRead([FIXTURE_FILE]),
    ),

  file_info: () =>
    runTest("file_info", () =>
      agenticFileInfo([FIXTURE_FILE]),
    ),

  file_diff: () =>
    runTest("file_diff", async () => {
      const fileB = join(FIXTURE_DIR, "diff_b.js");
      await writeFile(fileB, FIXTURE_CONTENT.replace("3.14159", "2.71828"), "utf-8");
      const result = await agenticFileDiff(FIXTURE_FILE, { pathB: fileB });
      try { await unlink(fileB); } catch { /* ignore */ }
      return result;
    }),

  move_file: () =>
    runTest("move_file", async () => {
      const src = join(FIXTURE_DIR, "move_src.txt");
      const dst = join(FIXTURE_DIR, "move_dst.txt");
      await writeFile(src, "move test\n", "utf-8");
      const result = await agenticMoveFile(src, dst);
      // Cleanup destination
      try { await unlink(dst); } catch { /* ignore */ }
      try { await unlink(src); } catch { /* ignore */ }
      return result;
    }),

  delete_file: () =>
    runTest("delete_file", async () => {
      const tempFile = join(FIXTURE_DIR, "delete_test.txt");
      await writeFile(tempFile, "to be deleted\n", "utf-8");
      return agenticDeleteFile(tempFile);
    }),

  // ── Search & Discovery ───────────────────────────────────

  list_directory: () =>
    runTest("list_directory", () =>
      agenticListDirectory(FIXTURE_DIR),
    ),

  grep_search: () =>
    runTest("grep_search", () =>
      agenticGrepSearch("greet", FIXTURE_DIR),
    ),

  glob_files: () =>
    runTest("glob_files", () =>
      agenticGlobFiles("*.js", FIXTURE_DIR),
    ),

  project_summary: () =>
    runTest("project_summary", () =>
      agenticProjectSummary(resolve(WORKSPACE_ROOTS[0])),
    ),

  // ── Web ──────────────────────────────────────────────────

  fetch_url: () =>
    runTest("fetch_url", () =>
      agenticFetchUrl("https://httpbin.org/get"),
    ),

  web_search: () =>
    runTest("web_search", () =>
      agenticWebSearch("test", { limit: 1 }),
    ),

  // ── Command Execution ────────────────────────────────────

  run_command: () =>
    runTest("run_command", () =>
      executeCommand("ls -la", {
        cwd: resolve(WORKSPACE_ROOTS[0]),
        timeout: 5000,
      }),
    ),



  // ── Tool Discovery (meta) ────────────────────────────────

  tool_search: () =>
    runTest("tool_search", () => {
      // Synchronous — returns directly
      return agenticToolSearch("file", { label: "coding", limit: 5 });
    }),
};

// ── Public API ───────────────────────────────────────────────

/**
 * Run a smoke test for a single tool.
 *
 * @param {string} toolName
 * @returns {Promise<object>} { tool, success, duration, message, details? }
 */
export async function testTool(toolName) {
  const testFn = TESTS[toolName];
  if (!testFn) {
    return {
      tool: toolName,
      success: false,
      duration: 0,
      message: `No smoke test defined for '${toolName}'`,
    };
  }

  try {
    await ensureFixture();
    const result = await testFn();
    return result;
  } finally {
    await cleanupFixture();
  }
}

/**
 * Run smoke tests for all tools (or a subset).
 *
 * @param {string[]} [toolNames] — if omitted, runs all
 * @returns {Promise<object[]>} array of test results
 */
export async function testAllTools(toolNames) {
  const names = toolNames || Object.keys(TESTS);
  try {
    await ensureFixture();

    const results = [];
    for (const name of names) {
      const testFn = TESTS[name];
      if (!testFn) {
        results.push({
          tool: name,
          success: false,
          duration: 0,
          message: `No smoke test defined for '${name}'`,
        });
        continue;
      }

      // Re-create fixture between tests in case a previous test mutated it
      await ensureFixture();
      results.push(await testFn());
    }

    return results;
  } finally {
    await cleanupFixture();
  }
}

/**
 * Get list of tools that have smoke tests.
 *
 * @returns {string[]}
 */
export function getTestableTools() {
  return Object.keys(TESTS);
}
