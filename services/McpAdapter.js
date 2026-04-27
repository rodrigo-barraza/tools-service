// ────────────────────────────────────────────────────────────
// MCP Adapter — Bridges tools-api REST endpoints to MCP
// ────────────────────────────────────────────────────────────
// Exposes all tools from ToolSchemaService as MCP tools so
// LM Studio can call them via ephemeral MCP integrations.
//
// Transport: SSE (GET /mcp/sse + POST /mcp/messages)
//
// Usage in LM Studio native API:
//   "integrations": [{
//     "type": "ephemeral_mcp",
//     "server_label": "tools",
//     "server_url": "http://localhost:5590/mcp"
//   }]
// ────────────────────────────────────────────────────────────

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getToolSchemas,
  getToolSchemasForAI,
} from "./ToolSchemaService.js";
import CONFIG from "../config.js";

// ── Build tool executor URL from endpoint metadata ──────────
function buildUrl(endpoint, args = {}) {
  let path = endpoint.path;

  // Handle conditional paths
  if (endpoint.conditionalPath) {
    const { param, template } = endpoint.conditionalPath;
    if (args[param]) {
      path = template;
    }
  }

  // Replace path params
  const pathParams = new Set(endpoint.pathParams || []);
  for (const param of pathParams) {
    if (args[param] !== undefined && args[param] !== null) {
      path = path.replace(`:${param}`, encodeURIComponent(String(args[param])));
    }
  }

  // Build query string from remaining params
  const params = new URLSearchParams();
  const queryParams = endpoint.queryParams || [];
  for (const key of queryParams) {
    const value = args[key];
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  }

  // Handle 'fields' specially
  if (args.fields) {
    const fieldsStr = Array.isArray(args.fields)
      ? args.fields.join(",")
      : args.fields;
    params.set("fields", fieldsStr);
  }

  const qs = params.toString();
  return `http://localhost:${CONFIG.TOOLS_SERVICE_PORT}${path}${qs ? `?${qs}` : ""}`;
}

// ── Arg remaps (same as Prism's ToolOrchestratorService) ────
const ARG_REMAPS = {
  search_events: { query: "q" },
  search_products: { query: "q" },
};

// ── Execute tool via internal HTTP ──────────────────────────
async function executeTool(toolName, endpoint, args = {}, context = {}) {
  const remaps = ARG_REMAPS[toolName];
  let resolvedArgs = args;
  if (remaps) {
    resolvedArgs = { ...args };
    for (const [from, to] of Object.entries(remaps)) {
      if (resolvedArgs[from] !== undefined) {
        resolvedArgs[to] = resolvedArgs[from];
        delete resolvedArgs[from];
      }
    }
  }

  try {
    if (endpoint.method === "POST") {
      const url = `http://localhost:${CONFIG.TOOLS_SERVICE_PORT}${endpoint.path}`;
      const headers = { "Content-Type": "application/json" };
      if (context.project) headers["X-Project"] = context.project;
      if (context.agent) headers["X-Agent"] = context.agent;
      if (context.username) headers["X-Username"] = context.username;

      // Also inject into body for endpoints that might read from body
      const bodyArgs = { ...resolvedArgs };
      if (context.project && !bodyArgs.project) bodyArgs.project = context.project;
      if (context.agent && !bodyArgs.agent) bodyArgs.agent = context.agent;
      if (context.username && !bodyArgs.username) bodyArgs.username = context.username;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyArgs),
      });
      if (!res.ok) {
        return { error: `API returned ${res.status}: ${res.statusText}` };
      }
      // Check content type — some POST endpoints return binary
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        return await res.json();
      }
      return { result: await res.text() };
    }

    const url = buildUrl(endpoint, resolvedArgs);
    const headers = {};
    if (context.project) headers["X-Project"] = context.project;
    if (context.agent) headers["X-Agent"] = context.agent;
    if (context.username) headers["X-Username"] = context.username;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { error: `API returned ${res.status}: ${res.statusText}` };
    }
    return await res.json();
  } catch (err) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}

// ── Create the MCP Server ───────────────────────────────────
function createMcpServer(context = {}) {
  const server = new Server(
    { name: "sun-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // Build tool schema map (full schemas with endpoint metadata)
  const fullSchemas = getToolSchemas();
  const toolMap = new Map();
  for (const schema of fullSchemas) {
    toolMap.set(schema.name, schema);
  }

  // Register tools/list handler
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      const aiSchemas = getToolSchemasForAI();
      return {
        tools: aiSchemas.map((t) => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.parameters || { type: "object", properties: {} },
        })),
      };
    },
  );

  // Register tools/call handler
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name, arguments: args = {} } = request.params;
      const schema = toolMap.get(name);

      if (!schema || !schema.endpoint) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
      }

      try {
        const result = await executeTool(name, schema.endpoint, args, context);
        const text = typeof result === "string" ? result : JSON.stringify(result);
        return {
          content: [{ type: "text", text }],
          isError: !!result?.error,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ── Mount MCP routes on Express app ─────────────────────────
// LM Studio connects to the SSE endpoint for MCP communication.
// Sessions are tracked per-connection to support multiple clients.
export function mountMcpRoutes(app) {
  const sessions = new Map();

  app.get("/mcp/sse", async (req, res) => {
    const transport = new SSEServerTransport("/mcp/messages", res);
    const context = {
      project: req.query.project,
      agent: req.query.agent,
      username: req.query.username,
    };
    const server = createMcpServer(context);

    sessions.set(transport.sessionId, { server, transport });

    res.on("close", () => {
      sessions.delete(transport.sessionId);
      server.close().catch(() => {});
    });

    await server.connect(transport);
  });

  app.post("/mcp/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    const session = sessions.get(sessionId);

    if (!session) {
      res.status(400).json({ error: "Invalid or expired session" });
      return;
    }

    await session.transport.handlePostMessage(req, res, req.body);
  });

  console.log("   🔌 MCP adapter mounted at /mcp/sse");
}
