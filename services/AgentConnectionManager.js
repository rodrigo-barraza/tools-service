// ============================================================
// Agent Connection Manager — Remote Workspace Agent Registry
// ============================================================
// Manages WebSocket connections from workspace-agent CLI
// instances. Each agent registers the workspace roots it
// serves, enabling tools-service to route file/git/shell
// operations to the correct agent.
//
// Key responsibilities:
//   - Accept WebSocket connections on /ws/agent
//   - Authenticate agents via x-api-secret header
//   - Register/deregister agent roots
//   - Route operations by path prefix
//   - JSON-RPC 2.0 request/response with timeout
//   - Health monitoring via ping/pong
// ============================================================

import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import logger from "../logger.js";
import CONFIG from "../config.js";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const RPC_TIMEOUT_FILE_MS = 10_000;
const RPC_TIMEOUT_GIT_MS = 15_000;
const RPC_TIMEOUT_COMMAND_MS = 130_000; // 120s max command + 10s buffer
const RPC_TIMEOUT_DEFAULT_MS = 15_000;

const HEALTH_CHECK_INTERVAL_MS = 45_000;
const STALE_AGENT_TIMEOUT_MS = 90_000;

// RPC method → timeout category
const TIMEOUT_MAP = {
  "file.read": RPC_TIMEOUT_FILE_MS,
  "file.write": RPC_TIMEOUT_FILE_MS,
  "file.strReplace": RPC_TIMEOUT_FILE_MS,
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
};

// ────────────────────────────────────────────────────────────
// Agent Registry
// ────────────────────────────────────────────────────────────

/**
 * @typedef {object} AgentEntry
 * @property {string} id
 * @property {string} name
 * @property {string[]} roots
 * @property {string[]} capabilities
 * @property {string} version
 * @property {WebSocket} ws
 * @property {Date} connectedAt
 * @property {Date} lastPong
 * @property {Map<string, { resolve, reject, timer }>} pendingRpc
 */

/** @type {Map<string, AgentEntry>} */
const agents = new Map();

/** @type {Map<string, string>} rootPath → agentId (for fast routing) */
const rootToAgent = new Map();

let healthCheckTimer = null;

// ────────────────────────────────────────────────────────────
// WebSocket Server Setup
// ────────────────────────────────────────────────────────────

/**
 * Initialize the agent WebSocket server on an existing HTTP server.
 * Handles upgrade requests on /ws/agent path.
 *
 * @param {import("http").Server} httpServer
 */
export function initAgentWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== "/ws/agent") return;

    // Auth check
    const secret = req.headers["x-api-secret"];
    const expectedSecret = CONFIG.AGENT_SECRET || CONFIG.API_SECRET;

    if (expectedSecret && secret !== expectedSecret) {
      logger.warn(`[AgentWS] Rejected connection — invalid secret`);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress?.replace(/^::ffff:/, "");

    logger.info(`[AgentWS] New connection from ${clientIp}`);

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleAgentMessage(ws, msg, clientIp);
      } catch (err) {
        logger.error(`[AgentWS] Invalid message: ${err.message}`);
      }
    });

    ws.on("close", () => {
      // Find and remove this agent
      for (const [agentId, agent] of agents) {
        if (agent.ws === ws) {
          deregisterAgent(agentId, "disconnected");
          break;
        }
      }
    });

    ws.on("error", (err) => {
      logger.error(`[AgentWS] Connection error: ${err.message}`);
    });
  });

  // Start health check interval
  startHealthCheck(wss);

  logger.info(`[AgentWS] Agent WebSocket server initialized on /ws/agent`);
}

// ────────────────────────────────────────────────────────────
// Message Handling
// ────────────────────────────────────────────────────────────

function handleAgentMessage(ws, msg, clientIp) {
  // Registration
  if (msg.method === "agent.register") {
    const { agentId, name, roots, capabilities, version } = msg.params || {};

    if (!agentId || !Array.isArray(roots) || roots.length === 0) {
      sendJson(ws, { jsonrpc: "2.0", method: "agent.error", params: { error: "Invalid registration: agentId and roots required" } });
      return;
    }

    // Check max connections
    const maxConnections = parseInt(CONFIG.AGENT_MAX_CONNECTIONS || "5", 10);
    if (agents.size >= maxConnections) {
      sendJson(ws, { jsonrpc: "2.0", method: "agent.error", params: { error: `Max agent connections reached (${maxConnections})` } });
      ws.close(1008, "Max connections reached");
      return;
    }

    // Register
    const entry = {
      id: agentId,
      name: name || `agent-${agentId.slice(0, 8)}`,
      roots: [...roots],
      capabilities: capabilities || [],
      version: version || "unknown",
      ws,
      clientIp,
      connectedAt: new Date(),
      lastPong: new Date(),
      pendingRpc: new Map(),
    };

    agents.set(agentId, entry);

    // Map roots to this agent
    for (const root of roots) {
      rootToAgent.set(root, agentId);
    }

    logger.success(`[AgentWS] Agent registered: "${entry.name}" (${agentId.slice(0, 8)}) — roots: ${roots.join(", ")}`);

    // Confirm registration
    sendJson(ws, { jsonrpc: "2.0", method: "agent.registered", params: { agentId } });
    return;
  }

  // Deregistration
  if (msg.method === "agent.deregister") {
    const { agentId } = msg.params || {};
    if (agentId && agents.has(agentId)) {
      deregisterAgent(agentId, "graceful");
    }
    return;
  }

  // Pong (application-level)
  if (msg.method === "agent.pong") {
    const { agentId } = msg.params || {};
    if (agentId && agents.has(agentId)) {
      agents.get(agentId).lastPong = new Date();
    }
    return;
  }

  // RPC response — resolve pending request
  if (msg.id && (msg.result !== undefined || msg.error)) {
    for (const [, agent] of agents) {
      if (agent.ws === ws && agent.pendingRpc.has(msg.id)) {
        const pending = agent.pendingRpc.get(msg.id);
        agent.pendingRpc.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(new Error(msg.error.message || "RPC error"));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }
    }
    return;
  }

  // Streaming notification from agent (command.stdout, command.stderr)
  if (msg.method && !msg.id) {
    // These are forwarded to the appropriate SSE response
    // by the caller who set up the streaming RPC
    for (const [, agent] of agents) {
      if (agent.ws === ws && agent._streamCallback) {
        agent._streamCallback(msg.method, msg.params);
      }
    }
    return;
  }
}

