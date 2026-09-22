// ────────────────────────────────────────────────────────────
// Custom Tool Execution Tests
// ────────────────────────────────────────────────────────────
// Validates the custom tool sandbox execution:
//   1. Expression-based tools (last expression is the result)
//   2. Return-based tools (IIFE wrapping supports `return`)
//   3. Args injection (args object available in sandbox)
//   4. Error handling (syntax errors, runtime errors, timeouts)
//   5. Security (no fs, require, fetch, etc.)
//   6. Route-level integration (POST /agentic/custom-tool/execute)
// ────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { executeJavaScript } from "../src/services/JavaScriptInterpreterService.ts";

interface CustomWeekYearResult {
  week: number;
  year: number;
}

// ── Unit: JavaScriptInterpreterService ──────────────────────

describe("JavaScriptInterpreterService — custom tool patterns", () => {

  // ── Expression-based tools ────────────────────────────────

  it("captures the last expression as the result", () => {
    const { success, result } = executeJavaScript("2 + 2");
    expect(success).toBe(true);
    expect(result).toBe(4);
  });

  it("captures a complex object as the last expression", () => {
    const code = `
      const x = 42;
      const y = "hello";
      ({ value: x, label: y })
    `;
    const { success, result } = executeJavaScript(code);
    expect(success).toBe(true);
    expect(result).toEqual({ value: 42, label: "hello" });
  });

  it("captures undefined when there is no last expression value", () => {
    const { success, result } = executeJavaScript("const x = 5;");
    expect(success).toBe(true);
    expect(result).toBeUndefined();
  });

  // ── Return-based tools (IIFE-wrapped) ─────────────────────

  it("supports return statements inside an IIFE wrapper", () => {
    // This mirrors how the /custom-tool/execute endpoint wraps code
    const code = `(function() {
      const week = 20;
      return { week, year: 2026 };
    })()`;
    const { success, result } = executeJavaScript(code);
    expect(success).toBe(true);
    expect(result).toEqual({ week: 20, year: 2026 });
  });

  it("supports early return in IIFE for conditional logic", () => {
    const code = `(function() {
      const args = { value: 5 };
      if (args.value > 10) return { status: "high" };
      return { status: "low" };
    })()`;
    const { success, result } = executeJavaScript(code);
    expect(success).toBe(true);
    expect(result).toEqual({ status: "low" });
  });

  it("fails with SyntaxError when return is used at top level (no IIFE)", () => {
    const { success, error } = executeJavaScript("return 42;");
    expect(success).toBe(false);
    expect(error).toMatch(/SyntaxError/);
  });

  // ── Args injection ────────────────────────────────────────

  it("injects args as a global variable via JSON.stringify", () => {
    const args = { name: "world", count: 3 };
    const code = `const args = ${JSON.stringify(args)};\nargs.name + " " + args.count`;
    const { success, result } = executeJavaScript(code);
    expect(success).toBe(true);
    expect(result).toBe("world 3");
  });

  it("handles empty args object", () => {
    const code = `const args = {};\nObject.keys(args).length`;
    const { success, result } = executeJavaScript(code);
    expect(success).toBe(true);
    expect(result).toBe(0);
  });

  // ── Real-world custom tool: get_week_of_year ──────────────

  it("executes a real custom tool (get_week_of_year) with IIFE wrapper", () => {
    const args = { date: "2026-05-16T12:00:00Z" };
    const toolCode = `
const { date } = args;
const d = date ? new Date(date) : new Date();
const target = new Date(d);
target.setDate(target.getDate() + (4 - target.getDay()));
const jan4 = new Date(target.getFullYear(), 0, 4);
const diff = target - jan4;
const oneWeek = 7 * 24 * 60 * 60 * 1000;
const weekNum = Math.floor(diff / oneWeek) + 1;
return { week: weekNum, year: d.getFullYear() };
    `;
    // Wrap exactly as the execute endpoint does
    const wrappedCode = `const args = ${JSON.stringify(args)};\n(function() {\n${toolCode}\n})()`;
    const { success, result } = executeJavaScript(wrappedCode);
    expect(success).toBe(true);
    const weekYearResult = result as CustomWeekYearResult;
    expect(typeof weekYearResult.week).toBe("number");
    expect(weekYearResult.week).toBeGreaterThanOrEqual(1);
    expect(weekYearResult.week).toBeLessThanOrEqual(53);
    expect(weekYearResult.year).toBe(2026);
  });

  it("executes a real custom tool (celsius_to_fahrenheit) with return", () => {
    const args = { celsius: 100 };
    const toolCode = `return args.celsius * 9/5 + 32;`;
    const wrappedCode = `const args = ${JSON.stringify(args)};\n(function() {\n${toolCode}\n})()`;
    const { success, result } = executeJavaScript(wrappedCode);
    expect(success).toBe(true);
    expect(result).toBe(212);
  });

  // ── Console output capture ────────────────────────────────

  it("captures console.log output in the output field", () => {
    const code = `console.log("hello"); console.log("world"); 42`;
    const { success, output, result } = executeJavaScript(code);
    expect(success).toBe(true);
    expect(output).toBe("hello\nworld");
    expect(result).toBe(42);
  });

  // ── Error handling ────────────────────────────────────────

  it("returns error for syntax errors", () => {
    const { success, error } = executeJavaScript("function { bad }");
    expect(success).toBe(false);
    expect(error).toMatch(/SyntaxError/);
  });

  it("returns error for runtime errors (undefined variable)", () => {
    const { success, error } = executeJavaScript("nonExistentVariable.foo");
    expect(success).toBe(false);
    expect(error).toMatch(/ReferenceError|TypeError/);
  });

  it("returns error for division by zero edge case (Infinity is valid)", () => {
    const { success, result } = executeJavaScript("1 / 0");
    expect(success).toBe(true);
    expect(result).toBe(Infinity);
  });

  // ── Security: blocked globals ─────────────────────────────

  it("blocks require()", () => {
    const { success, error } = executeJavaScript("require('fs')");
    expect(success).toBe(false);
    expect(error).toMatch(/TypeError|require is not a function|undefined/);
  });

  it("blocks fetch()", () => {
    const { success, error } = executeJavaScript("fetch('http://evil.com')");
    expect(success).toBe(false);
    expect(error).toMatch(/TypeError|fetch is not a function|undefined/);
  });

  it("blocks process access", () => {
    const { success, error } = executeJavaScript("process.exit(1)");
    expect(success).toBe(false);
    expect(error).toMatch(/TypeError|Cannot read/);
  });

  it("blocks setTimeout", () => {
    const { success, error } = executeJavaScript("setTimeout(() => {}, 100)");
    expect(success).toBe(false);
    expect(error).toMatch(/TypeError|setTimeout is not a function|undefined/);
  });

  // ── Timeout ───────────────────────────────────────────────

  it("times out on infinite loops", () => {
    const { success, timedOut } = executeJavaScript("while(true) {}", { timeout: 200 });
    expect(success).toBe(false);
    expect(timedOut).toBe(true);
  });
});

