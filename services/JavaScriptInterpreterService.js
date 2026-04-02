// ============================================================
// JavaScript Interpreter Service — Sandboxed Code Execution
// ============================================================
// Executes arbitrary JavaScript code in Node's vm module with:
//   - Configurable timeout (default 5s, max 30s)
//   - No access to process, require, import, fetch, etc.
//   - Separate stdout capture via console.log override
//   - Execution time measurement
//
// Much faster than spawning a Python subprocess (~0ms spawn
// vs ~100ms subprocess). Use for quick data transforms, JSON
// manipulation, regex, and math that the LLM can naturally
// express in JavaScript.
// ============================================================

import vm from "node:vm";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB max stdout

// ────────────────────────────────────────────────────────────
// Safe Globals — what the sandbox can access
// ────────────────────────────────────────────────────────────

function buildSafeGlobals(outputBuffer) {
  let outputLen = 0;

  const safePrint = (...args) => {
    if (outputLen >= MAX_OUTPUT_BYTES) return;
    const line = args
      .map((a) =>
        typeof a === "string" ? a : JSON.stringify(a, null, 2) ?? String(a),
      )
      .join(" ");
    outputBuffer.push(line);
    outputLen += line.length;
  };

  return {
    // Console — only log/warn/error (all go to output buffer)
    console: {
      log: safePrint,
      warn: safePrint,
      error: safePrint,
      info: safePrint,
      dir: (...args) =>
        safePrint(
          ...args.map((a) => JSON.stringify(a, null, 2) ?? String(a)),
        ),
      table: (data) => safePrint(JSON.stringify(data, null, 2)),
    },

    // Safe built-ins
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Symbol,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Proxy,
    Reflect,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    EvalError,
    Infinity,
    NaN,
    undefined,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    structuredClone,
    queueMicrotask,

    // Typed arrays (useful for binary/numeric work)
    ArrayBuffer,
    SharedArrayBuffer,
    DataView,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    BigInt,

    // Text encoding
    TextEncoder,
    TextDecoder,

    // Timing (useful for perf measurement)
    performance: { now: () => performance.now() },

    // Explicitly blocked (so errors are clear)
    require: undefined,
    process: undefined,
    globalThis: undefined,
    global: undefined,
    fetch: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    clearImmediate: undefined,
  };
}

// ────────────────────────────────────────────────────────────
// Execution Engine
// ────────────────────────────────────────────────────────────

/**
 * Execute JavaScript code in a sandboxed vm context.
 *
 * @param {string} code - JavaScript source code to execute
 * @param {object} [options]
 * @param {number} [options.timeout=5000] - Execution timeout in ms (max 30000)
 * @returns {{
 *   success: boolean,
 *   output: string,
 *   result: *,
 *   executionTimeMs: number,
 *   timedOut: boolean,
 *   error?: string
 * }}
 */
export function executeJavaScript(code, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const clampedTimeout = Math.min(Math.max(timeout, 100), MAX_TIMEOUT_MS);
  const startTime = performance.now();
  const outputBuffer = [];

  try {
    const sandbox = buildSafeGlobals(outputBuffer);
    const context = vm.createContext(sandbox);

    const result = vm.runInContext(code, context, {
      timeout: clampedTimeout,
      displayErrors: true,
      breakOnSigint: true,
    });

    const executionTimeMs = Math.round(performance.now() - startTime);
    const output = outputBuffer.join("\n");

    // Serialize the result for JSON transport
    let serializedResult;
    if (result === undefined) {
      serializedResult = undefined;
    } else if (typeof result === "bigint") {
      serializedResult = result.toString();
    } else {
      try {
        // Test if it's JSON-safe
        JSON.stringify(result);
        serializedResult = result;
      } catch {
        serializedResult = String(result);
      }
    }

    return {
      success: true,
      output: output.length > MAX_OUTPUT_BYTES
        ? output.slice(0, MAX_OUTPUT_BYTES) + "\n... [output truncated]"
        : output,
      result: serializedResult,
      executionTimeMs,
      timedOut: false,
    };
  } catch (err) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const timedOut =
      err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ||
      err.message?.includes("Script execution timed out");

    return {
      success: false,
      output: outputBuffer.join("\n"),
      result: null,
      executionTimeMs,
      timedOut,
      error: timedOut
        ? `Execution timed out after ${clampedTimeout}ms`
        : `${err.constructor.name}: ${err.message}`,
    };
  }
}

/**
 * Get interpreter metadata for health checks.
 */
export function getJsInterpreterInfo() {
  return {
    available: true,
    runtime: "Node.js vm",
    nodeVersion: process.version,
    maxTimeoutMs: MAX_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  };
}
