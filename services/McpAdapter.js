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
  return `http://localhost:${CONFIG.TOOLS_PORT}${path}${qs ? `?${qs}` : ""}`;
}

// ── Arg remaps (same as Prism's ToolOrchestratorService) ────
const ARG_REMAPS = {
  search_events: { query: "q" },
  search_products: { query: "q" },
};

// ── Execute tool via internal HTTP ──────────────────────────
async function executeTool(toolName, endpoint, args = {}) {
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
      const url = `http://localhost:${CONFIG.TOOLS_PORT}${endpoint.path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resolvedArgs),
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
    const res = await fetch(url);
    if (!res.ok) {
      return { error: `API returned ${res.status}: ${res.statusText}` };
    }
    return await res.json();
  } catch (err) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}

// ── Create the MCP Server ───────────────────────────────────
function createMcpServer() {
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
        const result = await executeTool(name, schema.endpoint, args);
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
    const server = createMcpServer();

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