// ── Unit: Privileged Execution Tier ─────────────────────────

describe("JavaScriptInterpreterService — privileged execution tier", () => {

  it("allows require() in privileged mode", () => {
    const code = `const path = require("path"); path.basename("/foo/bar.txt")`;
    const { success, result } = executeJavaScript(code, { execution: "privileged" });
    expect(success).toBe(true);
    expect(result).toBe("bar.txt");
  });

  it("allows process access in privileged mode", () => {
    const code = `process.version`;
    const { success, result } = executeJavaScript(code, { execution: "privileged" });
    expect(success).toBe(true);
    expect(result).toMatch(/^v\d+/);
  });

  it("allows Buffer in privileged mode", () => {
    const code = `Buffer.from("hello").toString("base64")`;
    const { success, result } = executeJavaScript(code, { execution: "privileged" });
    expect(success).toBe(true);
    expect(result).toBe("aGVsbG8=");
  });

  it("allows URL in privileged mode", () => {
    const code = `new URL("https://example.com/path?q=test").hostname`;
    const { success, result } = executeJavaScript(code, { execution: "privileged" });
    expect(success).toBe(true);
    expect(result).toBe("example.com");
  });

  it("includes execution tier in the response", () => {
    const sandboxed = executeJavaScript("1 + 1", { execution: "sandboxed" });
    const privileged = executeJavaScript("1 + 1", { execution: "privileged" });
    expect(sandboxed.execution).toBe("sandboxed");
    expect(privileged.execution).toBe("privileged");
  });

  it("defaults to sandboxed when execution is not specified", () => {
    const result = executeJavaScript("1 + 1");
    expect(result.execution).toBe("sandboxed");
  });

  it("still respects timeout in privileged mode", () => {
    const { success, timedOut } = executeJavaScript("while(true) {}", {
      timeout: 200,
      execution: "privileged",
    });
    expect(success).toBe(false);
    expect(timedOut).toBe(true);
  });

  it("still captures console output in privileged mode", () => {
    const code = `console.log("privileged output"); 99`;
    const { success, output, result } = executeJavaScript(code, { execution: "privileged" });
    expect(success).toBe(true);
    expect(output).toBe("privileged output");
    expect(result).toBe(99);
  });
});
