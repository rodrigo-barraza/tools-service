// ─── Remote Workspace Agent Registry ────────────────────────

import { WebSocketServer, WebSocket } from "ws";
import { getErrorMessage } from "@rodrigo-barraza/utilities-library";
import { IDENTITY_HEADERS, AUTH_HEADERS } from "@rodrigo-barraza/utilities-library/taxonomy";
import crypto from "node:crypto";
import { resolve } from "node:path";
import logger from "../logger.ts";
import CONFIG from "../config.ts";
import { Server, IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { requestLocalStorage } from "@rodrigo-barraza/utilities-library/service";
import {
  AGENT_RPC_TIMEOUT_FILE_MS as RPC_TIMEOUT_FILE_MS,
  AGENT_RPC_TIMEOUT_GIT_MS as RPC_TIMEOUT_GIT_MS,
  AGENT_RPC_TIMEOUT_COMMAND_MS as RPC_TIMEOUT_COMMAND_MS,
  AGENT_RPC_TIMEOUT_DEFAULT_MS as RPC_TIMEOUT_DEFAULT_MS,
  AGENT_HEALTH_CHECK_INTERVAL_MS as HEALTH_CHECK_INTERVAL_MS,
  AGENT_STALE_TIMEOUT_MS as STALE_AGENT_TIMEOUT_MS,
} from "../constants.ts";

// RPC method → timeout category
const TIMEOUT_MAP = {
  "file.read": RPC_TIMEOUT_FILE_MS,
  "file.write": RPC_TIMEOUT_FILE_MS,
  "file.strReplace": RPC_TIMEOUT_FILE_MS,
  "file.blockReplace": RPC_TIMEOUT_FILE_MS,
  "file.multiReplace": RPC_TIMEOUT_FILE_MS,
  "file.patch": RPC_TIMEOUT_FILE_MS,
  "file.info": RPC_TIMEOUT_FILE_MS,
  "file.diff": RPC_TIMEOUT_FILE_MS,
  "file.move": RPC_TIMEOUT_FILE_MS,
  "file.delete": RPC_TIMEOUT_FILE_MS,
  "file.readMulti": RPC_TIMEOUT_FILE_MS * 2,
  "directory.list": RPC_TIMEOUT_FILE_MS,
  "search.grep": RPC_TIMEOUT_FILE_MS * 3,
  "search.glob": RPC_TIMEOUT_FILE_MS * 2,
  "git.status": RPC_TIMEOUT_GIT_MS,
  "git.diff": RPC_TIMEOUT_GIT_MS,
  "git.log": RPC_TIMEOUT_GIT_MS,
  "command.run": RPC_TIMEOUT_COMMAND_MS,
  "command.stream": RPC_TIMEOUT_COMMAND_MS,
  "project.summary": RPC_TIMEOUT_FILE_MS * 3,
  "directory.create": RPC_TIMEOUT_FILE_MS,
  "directory.tree": RPC_TIMEOUT_FILE_MS * 2,
  "watch.subscribe": RPC_TIMEOUT_FILE_MS,
  "watch.unsubscribe": RPC_TIMEOUT_FILE_MS,
};

// ────────────────────────────────────────────────────────────
// Agent Registry
// ────────────────────────────────────────────────────────────

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface MachineInfo {
  hostname?: string;
  platform?: string;
  arch?: string;
  release?: string;
  username?: string;
  cpuModel?: string;
  cpuCores?: number;
  totalMemoryBytes?: number;
}

interface AgentRegistryEntry {
  id: string;
  name: string;
  roots: string[];
  originalRoots: string[];
  displayRoots: string[];
  normalizedToOriginalRoot: Map<string, string>;
  capabilities: string[];
  version: string;
  machineInfo?: MachineInfo;
  websocket: WebSocket & { isAlive?: boolean };
  clientIp?: string;
  connectedAt: Date;
  lastPong: Date;
  pendingRpc: Map<string, PendingRpc>;
  _streamCallback?:
    | ((method: string, params: Record<string, unknown>) => void)
    | null;
}

interface AgentRpcMessage {
  id?: string;
  method?: string;
  params?: {
    agentId?: string;
    name?: string;
    roots?: string[];
    displayRoots?: string[];
    capabilities?: string[];
    version?: string;
    machineInfo?: MachineInfo;
    path?: string;
    paths?: string[];
    searchPath?: string;
    source?: string;
    pathA?: string;
    cwd?: string;
    [key: string]: unknown;
  };
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

const agents = new Map<string, AgentRegistryEntry>();

/** rootPath → agentId (for fast routing) */
const rootToAgent = new Map<string, string>();

/**
 * Specific (non-"/") roots that a workspace agent has served at least once this
 * process lifetime. Unlike rootToAgent, entries are NOT removed on disconnect,
 * so we can distinguish "this path belongs to a workspace machine whose agent is
 * currently offline" from "this is a genuinely local path". The former must
 * error rather than silently execute on the tools-service host (wrong machine).
 * "/" is deliberately excluded — it matches every local path and would block
 * all local execution when a container agent drops.
 */
const knownRemoteRoots = new Set<string>();

/**
 * Mark a root as remote-only without an agent ever having connected for it.
 * Used at boot for user-configured roots that do not exist on this host's
 * filesystem: they can only ever be served by a workspace agent, so ops on
 * them must wait for that agent rather than fall back to local execution
 * (the original S1 production failure — EACCES/ENOENT storms on /workspace).
 */
export function registerRemoteOnlyRoot(root: string) {
  if (root && root !== "/") knownRemoteRoots.add(root);
}

let healthCheckTimer: NodeJS.Timeout | null = null;

/**
 * Normalize a Windows path to a POSIX path for server-side consistency.
 *
 * Handles two cases:
 *  1. WSL UNC paths: \\wsl.localhost\<distro>\path or \\wsl$\<distro>\path
 *     → strips the UNC prefix and distro name to yield the Linux-native path.
 *  2. Drive-letter paths: C:\workspace → /mnt/c/workspace
 */
export function normalizeWindowsRootPath(rootPath: string): string {
  // Normalize all forward slashes to backslashes for uniform matching
  const backslashNormalized = rootPath.replace(/\//g, "\\");

  // WSL UNC paths: \\wsl.localhost\<distro>\... or \\wsl$\<distro>\...
  const wslUncPattern = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;
  const wslMatch = backslashNormalized.match(wslUncPattern);
  if (wslMatch) {
    const remainingWindowsPath = wslMatch[2] || "";
    const linuxPath = remainingWindowsPath.replace(/\\/g, "/") || "/";
    return linuxPath;
  }

  // Windows drive-letter paths: C:\... → /mnt/c/...
  const windowsDrivePattern = /^([A-Za-z]):[/\\](.*)/;
  const driveMatch = rootPath.match(windowsDrivePattern);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    const remainingPath = driveMatch[2].replace(/\\/g, "/").replace(/\/+$/, "");
    return remainingPath ? `/mnt/${driveLetter}/${remainingPath}` : `/mnt/${driveLetter}`;
  }

  return rootPath;
}

/**
 * Translate a server-side normalized path back to the agent's native path
 * format by matching against the agent's root mapping.
 */
function translatePathForAgent(
  agent: AgentRegistryEntry,
  normalizedPath: string,
): string {
  for (const [normalizedRoot, originalRoot] of agent.normalizedToOriginalRoot) {
    if (normalizedRoot === originalRoot) continue;
    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/")) {
      return originalRoot + normalizedPath.slice(normalizedRoot.length);
    }
  }
  return normalizedPath;
}

// ────────────────────────────────────────────────────────────
// Workspace Agent Secret (from MongoDB settings, cached)
// ────────────────────────────────────────────────────────────

import { getDatabase } from "@rodrigo-barraza/utilities-library/service/mongo";

export async function resolveAgentSecret(): Promise<string | undefined> {
  try {
    const database = getDatabase();
    const databaseInternal = database as unknown as {
      client?: { db: (name: string) => import("mongodb").Db };
      s?: { client?: { db: (name: string) => import("mongodb").Db } };
    };
    const client = databaseInternal.client || databaseInternal.s?.client;
    if (client) {
      const prismDatabase = client.db(CONFIG.PRISM_MONGODB_DB_NAME);
      const document = await prismDatabase
        .collection("settings")
        .findOne({ _key: "global" });
      const workspaceSecret = document?.data?.workspace?.agentSecret;
      if (workspaceSecret && typeof workspaceSecret === "string" && workspaceSecret.trim()) {
        return workspaceSecret.trim();
      }
    }
  } catch {
    // DB unavailable — no secret enforcement
  }

  return undefined;
}

// ────────────────────────────────────────────────────────────
// WebSocket Server Setup
// ────────────────────────────────────────────────────────────

/**
 * Initialize the agent WebSocket server on an existing HTTP server.
 * Handles upgrade requests on /ws/agent path.
 */
export function initAgentWebSocket(httpServer: Server) {
  const wss = new WebSocketServer({ noServer: true });
  const clientWss = new WebSocketServer({ noServer: true });

  httpServer.on(
    "upgrade",
    async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(
        req.url || "",
        `http://${req.headers.host || "localhost"}`,
      );

      // Auth check (shared across both endpoints)
      const incomingSecret =
        req.headers[AUTH_HEADERS.apiSecret] || url.searchParams.get("secret") || "";
      const expectedSecret = await resolveAgentSecret();

      if (expectedSecret && incomingSecret !== expectedSecret) {
        logger.warn(`[AgentWS] Rejected connection — invalid secret`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // No secret configured — auth is effectively OFF for this connection.
      // Warn loudly every time; refuse entirely when enforcement is enabled
      // (set AGENT_WS_REQUIRE_SECRET=true once a secret is configured in
      // prism settings.workspace.agentSecret and baked into agents).
      if (!expectedSecret) {
        if (process.env.AGENT_WS_REQUIRE_SECRET === "true") {
          logger.error(
            `[AgentWS] Rejected connection — no agent secret configured and AGENT_WS_REQUIRE_SECRET=true. ` +
              `Set settings.workspace.agentSecret in the prism settings collection.`,
          );
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        logger.warn(
          `[AgentWS] ⚠️ Accepting UNAUTHENTICATED ${url.pathname} connection — no agent secret configured. ` +
            `Set settings.workspace.agentSecret (and AGENT_WS_REQUIRE_SECRET=true) to enforce auth.`,
        );
      }

      // Agent connections (workspace-service sidecar → tools-service)
      if (url.pathname === "/ws/agent") {
        wss.handleUpgrade(req, socket, head, (websocket) => {
          wss.emit("connection", websocket, req);
        });
        return;
      }

      // Client connections (VS Code extension → tools-service → agent)
      if (url.pathname === "/ws/workspace") {
        clientWss.handleUpgrade(req, socket, head, (websocket) => {
          clientWss.emit("connection", websocket, req);
        });
        return;
      }
    },
  );

  // ── Agent WebSocket (workspace-service sidecar) ──────────

  wss.on(
    "connection",
    (websocket: WebSocket & { isAlive?: boolean }, req: IncomingMessage) => {
      const clientIp =
        (req.headers[IDENTITY_HEADERS.forwardedFor] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress?.replace(/^::ffff:/, "");

      logger.info(`[AgentWS] New connection from ${clientIp}`);

      websocket.isAlive = true;
      websocket.on("pong", () => {
        websocket.isAlive = true;
      });

      websocket.on("message", (raw: unknown) => {
        try {
          const data = raw as Buffer | ArrayBuffer | Buffer[];
          const message = JSON.parse(data.toString()) as AgentRpcMessage;
          handleAgentMessage(websocket, message, clientIp);
        } catch (error: unknown) {
          const errorMessage = getErrorMessage(error);
          logger.error(`[AgentWS] Invalid message: ${errorMessage}`);
        }
      });

      websocket.on("close", () => {
        for (const [agentId, agent] of agents) {
          if (agent.websocket === websocket) {
            deregisterAgent(agentId, "disconnected");
            break;
          }
        }
      });

      websocket.on("error", (error: Error) => {
        logger.error(`[AgentWS] Connection error: ${error.message}`);
      });
    },
  );

  // ── Client WebSocket (VS Code extension proxy) ──────────

  clientWss.on(
    "connection",
    (websocket: WebSocket & { isAlive?: boolean }, req: IncomingMessage) => {
      const clientIp =
        (req.headers[IDENTITY_HEADERS.forwardedFor] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress?.replace(/^::ffff:/, "");

      logger.info(`[ClientWS] New client connection from ${clientIp}`);

      websocket.isAlive = true;
      websocket.on("pong", () => {
        websocket.isAlive = true;
      });

      websocket.on("message", async (raw: unknown) => {
        try {
          const data = raw as Buffer | ArrayBuffer | Buffer[];
          const message = JSON.parse(data.toString()) as AgentRpcMessage;

          // Only handle RPC requests (has id + method)
          if (!message.id || !message.method) return;

          // Meta-methods (no path routing needed)
          if (message.method === "agents.list") {
            sendJson(websocket, {
              jsonrpc: "2.0",
              id: message.id,
              result: getConnectedAgents(),
            });
            return;
          }

          // Extract the target path from params
          const targetPath =
            message.params?.path ||
            message.params?.paths ||
            message.params?.searchPath ||
            message.params?.source ||
            message.params?.pathA ||
            message.params?.cwd;

          // Resolve target path to a string for routing
          const routePath = Array.isArray(targetPath)
            ? targetPath[0]
            : targetPath;

          if (!routePath) {
            sendJson(websocket, {
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32602,
                message: "No routable path found in params",
              },
            });
            return;
          }

          // Find the agent that serves this path
          const route = routeForPath(routePath);
          if (!route) {
            sendJson(websocket, {
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32001,
                message: `No agent found for path: ${routePath}`,
              },
            });
            return;
          }

          // Proxy the RPC to the agent
          try {
            const result = await sendRpc(
              route.id,
              message.method,
              message.params,
            );
            sendJson(websocket, { jsonrpc: "2.0", id: message.id, result });
          } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            sendJson(websocket, {
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32000, message: errorMessage },
            });
          }
        } catch (error: unknown) {
          const errorMessage = getErrorMessage(error);
          logger.error(`[ClientWS] Invalid message: ${errorMessage}`);
        }
      });

      websocket.on("close", () => {
        logger.info(`[ClientWS] Client disconnected (${clientIp})`);
      });

      websocket.on("error", (error: Error) => {
        logger.error(`[ClientWS] Connection error: ${error.message}`);
      });
    },
  );

  // Start health check interval
  startHealthCheck(wss);

  logger.info(`[AgentWS] Agent WebSocket initialized on /ws/agent`);
  logger.info(`[ClientWS] Client WebSocket initialized on /ws/workspace`);
}

// ────────────────────────────────────────────────────────────
// Message Handling
// ────────────────────────────────────────────────────────────

function handleAgentMessage(
  websocket: WebSocket & { isAlive?: boolean },
  message: AgentRpcMessage,
  clientIp?: string,
) {
  // Registration
  if (message.method === "agent.register") {
    const { agentId, name, roots, displayRoots, capabilities, version } =
      message.params || {};

    if (!agentId || !Array.isArray(roots) || roots.length === 0) {
      sendJson(websocket, {
        jsonrpc: "2.0",
        method: "agent.error",
        params: { error: "Invalid registration: agentId and roots required" },
      });
      return;
    }

    // Check max connections
    const maxConnections = parseInt(CONFIG.AGENT_MAX_CONNECTIONS || "5", 10);
    if (agents.size >= maxConnections) {
      sendJson(websocket, {
        jsonrpc: "2.0",
        method: "agent.error",
        params: { error: `Max agent connections reached (${maxConnections})` },
      });
      websocket.close(1008, "Max connections reached");
      return;
    }

    // Normalize Windows drive-letter paths to POSIX for server-side consistency
    const normalizedRoots = roots.map((root: string) => normalizeWindowsRootPath(root));

    // Build normalized-to-original root mapping for reverse translation when sending RPCs
    const normalizedToOriginalRoot = new Map<string, string>();
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
      normalizedToOriginalRoot.set(normalizedRoots[rootIndex], roots[rootIndex]);
    }

    const resolvedMachineInfo = message.params?.machineInfo || undefined;

    // Register
    const entry: AgentRegistryEntry = {
      id: agentId,
      name: name || `agent-${agentId.slice(0, 8)}`,
      roots: normalizedRoots,
      originalRoots: [...roots],
      displayRoots: Array.isArray(displayRoots) && displayRoots.length > 0 ? displayRoots : [],
      normalizedToOriginalRoot,
      capabilities: capabilities || [],
      version: version || "unknown",
      machineInfo: resolvedMachineInfo,
      websocket,
      clientIp,
      connectedAt: new Date(),
      lastPong: new Date(),
      pendingRpc: new Map(),
    };

    agents.set(agentId, entry);

    // Map roots to this agent
    for (const root of normalizedRoots) {
      rootToAgent.set(root, agentId);
      if (root !== "/") knownRemoteRoots.add(root);
    }

    // Merge agent roots into ALLOWED_ROOTS so they appear in the workspace list
    rebuildAllowedRootsFromAgents();

    logger.success(
      `[AgentWS] Agent registered: "${entry.name}" (${agentId.slice(0, 8)}) — roots: ${normalizedRoots.join(", ")}${normalizedRoots.join("") !== roots.join("") ? ` (original: ${roots.join(", ")})` : ""}`,
    );

    // Confirm registration
    sendJson(websocket, {
      jsonrpc: "2.0",
      method: "agent.registered",
      params: { agentId },
    });
    return;
  }

  // Deregistration
  if (message.method === "agent.deregister") {
    const { agentId } = message.params || {};
    if (agentId && agents.has(agentId)) {
      deregisterAgent(agentId, "graceful");
    }
    return;
  }

  // Pong (application-level)
  if (message.method === "agent.pong") {
    const { agentId } = message.params || {};
    if (agentId && agents.has(agentId)) {
      const agent = agents.get(agentId);
      if (agent) {
        agent.lastPong = new Date();
      }
    }
    return;
  }

  // Heartbeat (application-level ping from agent → server responds with agent.ping)
  if (message.method === "agent.heartbeat") {
    const { agentId } = message.params || {};
    if (agentId && agents.has(agentId)) {
      const agent = agents.get(agentId);
      if (agent) {
        agent.lastPong = new Date();
        sendJson(websocket, {
          jsonrpc: "2.0",
          method: "agent.ping",
          params: {},
        });
      }
    }
    return;
  }

  // RPC response — resolve pending request
  if (message.id && (message.result !== undefined || message.error)) {
    for (const [, agent] of agents) {
      if (agent.websocket === websocket && agent.pendingRpc.has(message.id)) {
        const pending = agent.pendingRpc.get(message.id);
        if (pending) {
          agent.pendingRpc.delete(message.id);
          clearTimeout(pending.timer);

          if (message.error) {
            pending.reject(new Error(message.error.message || "RPC error"));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }
    }
    return;
  }

  // Streaming notification from agent (command.stdout, command.stderr)
  if (message.method && !message.id) {
    // These are forwarded to the appropriate SSE response
    // by the caller who set up the streaming RPC
    for (const [, agent] of agents) {
      if (agent.websocket === websocket && agent._streamCallback) {
        agent._streamCallback(message.method, message.params || {});
      }
    }
    return;
  }
}

// ────────────────────────────────────────────────────────────
// Agent Lifecycle
// ────────────────────────────────────────────────────────────

function deregisterAgent(agentId: string, reason: string) {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Clear root mappings
  for (const root of agent.roots) {
    if (rootToAgent.get(root) === agentId) {
      rootToAgent.delete(root);
    }
  }

  // Reject all pending RPCs
  for (const [, pending] of agent.pendingRpc) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Agent disconnected"));
  }

  agents.delete(agentId);

  // Rebuild ALLOWED_ROOTS without the disconnected agent's roots
  rebuildAllowedRootsFromAgents();

  logger.info(`[AgentWS] Agent deregistered: "${agent.name}" (${reason})`);
}

/**
 * Server-initiated disconnect — kicks an agent by notifying it first
 * (so it can suppress auto-reconnect), then closing the WebSocket.
 * Returns true if the agent was found and disconnected.
 */
export function disconnectAgent(agentId: string): boolean {
  const agent = agents.get(agentId);
  if (!agent) return false;

  // Notify the agent so it can set intentionalClose = true and suppress reconnect
  sendJson(agent.websocket, {
    jsonrpc: "2.0",
    method: "agent.kicked",
    params: { reason: "Disconnected by admin" },
  });

  // Close the WebSocket — the on("close") handler will call deregisterAgent
  agent.websocket.close(1000, "Kicked by admin");

  logger.info(`[AgentWS] Agent kicked: "${agent.name}" (${agentId.slice(0, 8)})`);
  return true;
}

// ────────────────────────────────────────────────────────────
// RPC — Send request to agent, get response
// ────────────────────────────────────────────────────────────

/**
 * Send an RPC request to an agent and wait for the response.
 */
export function sendRpc(
  agentId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const agent = agents.get(agentId);
    if (!agent) {
      reject(new Error("Agent not found"));
      return;
    }

    if (agent.websocket.readyState !== 1 /* OPEN */) {
      reject(new Error("Agent WebSocket not open"));
      return;
    }

    // Translate normalized POSIX paths back to the agent's native format
    const translatedParams = { ...params };
    const pathKeys = ["path", "searchPath", "source", "destination", "pathA", "pathB", "cwd", "filePath"] as const;
    for (const key of pathKeys) {
      if (typeof translatedParams[key] === "string") {
        translatedParams[key] = translatePathForAgent(
          agent,
          translatedParams[key] as string,
        );
      }
    }
    if (Array.isArray(translatedParams.paths)) {
      translatedParams.paths = (translatedParams.paths as string[]).map(
        (pathString) => translatePathForAgent(agent, pathString),
      );
    }

    const id = crypto.randomUUID();
    const timeout =
      (TIMEOUT_MAP as Record<string, number>)[method] || RPC_TIMEOUT_DEFAULT_MS;

    const timer = setTimeout(() => {
      agent.pendingRpc.delete(id);
      reject(new Error(`RPC timeout (${method}, ${timeout}ms)`));
    }, timeout);

    agent.pendingRpc.set(id, { resolve, reject, timer });

    sendJson(agent.websocket, {
      jsonrpc: "2.0",
      id,
      method,
      params: translatedParams,
    });
  });
}

