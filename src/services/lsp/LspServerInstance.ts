import { getErrorMessage, retry } from "@rodrigo-barraza/utilities-library";
// ─── Single Server Lifecycle Manager ────────────────────────
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLspClient,
  type LspClient,
  type LspParams,
  type LspParamValue,
} from "./LspClient.ts";
import { type LspServerConfig } from "./LspConfig.ts";
import logger from "../../logger.ts";
import { errorMessage } from "../../utilities.ts";

// ── Constants ────────────────────────────────────────────────
/** LSP error code for "content modified" — transient, safe to retry */
const LSP_ERROR_CONTENT_MODIFIED = -32801;
/** Maximum retries for transient errors */
const MAX_RETRIES_FOR_TRANSIENT = 3;
/** Base delay in ms for exponential backoff (500, 1000, 2000) */
const RETRY_BASE_DELAY_MS = 500;

export interface LspServerInstance {
  readonly name: string;
  readonly config: LspServerConfig;
  readonly state: string;
  readonly startTime: Date | null;
  readonly lastError: Error | null;
  readonly restartCount: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isHealthy(): boolean;
  sendRequest(method: string, params?: LspParams): Promise<unknown>;
  sendNotification(method: string, params?: LspParams): Promise<void>;
  onNotification<P = LspParams>(
    method: string,
    handler: (params: P) => void,
  ): void;
  onRequest<P = LspParams, R = LspParamValue>(
    method: string,
    handler: (params: P) => Promise<R> | R,
  ): void;
}

/**
 * Creates and manages a single LSP server instance.
 */
export function createLspServerInstance(
  name: string,
  config: LspServerConfig,
): LspServerInstance {
  // ── Private state ────────────────────────────────────────
  let state = "stopped";
  let startTime: Date | null = null;
  let lastError: Error | null = null;
  let restartCount = 0;
  let crashRecoveryCount = 0;

  const client: LspClient = createLspClient(name, (error: Error) => {
    state = "error";
    lastError = error;
    crashRecoveryCount++;
  });

  // ── Lifecycle methods ────────────────────────────────────
  async function start(): Promise<void> {
    if (state === "running" || state === "starting") return;

    // Guard: max crash recovery
    const maxRestarts = config.maxRestarts ?? 3;
    if (state === "error" && crashRecoveryCount > maxRestarts) {
      const error = new Error(
        `LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`,
      );
      lastError = error;
      throw error;
    }

    let initPromise: Promise<unknown> | undefined;
    try {
      state = "starting";
      logger.info(`[LSP:${name}] Starting server instance...`);

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
        workspaceFolders: [
          {
            uri: workspaceUri,
            name: resolve(workspaceFolder).split("/").pop() || "workspace",
          },
        ],
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
            rename: {
              dynamicRegistration: false,
              prepareSupport: false,
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
      logger.info(`[LSP:${name}] Server running`);
    } catch (error: unknown) {
      // Clean up on failure
      client.stop().catch(() => {});
      if (initPromise) {
        initPromise.catch(() => {});
      }
      state = "error";
      lastError = error instanceof Error ? error : new Error(errorMessage(error));
      logger.error(`[LSP:${name}] Start failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  async function stop(): Promise<void> {
    if (state === "stopped" || state === "stopping") return;
    try {
      state = "stopping";
      await client.stop();
      state = "stopped";
      logger.info(`[LSP:${name}] Server stopped`);
    } catch (error: unknown) {
      state = "error";
      lastError = error instanceof Error ? error : new Error(errorMessage(error));
      logger.error(`[LSP:${name}] Stop failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  async function restart(): Promise<void> {
    try {
      await stop();
    } catch (error: unknown) {
      logger.error(
        `[LSP:${name}] Stop during restart failed: ${errorMessage(error)}`,
      );
      throw error;
    }
    restartCount++;
    const maxRestarts = config.maxRestarts ?? 3;
    if (restartCount > maxRestarts) {
      throw new Error(
        `Max restart attempts (${maxRestarts}) exceeded for server '${name}'`,
      );
    }
    try {
      await start();
    } catch (error: unknown) {
      logger.error(
        `[LSP:${name}] Start during restart failed (attempt ${restartCount}/${maxRestarts}): ${errorMessage(error)}`,
      );
      throw error;
    }
  }

  function isHealthy(): boolean {
    return state === "running" && client.isInitialized;
  }

  /**
   * Send an LSP request with exponential backoff retry on transient errors.
   */
  async function sendRequest(
    method: string,
    params?: LspParams,
  ): Promise<unknown> {
    if (!isHealthy()) {
      throw new Error(
        `Cannot send request to LSP server '${name}': server is ${state}` +
          (lastError ? `, last error: ${lastError.message}` : ""),
      );
    }
    try {
      return await retry(() => client.sendRequest(method, params), {
        retries: MAX_RETRIES_FOR_TRANSIENT,
        delay: RETRY_BASE_DELAY_MS,
        backoff: 2,
        shouldRetry: (error, attempt) => {
          const errorCode =
            error && typeof error === "object" && "code" in error
              ? (error as { code: unknown }).code
              : undefined;
          const isTransient =
            typeof errorCode === "number" &&
            errorCode === LSP_ERROR_CONTENT_MODIFIED;
          if (isTransient) {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            logger.info(
              `[LSP:${name}] ${method} got ContentModified, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES_FOR_TRANSIENT})...`,
            );
          }
          return isTransient;
        },
      });
    } catch (error: unknown) {
      throw new Error(
        `LSP request '${method}' failed for server '${name}': ${getErrorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async function sendNotification(
    method: string,
    params?: LspParams,
  ): Promise<void> {
    if (!isHealthy()) {
      throw new Error(
        `Cannot send notification to LSP server '${name}': server is ${state}`,
      );
    }
    await client.sendNotification(method, params);
  }

  function onNotification<P = LspParams>(
    method: string,
    handler: (params: P) => void,
  ): void {
    client.onNotification(method, handler);
  }

  function onRequest<P = LspParams, R = LspParamValue>(
    method: string,
    handler: (params: P) => Promise<R> | R,
  ): void {
    client.onRequest(method, handler);
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    name,
    config,
    get state() {
      return state;
    },
    get startTime() {
      return startTime;
    },
    get lastError() {
      return lastError;
    },
    get restartCount() {
      return restartCount;
    },
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
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timer),
  );
}
