// ============================================================
// LSP Server Manager — Multi-Server Router
// ============================================================
// Routes LSP requests to the appropriate language server based
// on file extension. Manages lazy initialization, file open
// tracking, and graceful shutdown of all server instances.
//
// Singleton per workspace — created via createLspServerManager()
// and shared across all tool invocations.
//
// Adapted from Claude Code's LSPServerManager.ts.
// ============================================================

import { extname, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createLspServerInstance } from "./LspServerInstance.js";
import { getLspServerConfigs } from "./lspConfig.js";

/**
 * Creates an LSP server manager instance.
 *
 * @param {string} [workspaceFolder] — root workspace path (defaults to cwd)
 * @returns {object} LSP server manager interface
 */
export function createLspServerManager(workspaceFolder) {
  // ── Private state ──────────────────────────────────────────
  /** @type {Map<string, object>} name → LspServerInstance */
  const servers = new Map();

  /** @type {Map<string, string[]>} extension → server name[] */
  const extensionMap = new Map();

  /** @type {Map<string, string>} fileURI → server name (tracks open files) */
  const openedFiles = new Map();

  let initialized = false;

  // ── Initialization ─────────────────────────────────────────

  /**
   * Load all configured LSP servers and build extension routing map.
   * Does NOT start any servers — they start lazily on first request.
   */
  function initialize() {
    if (initialized) return;

    const configs = getLspServerConfigs(workspaceFolder);

    for (const [serverName, config] of Object.entries(configs)) {
      try {
        if (!config.command) {
          console.warn(`[LSP Manager] Server '${serverName}' missing 'command' — skipping`);
          continue;
        }
        if (!config.extensionToLanguage || Object.keys(config.extensionToLanguage).length === 0) {
          console.warn(`[LSP Manager] Server '${serverName}' missing 'extensionToLanguage' — skipping`);
          continue;
        }

        // Build extension → server mapping
        for (const ext of Object.keys(config.extensionToLanguage)) {
          const normalized = ext.toLowerCase();
          if (!extensionMap.has(normalized)) {
            extensionMap.set(normalized, []);
          }
          extensionMap.get(normalized).push(serverName);
        }

        // Create instance (not started yet)
        const instance = createLspServerInstance(serverName, config);

        // Handle workspace/configuration requests from servers that send them
        // even when we say we don't support it (TypeScript does this)
        instance.onRequest("workspace/configuration", (params) => {
          return (params?.items || []).map(() => null);
        });

        servers.set(serverName, instance);
      } catch (error) {
        console.error(`[LSP Manager] Failed to create server '${serverName}': ${error.message}`);
      }
    }

    initialized = true;
    console.log(`[LSP Manager] Initialized with ${servers.size} server(s): ${[...servers.keys()].join(", ")}`);
  }

  // ── Routing ────────────────────────────────────────────────

  /**
   * Get the server instance for a given file path based on extension.
   *
   * @param {string} filePath — absolute file path
   * @returns {object|undefined} LspServerInstance or undefined
   */
  function getServerForFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    const serverNames = extensionMap.get(ext);
    if (!serverNames || serverNames.length === 0) return undefined;
    return servers.get(serverNames[0]);
  }

  /**
   * Ensure the appropriate server is started for a file.
   * Lazy-starts the server on first request for that language.
   *
   * @param {string} filePath
   * @returns {Promise<object|undefined>} LspServerInstance or undefined
   */
  async function ensureServerStarted(filePath) {
    const server = getServerForFile(filePath);
    if (!server) return undefined;

    if (server.state === "stopped" || server.state === "error") {
      try {
        await server.start();
      } catch (error) {
        console.error(`[LSP Manager] Failed to start server for ${basename(filePath)}: ${error.message}`);
        throw error;
      }
    }

    return server;
  }

  // ── Request forwarding ─────────────────────────────────────

  /**
   * Send an LSP request to the appropriate server for the given file.
   *
   * @param {string} filePath — absolute file path
   * @param {string} method — LSP method (e.g. 'textDocument/definition')
   * @param {unknown} params — method params
   * @returns {Promise<unknown|undefined>} Result or undefined if no server
   */
  async function sendRequest(filePath, method, params) {
    const server = await ensureServerStarted(filePath);
    if (!server) return undefined;

    try {
      return await server.sendRequest(method, params);
    } catch (error) {
      console.error(`[LSP Manager] Request '${method}' failed for ${basename(filePath)}: ${error.message}`);
      throw error;
    }
  }

  // ── File synchronization ───────────────────────────────────

  /**
   * Open a file in the appropriate LSP server (sends didOpen).
   * Skips if already open on the same server.
   *
   * @param {string} filePath — absolute file path
   * @param {string} content — file content
   */
  async function openFile(filePath, content) {
    const server = await ensureServerStarted(filePath);
    if (!server) return;

    const fileUri = pathToFileURL(resolve(filePath)).href;

    // Skip if already open on this server
    if (openedFiles.get(fileUri) === server.name) return;

    const ext = extname(filePath).toLowerCase();
    const languageId = server.config.extensionToLanguage[ext] || "plaintext";

    try {
      await server.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: fileUri,
          languageId,
          version: 1,
          text: content,
        },
      });
      openedFiles.set(fileUri, server.name);
    } catch (error) {
      console.error(`[LSP Manager] didOpen failed for ${basename(filePath)}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Notify the server of file content changes.
   *
   * @param {string} filePath
   * @param {string} content — new full content
   */
  async function changeFile(filePath, content) {
    const server = getServerForFile(filePath);
    if (!server || server.state !== "running") {
      return openFile(filePath, content);
    }

    const fileUri = pathToFileURL(resolve(filePath)).href;

    // If not yet open, open it first (LSP requires didOpen before didChange)
    if (openedFiles.get(fileUri) !== server.name) {
      return openFile(filePath, content);
    }

    try {
      await server.sendNotification("textDocument/didChange", {
        textDocument: { uri: fileUri, version: 1 },
        contentChanges: [{ text: content }],
      });
    } catch (error) {
      console.error(`[LSP Manager] didChange failed for ${basename(filePath)}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Close a file in the LSP server (sends didClose).
   *
   * @param {string} filePath
   */
  async function closeFile(filePath) {
    const server = getServerForFile(filePath);
    if (!server || server.state !== "running") return;

    const fileUri = pathToFileURL(resolve(filePath)).href;

    try {
      await server.sendNotification("textDocument/didClose", {
        textDocument: { uri: fileUri },
      });
      openedFiles.delete(fileUri);
    } catch (error) {
      console.error(`[LSP Manager] didClose failed for ${basename(filePath)}: ${error.message}`);
    }
  }

  /**
   * Check if a file is currently open on a compatible server.
   *
   * @param {string} filePath
   * @returns {boolean}
   */
  function isFileOpen(filePath) {
    const fileUri = pathToFileURL(resolve(filePath)).href;
    return openedFiles.has(fileUri);
  }

  // ── Status & Shutdown ──────────────────────────────────────

  /**
   * Get health status of all configured servers.
   *
   * @returns {Record<string, string>} name → state
   */
  function getHealth() {
    const health = {};
    for (const [name, server] of servers) {
      health[name] = server.state;
    }
    return health;
  }

  /**
   * Get all server instances.
   *
   * @returns {Map<string, object>}
   */
  function getAllServers() {
    return servers;
  }

  /**
   * Shutdown all running servers and clear state.
   */
  async function shutdown() {
    const toStop = [...servers.entries()].filter(
      ([, s]) => s.state === "running" || s.state === "error",
    );

    const results = await Promise.allSettled(
      toStop.map(([, server]) => server.stop()),
    );

    const errors = results
      .map((r, i) => r.status === "rejected" ? `${toStop[i][0]}: ${r.reason?.message}` : null)
      .filter(Boolean);

    servers.clear();
    extensionMap.clear();
    openedFiles.clear();
    initialized = false;

    if (errors.length > 0) {
      console.error(`[LSP Manager] Shutdown errors: ${errors.join("; ")}`);
    } else {
      console.log("[LSP Manager] All servers shut down");
    }
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    initialize,
    getServerForFile,
    ensureServerStarted,
    sendRequest,
    openFile,
    changeFile,
    closeFile,
    isFileOpen,
    getHealth,
    getAllServers,
    shutdown,
  };
}

// ── Module-level singleton ───────────────────────────────────
// Lazily created on first use. The workspace folder can be
// overridden per-request via AgenticLspService.

/** @type {Map<string, object>} workspaceFolder → manager */
const managers = new Map();

/**
 * Get or create the LSP server manager for a workspace.
 *
 * @param {string} [workspaceFolder]
 * @returns {object} LspServerManager
 */
export function getLspManager(workspaceFolder) {
  const key = workspaceFolder || "__default__";

  if (!managers.has(key)) {
    const manager = createLspServerManager(workspaceFolder);
    manager.initialize();
    managers.set(key, manager);
  }

  return managers.get(key);
}

/**
 * Shutdown all managers (for graceful process exit).
 */
export async function shutdownAllLspManagers() {
  const all = [...managers.values()];
  managers.clear();
  await Promise.allSettled(all.map((m) => m.shutdown()));
  console.log("[LSP Manager] All managers shut down");
}

/**
 * Get health of all managers.
 *
 * @returns {Record<string, Record<string, string>>}
 */
export function getAllLspHealth() {
  const health = {};
  for (const [key, manager] of managers) {
    health[key] = manager.getHealth();
  }
  return health;
}