/**
 * Send an RPC request to an agent with a streaming callback for notifications.
 * Used for command.stream where stdout/stderr arrive as notifications.
 */
export function sendRpcStreaming(
  agentId: string,
  method: string,
  params: Record<string, unknown> = {},
  onNotification: (method: string, params: Record<string, unknown>) => void,
): Promise<unknown> {
  const agent = agents.get(agentId);
  if (!agent) return Promise.reject(new Error("Agent not found"));

  // Set up streaming callback
  agent._streamCallback = onNotification;

  return sendRpc(agentId, method, params).finally(() => {
    agent._streamCallback = null;
  });
}

// ────────────────────────────────────────────────────────────
// Routing — Find agent for a given path
// ────────────────────────────────────────────────────────────

/**
 * Find the agent that serves a given file system path.
 * Returns null if the path should be handled locally.
 */
export function routeForPath(absolutePath: string | undefined | null) {
  if (!absolutePath) return null;

  // Normalize incoming path in case it uses Windows drive-letter format
  const normalizedPath = normalizeWindowsRootPath(absolutePath);

  // Sort roots by descending length to match the most specific root first (e.g. /mnt/c/workspace before /)
  const sortedRoots = Array.from(rootToAgent.keys()).sort((a, b) => b.length - a.length);

  // Check each registered root
  for (const root of sortedRoots) {
    const agentId = rootToAgent.get(root)!;

    // Root "/" is a special case — it matches ALL absolute paths (the
    // container filesystem IS the workspace, registered as virtual root "/").
    const isMatch = root === "/"
      ? normalizedPath.startsWith("/")
      : (normalizedPath.startsWith(root + "/") || normalizedPath === root);

    if (isMatch) {
      const agent = agents.get(agentId);
      if (agent && agent.websocket.readyState === 1) {
        return { id: agent.id, name: agent.name, roots: agent.roots };
      }
    }
  }

  return null;
}

