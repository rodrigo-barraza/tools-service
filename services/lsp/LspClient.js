// ============================================================
// LSP Client — JSON-RPC 2.0 over stdio
// ============================================================
// Low-level transport layer for communicating with Language
// Server Protocol (LSP) servers via stdio pipes.
//
// Uses vscode-jsonrpc for the JSON-RPC 2.0 message framing.
// Each client wraps a single child process and exposes
// request/notification/handler methods.
//
// Usage:
//   const client = createLspClient('typescript');
//   await client.start('npx', ['typescript-language-server', '--stdio']);
//   await client.initialize(initParams);
//   const result = await client.sendRequest('textDocument/definition', params);
//   await client.stop();
// ============================================================

import { spawn } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

/**
 * Create an LSP client wrapper using vscode-jsonrpc.
 * Manages communication with an LSP server process via stdio.
 *
 * @param {string} serverName — human-readable name for logging
 * @param {(error: Error) => void} [onCrash] — called on unexpected exit (non-zero, not during stop)
 * @returns {object} LSP client interface
 */
export function createLspClient(serverName, onCrash) {
  // ── Closure state ──────────────────────────────────────────
  let proc = null;
  let connection = null;
  let capabilities = null;
  let isInitialized = false;
  let startFailed = false;
  let startError = null;
  let isStopping = false;

  // Queues for handlers registered before connection is ready
  const pendingNotificationHandlers = [];
  const pendingRequestHandlers = [];

  function checkStartFailed() {
    if (startFailed) {
      throw startError || new Error(`LSP server ${serverName} failed to start`);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    get capabilities() {
      return capabilities;
    },

    get isInitialized() {
      return isInitialized;
    },

    /**
     * Spawn the LSP server process and establish JSON-RPC connection.
     *
     * @param {string} command — binary to run (e.g. 'npx')
     * @param {string[]} args — arguments (e.g. ['typescript-language-server', '--stdio'])
     * @param {{ env?: Record<string,string>, cwd?: string }} [options]
     */
    async start(command, args, options = {}) {
      try {
        // 1. Spawn process
        proc = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...options.env },
          cwd: options.cwd,
          windowsHide: true,
        });

        if (!proc.stdout || !proc.stdin) {
          throw new Error("LSP server process stdio not available");
        }

        // 2. Wait for successful spawn (catch ENOENT for missing binaries)
        const spawnedProc = proc;
        await new Promise((resolve, reject) => {
          const onSpawn = () => { cleanup(); resolve(); };
          const onError = (err) => { cleanup(); reject(err); };
          const cleanup = () => {
            spawnedProc.removeListener("spawn", onSpawn);
            spawnedProc.removeListener("error", onError);
          };
          spawnedProc.once("spawn", onSpawn);
          spawnedProc.once("error", onError);
        });

        // 3. Capture stderr for diagnostics
        if (proc.stderr) {
          proc.stderr.on("data", (data) => {
            const output = data.toString().trim();
            if (output) {
              console.log(`[LSP:${serverName}:stderr] ${output}`);
            }
          });
        }

        // 4. Handle process errors after spawn
        proc.on("error", (error) => {
          if (!isStopping) {
            startFailed = true;
            startError = error;
            console.error(`[LSP:${serverName}] Process error: ${error.message}`);
          }
        });

        proc.on("exit", (code, _signal) => {
          if (code !== 0 && code !== null && !isStopping) {
            isInitialized = false;
            startFailed = false;
            startError = null;
            const crashError = new Error(`LSP server ${serverName} crashed with exit code ${code}`);
            console.error(`[LSP:${serverName}] ${crashError.message}`);
            onCrash?.(crashError);
          }
        });

        // Handle stdin errors (process exits before we finish writing)
        proc.stdin.on("error", (error) => {
          if (!isStopping) {
            console.warn(`[LSP:${serverName}] stdin error: ${error.message}`);
          }
        });

        // 5. Create JSON-RPC connection
        const reader = new StreamMessageReader(proc.stdout);
        const writer = new StreamMessageWriter(proc.stdin);
        connection = createMessageConnection(reader, writer);

        // 6. Register error/close handlers BEFORE listen()
        connection.onError(([error]) => {
          if (!isStopping) {
            startFailed = true;
            startError = error;
            console.error(`[LSP:${serverName}] Connection error: ${error.message}`);
          }
        });

        connection.onClose(() => {
          if (!isStopping) {
            isInitialized = false;
            console.log(`[LSP:${serverName}] Connection closed`);
          }
        });

        // 7. Start listening
        connection.listen();

        // 8. Apply queued handlers
        for (const { method, handler } of pendingNotificationHandlers) {
          connection.onNotification(method, handler);
        }
        pendingNotificationHandlers.length = 0;

        for (const { method, handler } of pendingRequestHandlers) {
          connection.onRequest(method, handler);
        }
        pendingRequestHandlers.length = 0;

        console.log(`[LSP:${serverName}] Client started`);
      } catch (error) {
        console.error(`[LSP:${serverName}] Failed to start: ${error.message}`);
        throw error;
      }
    },

    /**
     * Send the LSP `initialize` request and `initialized` notification.
     *
     * @param {object} params — InitializeParams
     * @returns {Promise<object>} InitializeResult
     */
    async initialize(params) {
      if (!connection) throw new Error("LSP client not started");
      checkStartFailed();

      try {
        const result = await connection.sendRequest("initialize", params);
        capabilities = result.capabilities;

        // Send initialized notification
        await connection.sendNotification("initialized", {});

        isInitialized = true;
        console.log(`[LSP:${serverName}] Initialized`);
        return result;
      } catch (error) {
        console.error(`[LSP:${serverName}] Initialize failed: ${error.message}`);
        throw error;
      }
    },

    /**
     * Send an LSP request and return the result.
     *
     * @param {string} method — e.g. 'textDocument/definition'
     * @param {unknown} params
     * @returns {Promise<unknown>}
     */
    async sendRequest(method, params) {
      if (!connection) throw new Error("LSP client not started");
      checkStartFailed();
      if (!isInitialized) throw new Error("LSP server not initialized");

      try {
        return await connection.sendRequest(method, params);
      } catch (error) {
        console.error(`[LSP:${serverName}] Request ${method} failed: ${error.message}`);
        throw error;
      }
    },

    /**
     * Send an LSP notification (fire-and-forget).
     *
     * @param {string} method — e.g. 'textDocument/didOpen'
     * @param {unknown} params
     */
    async sendNotification(method, params) {
      if (!connection) throw new Error("LSP client not started");
      checkStartFailed();

      try {
        await connection.sendNotification(method, params);
      } catch (error) {
        console.warn(`[LSP:${serverName}] Notification ${method} failed: ${error.message}`);
        // Don't re-throw — notifications are fire-and-forget
      }
    },

    /**
     * Register a handler for notifications FROM the server.
     *
     * @param {string} method
     * @param {(params: unknown) => void} handler
     */
    onNotification(method, handler) {
      if (!connection) {
        pendingNotificationHandlers.push({ method, handler });
        return;
      }
      checkStartFailed();
      connection.onNotification(method, handler);
    },

    /**
     * Register a handler for requests FROM the server (reverse direction).
     *
     * @param {string} method
     * @param {(params: unknown) => unknown} handler
     */
    onRequest(method, handler) {
      if (!connection) {
        pendingRequestHandlers.push({ method, handler });
        return;
      }
      checkStartFailed();
      connection.onRequest(method, handler);
    },

    /**
     * Gracefully stop the LSP server and clean up.
     */
    async stop() {
      let shutdownError = null;
      isStopping = true;

      try {
        if (connection) {
          await connection.sendRequest("shutdown", {});
          await connection.sendNotification("exit", {});
        }
      } catch (error) {
        console.warn(`[LSP:${serverName}] Shutdown error: ${error.message}`);
        shutdownError = error;
      } finally {
        // Always cleanup regardless of shutdown success
        if (connection) {
          try { connection.dispose(); } catch { /* disposal errors are non-critical */ }
          connection = null;
        }

        if (proc) {
          proc.removeAllListeners("error");
          proc.removeAllListeners("exit");
          if (proc.stdin) proc.stdin.removeAllListeners("error");
          if (proc.stderr) proc.stderr.removeAllListeners("data");

          try { proc.kill(); } catch { /* process may already be dead */ }
          proc = null;
        }

        isInitialized = false;
        capabilities = null;
        isStopping = false;

        if (shutdownError) {
          startFailed = true;
          startError = shutdownError;
        }

        console.log(`[LSP:${serverName}] Client stopped`);
      }

      if (shutdownError) throw shutdownError;
    },
  };
}
