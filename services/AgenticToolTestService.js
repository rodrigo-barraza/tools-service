// ============================================================
// Agentic Tool Test Service — Smoke Tests for Agent Tools
// ============================================================
// Provides predefined, non-destructive smoke tests for each
// agentic tool. Tests run in the configured workspace root
// using temporary fixtures that are automatically cleaned up.
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
} from "./AgenticFileService.js";
import { agenticFetchUrl, agenticWebSearch } from "./AgenticWebService.js";
import { executeCommand } from "./AgenticCommandService.js";
import { agenticGitStatus } from "./AgenticGitService.js";
import { agenticProjectSummary } from "./AgenticProjectService.js";
import { agenticLspAction } from "./AgenticLspService.js";
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
  try { await unlink(FIXTURE_FILE); } catch { /* ignore */ }
  try {
    const { rmdir } = await import("node:fs/promises");
    await rmdir(FIXTURE_DIR);
  } catch { /* ignore */ }
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

const TESTS = {
  // ── File Operations ──────────────────────────────────────

  read_file: () =>
    runTest("read_file", () =>
      agenticReadFile({ filePath: FIXTURE_FILE }),
    ),

  write_file: () =>
    runTest("write_file", async () => {
      const testFile = join(FIXTURE_DIR, "write_test.txt");
      const result = await agenticWriteFile({
        filePath: testFile,
        content: "smoke test\n",
      });
      // Cleanup
      try { await unlink(testFile); } catch { /* ignore */ }
      return result;
    }),

  list_directory: () =>
    runTest("list_directory", () =>
      agenticListDirectory({ dirPath: FIXTURE_DIR }),
    ),

  grep_search: () =>
    runTest("grep_search", () =>
      agenticGrepSearch({
        searchPath: FIXTURE_DIR,
        query: "greet",
      }),
    ),

  glob_files: () =>
    runTest("glob_files", () =>
      agenticGlobFiles({ pattern: "*.js", searchPath: FIXTURE_DIR }),
    ),

  multi_file_read: () =>
    runTest("multi_file_read", () =>
      agenticMultiFileRead({ filePaths: [FIXTURE_FILE] }),
    ),

  file_info: () =>
    runTest("file_info", () =>
      agenticFileInfo({ filePath: FIXTURE_FILE }),
    ),

  delete_file: () =>
    runTest("delete_file", async () => {
      // Create a temp file to delete
      const tempFile = join(FIXTURE_DIR, "delete_test.txt");
      await writeFile(tempFile, "to be deleted\n", "utf-8");
      return agenticDeleteFile({ filePath: tempFile });
    }),

  // ── Search & Discovery ───────────────────────────────────

  project_summary: () =>
    runTest("project_summary", () =>
      agenticProjectSummary({ dirPath: FIXTURE_DIR }),
    ),

  // ── Web ──────────────────────────────────────────────────

  fetch_url: () =>
    runTest("fetch_url", () =>
      agenticFetchUrl({ url: "https://httpbin.org/get", maxLength: 500 }),
    ),

  web_search: () =>
    runTest("web_search", () =>
      agenticWebSearch({ query: "test", limit: 1 }),
    ),

  // ── Command Execution ────────────────────────────────────

  run_command: () =>
    runTest("run_command", () =>
      executeCommand({ command: "echo", args: ["smoke-test-ok"], timeout: 5000 }),
    ),

  // ── Git ──────────────────────────────────────────────────

  git: () =>
    runTest("git", () =>
      agenticGitStatus({ repoPath: resolve(WORKSPACE_ROOTS[0]) }),
    ),

  // ── Code Intelligence (LSP) ──────────────────────────────

  lsp_action: () =>
    runTest("lsp_action", () =>
      agenticLspAction({
        operation: "documentSymbol",
        filePath: FIXTURE_FILE,
      }),
    ),
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