/**
 * Resolve a potentially-relative workspace path against the current request
 * context, then route to the matching workspace agent.
 *
 * This is the single source of truth for workspace agent routing.
 * All workspace tool services (file, git, command, project) should use this
 * instead of calling routeForPath directly, to ensure relative paths like
 * "." correctly resolve against the active workspace root.
 *
 * Resolution priority:
 *   1. X-Workspace-Override (active worktree)
 *   2. X-Workspace-Root (user-selected workspace)
 *   3. fallbackRoot (typically ALLOWED_ROOTS[0])
 *
 * @param targetPath - The path to route (absolute or relative)
 * @param fallbackRoot - Static fallback root when no request context exists
 */
export function resolveAndRouteToAgent(
  targetPath: string | undefined | null,
  fallbackRoot?: string,
) {
  if (!targetPath) return null;

  // Strip surrounding quotes from LLM-generated path values
  const sanitizedTargetPath = targetPath.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!sanitizedTargetPath) return null;

  let resolvedPath = sanitizedTargetPath;
  if (!sanitizedTargetPath.startsWith("/")) {
    const requestStore = requestLocalStorage.getStore();
    const workspaceOverride = requestStore?.workspaceOverride;
    const workspaceRoot = requestStore?.workspaceRoot;

    if (workspaceOverride && workspaceOverride.startsWith("/tmp/prism-worktrees/")) {
      resolvedPath = resolve(workspaceOverride, sanitizedTargetPath);
    } else if (workspaceRoot) {
      resolvedPath = resolve(workspaceRoot, sanitizedTargetPath);
    } else if (fallbackRoot) {
      resolvedPath = resolve(fallbackRoot, sanitizedTargetPath);
    }
  }

  return routeForPath(resolvedPath);
}

