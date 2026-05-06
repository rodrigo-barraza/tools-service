import { sleep } from "@rodrigo-barraza/utilities-library";
// ============================================================
// LSP Server Instance — Single Server Lifecycle Manager
// ============================================================
// Manages the lifecycle of a single LSP server process with
// state machine tracking, health monitoring, and retry logic.
//
// State transitions:
//   stopped → starting → running → stopping → stopped
//                     ↘ error ↗ (crash/timeout)
//   error → starting (on retry, if maxRestarts not exceeded)
//
// Adapted from Claude Code's LSPServerInstance.ts.
// ============================================================
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLspClient } from "./LspClient.js";

// ── Constants ────────────────────────────────────────────────
/** LSP error code for "content modified" — transient, safe to retry */
const LSP_ERROR_CONTENT_MODIFIED = -32801;
/** Maximum retries for transient errors */
const MAX_RETRIES_FOR_TRANSIENT = 3;
/** Base delay in ms for exponential backoff (500, 1000, 2000) */
const RETRY_BASE_DELAY_MS = 500;
/**
 * Creates and manages a single LSP server instance.
 *
 * @param {string} name — unique server identifier
 * @param {object} config — server config from lspConfig.js
 * @param {string} config.command — binary to run
 * @param {string[]} [config.args] — arguments
 * @param {Record<string,string>} [config.extensionToLanguage] — ext → languageId mapping
 * @param {string} [config.workspaceFolder] — workspace root
 * @param {number} [config.maxRestarts] — max restart attempts (default 3)
 * @param {number} [config.startupTimeout] — init timeout in ms
 * @param {Record<string,string>} [config.env] — extra env vars
 * @param {object} [config.initializationOptions] — server-specific init options
 * @returns {object} LSP server instance
 */
export function createLspServerInstance(name, config) {
  // ── Private state ────────────────────────────────────────
  let state = "stopped";
  let startTime = null;
  let lastError = null;
  let restartCount = 0;
  let crashRecoveryCount = 0;
  const client = createLspClient(name, (error) => {
    state = "error";
    lastError = error;
    crashRecoveryCount++;
  });
  // ── Lifecycle methods ────────────────────────────────────
  async function start() {
    if (state === "running" || state === "starting") return;
    // Guard: max crash recovery
    const maxRestarts = config.maxRestarts ?? 3;
    if (state === "error" && crashRecoveryCount > maxRestarts) {
      const error = new Error(`LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`);
      lastError = error;
      throw error;
    }
    let initPromise;
    try {
      state = "starting";
      console.log(`[LSP:${name}] Starting server instance...`);
      await client.start(config.command, config.args || [], {
        env: config.env,
        cwd: config.workspaceFolder,
      });
      // Build initialization params
      const workspaceFolder = config.workspaceFolder || process.cwd();
      const workspaceUri = pathToFileURL(workspaceFolder).href;
      const initParams = {
        processId: process.pid,
        initializationOptions: config.initializationOptions ?? {},
        // Modern (LSP 3.16+)
        workspaceFolders: [{
          uri: workspaceUri,
          name: resolve(workspaceFolder).split("/").pop() || "workspace",
        }],
        // Deprecated but needed by some servers
        rootPath: workspaceFolder,
        rootUri: workspaceUri,
        // Client capabilities
        capabilities: {
          workspace: {
            configuration: false,
            workspaceFolders: false,
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: { valueSet: [1, 2] },
              versionSupport: false,
              codeDescriptionSupport: true,
              dataSupport: false,
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ["markdown", "plaintext"],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            references: {
              dynamicRegistration: false,
            },
            implementation: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            callHierarchy: {
              dynamicRegistration: false,
            },
          },
          general: {
            positionEncodings: ["utf-16"],
          },
        },
      };
      initPromise = client.initialize(initParams);
      if (config.startupTimeout) {
        await withTimeout(
          initPromise,
          config.startupTimeout,
          `LSP server '${name}' timed out after ${config.startupTimeout}ms during initialization`,
        );
      } else {
        await initPromise;
      }
      state = "running";
      startTime = new Date();
      crashRecoveryCount = 0;
      console.log(`[LSP:${name}] Server running`);
    } catch (error) {
      // Clean up on failure
      client.stop().catch(() => {});
      initPromise?.catch(() => {});
      state = "error";
      lastError = error;
      console.error(`[LSP:${name}] Start failed: ${error.message}`);
      throw error;
    }
  }
  async function stop() {
    if (state === "stopped" || state === "stopping") return;
    try {
      state = "stopping";
      await client.stop();
      state = "stopped";
      console.log(`[LSP:${name}] Server stopped`);
    } catch (error) {
      state = "error";
      lastError = error;
      console.error(`[LSP:${name}] Stop failed: ${error.message}`);
      throw error;
    }
  }
  async function restart() {
    try {
      await stop();
    } catch (error) {
      console.error(`[LSP:${name}] Stop during restart failed: ${error.message}`);
      throw error;
    }
    restartCount++;
    const maxRestarts = config.maxRestarts ?? 3;
    if (restartCount > maxRestarts) {
      throw new Error(`Max restart attempts (${maxRestarts}) exceeded for server '${name}'`);
    }
    try {
      await start();
    } catch (error) {
      console.error(`[LSP:${name}] Start during restart failed (attempt ${restartCount}/${maxRestarts}): ${error.message}`);
      throw error;
    }
  }
  function isHealthy() {
    return state === "running" && client.isInitialized;
  }
  /**
   * Send an LSP request with exponential backoff retry on transient errors.
   */
  async function sendRequest(method, params) {
    if (!isHealthy()) {
      throw new Error(
        `Cannot send request to LSP server '${name}': server is ${state}` +
        (lastError ? `, last error: ${lastError.message}` : ""),
      );
    }
    let lastAttemptError;
    for (let attempt = 0; attempt <= MAX_RETRIES_FOR_TRANSIENT; attempt++) {
      try {
        return await client.sendRequest(method, params);
      } catch (error) {
        lastAttemptError = error;
        const errorCode = error?.code;
        const isTransient = typeof errorCode === "number" && errorCode === LSP_ERROR_CONTENT_MODIFIED;
        if (isTransient && attempt < MAX_RETRIES_FOR_TRANSIENT) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`[LSP:${name}] ${method} got ContentModified, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES_FOR_TRANSIENT})...`);
          await sleep(delay);
          continue;
        }
        break;
      }
    }
    throw new Error(
      `LSP request '${method}' failed for server '${name}': ${lastAttemptError?.message ?? "unknown error"}`,
    );
  }
  async function sendNotification(method, params) {
    if (!isHealthy()) {
      throw new Error(`Cannot send notification to LSP server '${name}': server is ${state}`);
    }
    await client.sendNotification(method, params);
  }
  function onNotification(method, handler) {
    client.onNotification(method, handler);
  }
  function onRequest(method, handler) {
    client.onRequest(method, handler);
  }
  // ── Public API ─────────────────────────────────────────────
  return {
    name,
    config,
    get state() { return state; },
    get startTime() { return startTime; },
    get lastError() { return lastError; },
    get restartCount() { return restartCount; },
    start,
    stop,
    restart,
    isHealthy,
    sendRequest,
    sendNotification,
    onNotification,
    onRequest,
  };
}
// ── Helpers ──────────────────────────────────────────────────
function withTimeout(promise, ms, message) {
  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