// ────────────────────────────────────────────────────────────
// Agent Lifecycle
// ────────────────────────────────────────────────────────────

function deregisterAgent(agentId, reason) {
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
  logger.info(`[AgentWS] Agent deregistered: "${agent.name}" (${reason})`);
}

// ────────────────────────────────────────────────────────────
// RPC — Send request to agent, get response
// ────────────────────────────────────────────────────────────

/**
 * Send an RPC request to an agent and wait for the response.
 *
 * @param {string} agentId - Target agent ID
 * @param {string} method - RPC method name
 * @param {object} params - RPC parameters
 * @returns {Promise<object>} Result from the agent
 */
export function sendRpc(agentId, method, params = {}) {
  return new Promise((resolve, reject) => {
    const agent = agents.get(agentId);
    if (!agent) {
      reject(new Error("Agent not found"));
      return;
    }

    if (agent.ws.readyState !== 1 /* OPEN */) {
      reject(new Error("Agent WebSocket not open"));
      return;
    }

    const id = crypto.randomUUID();
    const timeout = TIMEOUT_MAP[method] || RPC_TIMEOUT_DEFAULT_MS;

    const timer = setTimeout(() => {
      agent.pendingRpc.delete(id);
      reject(new Error(`RPC timeout (${method}, ${timeout}ms)`));
    }, timeout);

    agent.pendingRpc.set(id, { resolve, reject, timer });

    sendJson(agent.ws, {
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
  });
}

/**
 * Send an RPC request to an agent with a streaming callback for notifications.
 * Used for command.stream where stdout/stderr arrive as notifications.
 *
 * @param {string} agentId
 * @param {string} method
 * @param {object} params
 * @param {function} onNotification - (method, params) => void
 * @returns {Promise<object>}
 */
export function sendRpcStreaming(agentId, method, params = {}, onNotification) {
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
 *
 * @param {string} absolutePath - Absolute file path to route
 * @returns {{ id: string, name: string, roots: string[] } | null}
 */
export function routeForPath(absolutePath) {
  if (!absolutePath) return null;

  // Check each registered root
  for (const [root, agentId] of rootToAgent) {
    if (absolutePath.startsWith(root + "/") || absolutePath === root) {
      const agent = agents.get(agentId);
      if (agent && agent.ws.readyState === 1) {
        return { id: agent.id, name: agent.name, roots: agent.roots };
      }
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Status / Health
// ────────────────────────────────────────────────────────────

/**
 * Get the list of connected agents with metadata.
 * @returns {object[]}
 */
export function getConnectedAgents() {
  return [...agents.values()].map((a) => ({
    id: a.id,
    name: a.name,
    roots: a.roots,
    capabilities: a.capabilities,
    version: a.version,
    clientIp: a.clientIp,
    connectedAt: a.connectedAt.toISOString(),
    lastPong: a.lastPong.toISOString(),
    pendingRpcs: a.pendingRpc.size,
  }));
}

/**
 * Check if a specific path is served by a connected agent.
 * @param {string} path
 * @returns {boolean}
 */
export function isAgentPath(path) {
  return routeForPath(path) !== null;
}

/**
 * Get agent info for a root path (for workspace metadata).
 * @param {string} rootPath
 * @returns {{ agentName: string, agentId: string } | null}
 */
export function getAgentInfoForRoot(rootPath) {
  const agentId = rootToAgent.get(rootPath);
  if (!agentId) return null;

  const agent = agents.get(agentId);
  if (!agent || agent.ws.readyState !== 1) return null;

  return { agentName: agent.name, agentId: agent.id };
}

// ────────────────────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────────────────────

function startHealthCheck(wss) {
  if (healthCheckTimer) clearInterval(healthCheckTimer);

  healthCheckTimer = setInterval(() => {
    for (const [agentId, agent] of agents) {
      // Check for stale agents
      const timeSincePong = Date.now() - agent.lastPong.getTime();
      if (timeSincePong > STALE_AGENT_TIMEOUT_MS) {
        logger.warn(`[AgentWS] Agent "${agent.name}" stale (${(timeSincePong / 1000).toFixed(0)}s since last pong) — disconnecting`);
        agent.ws.terminate();
        deregisterAgent(agentId, "stale");
        continue;
      }

      // Send application-level ping
      if (agent.ws.readyState === 1) {
        sendJson(agent.ws, { jsonrpc: "2.0", method: "agent.ping", params: {} });
      }
    }

    // WebSocket-level ping for all connections
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEALTH_CHECK_INTERVAL_MS);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function sendJson(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

// Default export for convenience
export default {
  initAgentWebSocket,
  sendRpc,
  sendRpcStreaming,
  routeForPath,
  isAgentPath,
  getConnectedAgents,
  getAgentInfoForRoot,
};