/**
 * Detect the "wrong machine" hazard: a path that belongs to a workspace root a
 * remote agent has served, but which no live agent currently serves. Executing
 * such an op locally on the tools-service host would silently target the wrong
 * filesystem (or fail with a cryptic ENOENT/EACCES). Returns the offline root
 * so the caller can return a teaching error instead of falling back to local.
 * Returns null when the path is genuinely local or an agent is available.
 */
export function offlineRemoteRootForPath(
  targetPath: string | undefined | null,
  fallbackRoot?: string,
): string | null {
  if (!targetPath || knownRemoteRoots.size === 0) return null;

  const sanitized = targetPath.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!sanitized) return null;

  let resolvedPath = sanitized;
  if (!sanitized.startsWith("/")) {
    const requestStore = requestLocalStorage.getStore();
    const workspaceOverride = requestStore?.workspaceOverride;
    const workspaceRoot = requestStore?.workspaceRoot;
    if (workspaceOverride && workspaceOverride.startsWith("/tmp/prism-worktrees/")) {
      resolvedPath = resolve(workspaceOverride, sanitized);
    } else if (workspaceRoot) {
      resolvedPath = resolve(workspaceRoot, sanitized);
    } else if (fallbackRoot) {
      resolvedPath = resolve(fallbackRoot, sanitized);
    }
  }
  const normalized = normalizeWindowsRootPath(resolvedPath);

  // If a live agent already serves this path, there is no hazard.
  if (routeForPath(normalized)) return null;

  // Otherwise, is it under a known-remote root whose agent is now gone?
  for (const root of Array.from(knownRemoteRoots).sort((a, b) => b.length - a.length)) {
    const underRoot = normalized === root || normalized.startsWith(root + "/");
    if (underRoot && !rootToAgent.has(root)) {
      return root;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Status / Health
// ────────────────────────────────────────────────────────────

/**
 * Get the list of connected agents with metadata.
 */
export function getConnectedAgents() {
  return [...agents.values()].map((agentRegistryEntry) => ({
    id: agentRegistryEntry.id,
    name: agentRegistryEntry.name,
    roots: agentRegistryEntry.roots,
    displayRoots: agentRegistryEntry.displayRoots,
    capabilities: agentRegistryEntry.capabilities,
    version: agentRegistryEntry.version,
    machineInfo: agentRegistryEntry.machineInfo || null,
    clientIp: agentRegistryEntry.clientIp,
    connectedAt: agentRegistryEntry.connectedAt.toISOString(),
    lastPong: agentRegistryEntry.lastPong.toISOString(),
    pendingRpcs: agentRegistryEntry.pendingRpc.size,
  }));
}

/**
 * Check if a specific path is served by a connected agent.
 */
export function isAgentPath(path: string | undefined | null): boolean {
  return routeForPath(path) !== null;
}

/**
 * Get agent info for a root path (for workspace metadata).
 */
export function getAgentInfoForRoot(rootPath: string) {
  const agentId = rootToAgent.get(rootPath);
  if (!agentId) return null;

  const agent = agents.get(agentId);
  if (!agent || agent.websocket.readyState !== 1) return null;

  return { agentName: agent.name, agentId: agent.id };
}

// ────────────────────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────────────────────

function startHealthCheck(wss: WebSocketServer) {
  if (healthCheckTimer) clearInterval(healthCheckTimer);

  healthCheckTimer = setInterval(() => {
    for (const [agentId, agent] of agents) {
      // Check for stale agents
      const timeSincePong = Date.now() - agent.lastPong.getTime();
      if (timeSincePong > STALE_AGENT_TIMEOUT_MS) {
        logger.warn(
          `[AgentWS] Agent "${agent.name}" stale (${(timeSincePong / 1000).toFixed(0)}s since last pong) — disconnecting`,
        );
        agent.websocket.terminate();
        deregisterAgent(agentId, "stale");
        continue;
      }

      // Send application-level ping
      if (agent.websocket.readyState === 1) {
        sendJson(agent.websocket, {
          jsonrpc: "2.0",
          method: "agent.ping",
          params: {},
        });
      }
    }

    // WebSocket-level ping for all connections
    wss.clients.forEach((websocket) => {
      const clientWebsocket = websocket as WebSocket & { isAlive?: boolean };
      if (!clientWebsocket.isAlive) {
        clientWebsocket.terminate();
        return;
      }
      clientWebsocket.isAlive = false;
      clientWebsocket.ping();
    });
  }, HEALTH_CHECK_INTERVAL_MS);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function sendJson(websocket: WebSocket, object: Record<string, unknown>) {
  if (websocket.readyState === 1) {
    websocket.send(JSON.stringify(object));
  }
}

/**
 * Rebuild ALLOWED_ROOTS by collecting all connected agent roots and merging
 * them with user-configured roots from MongoDB.
 *
 * Uses dynamic import() to avoid circular dependency with AgenticFileService
 * (which imports routeForPath/sendRpc from this module).
 */
async function rebuildAllowedRootsFromAgents() {
  try {
    const { ALLOWED_ROOTS } =
      await import("./AgenticFileService.ts");

    // Collect all agent roots
    const agentRoots: string[] = [];
    for (const [, agent] of agents) {
      for (const root of agent.roots) {
        if (!agentRoots.includes(root)) {
          agentRoots.push(root);
        }
      }
    }

    // Preserve any user-configured roots from MongoDB that aren't agent roots
    const agentSet = new Set(agentRoots);
    const userRoots = ALLOWED_ROOTS.filter(
      (r) => !agentSet.has(r),
    );

    const mergedRoots: string[] = [];
    for (const root of [...userRoots, ...agentRoots]) {
      if (!mergedRoots.includes(root)) {
        mergedRoots.push(root);
      }
    }

    ALLOWED_ROOTS.length = 0;
    ALLOWED_ROOTS.push(...mergedRoots);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.warn(`[AgentWS] Failed to rebuild allowed roots: ${errorMessage}`);
  }
}

// Default export for convenience
export default {
  initAgentWebSocket,
  sendRpc,
  sendRpcStreaming,
  routeForPath,
  resolveAndRouteToAgent,
  isAgentPath,
  getConnectedAgents,
  getAgentInfoForRoot,
  disconnectAgent,
};
