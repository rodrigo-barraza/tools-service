// ────────────────────────────────────────────────────────────
// MCP Adapter — Bridges tools-api REST endpoints to MCP
// ────────────────────────────────────────────────────────────
// Exposes all tools from ToolSchemaService as MCP tools so
// LM Studio can call them via ephemeral MCP integrations.
//
// Transport: SSE (GET /mcp/sse + POST /mcp/messages)
//
// Usage in LM Studio native API (/mcp answers only with the service
// secret — ToolsSecretMiddleware):
//   "integrations": [{
//     "type": "ephemeral_mcp",
//     "server_label": "tools",
//     "server_url": "<TOOLS_SERVICE_URL>/mcp/sse",
//     "headers": { "x-api-secret": "<TOOLS_SERVICE_API_SECRET>" }
//   }]
// ────────────────────────────────────────────────────────────

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getToolSchemas, getToolSchemasForAI } from "./ToolSchemaService.ts";
import CONFIG from "../config.ts";
import logger from "../logger.ts";
import type { Request, Response, Application } from "express";
import { errorMessage } from "../utilities.ts";
import type { ToolEndpoint } from "../types/tools.ts";
import { IDENTITY_HEADERS } from "@rodrigo-barraza/utilities-library/service";
import { toolsSecretHeaders } from "../middleware/ToolsSecretMiddleware.ts";
import { prismUserTokenHeaders } from "../middleware/PrismUserTokenMiddleware.ts";

// ── Self base URL (vault-resolved, localhost fallback) ───────
const SELF_BASE_URL = CONFIG.TOOLS_SERVICE_URL;

// ── Build tool executor URL from endpoint metadata ──────────
function buildUrl(endpoint: ToolEndpoint, args: Record<string, unknown> = {}) {
  let path = endpoint.path;

  // Handle conditional paths
  if (endpoint.conditionalPath) {
    const { param, template } = endpoint.conditionalPath;
    if (args[param]) {
      path = template;
    }
  }

  // Replace path params
  const pathParams = new Set<string>(endpoint.pathParams || []);
  for (const param of pathParams) {
    if (args[param] !== undefined && args[param] !== null) {
      path = path.replace(`:${param}`, encodeURIComponent(String(args[param])));
    }
  }

  // Build query string from remaining params
  const params = new URLSearchParams();
  const queryParams = (endpoint.queryParams as string[]) || [];
  for (const key of queryParams) {
    const value = args[key];
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  // Handle 'fields' specially
  if (args.fields) {
    const fieldsString = Array.isArray(args.fields)
      ? args.fields.join(",")
      : String(args.fields);
    params.set("fields", fieldsString);
  }

  const queryString = params.toString();
  return `${SELF_BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;
}

// ── Arg remaps (same as Prism's ToolOrchestratorService) ────
const ARG_REMAPS: Record<string, Record<string, string>> = {
  search_events: { query: "q" },
  search_products: { query: "q" },
};

// ── Execute tool via internal HTTP ──────────────────────────
// A session exists only past the gate on /mcp, so its calls carry the
// service secret to the gated tools — sent to this service alone — and the
// turn's user token, which a tool's call back into Prism speaks for.
export async function executeTool(
  toolName: string,
  endpoint: ToolEndpoint,
  args: Record<string, unknown> = {},
  context: Record<string, string> = {},
) {
  const remaps = ARG_REMAPS[toolName];
  let resolvedArgs = args;
  if (remaps) {
    resolvedArgs = { ...args };
    for (const [from, to] of Object.entries(remaps as Record<string, string>)) {
      if (resolvedArgs[from] !== undefined) {
        resolvedArgs[to] = resolvedArgs[from];
        delete resolvedArgs[from];
      }
    }
  }

  try {
    const bodyMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    if (endpoint.method && bodyMethods.has(endpoint.method)) {
      const url = buildUrl(endpoint, resolvedArgs).split("?")[0];
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...toolsSecretHeaders(),
        ...prismUserTokenHeaders(),
      };
      if (context.project) headers[IDENTITY_HEADERS.project] = context.project;
      if (context.agent) headers[IDENTITY_HEADERS.agent] = context.agent;
      if (context.username) headers[IDENTITY_HEADERS.username] = context.username;

      // Also inject into body for endpoints that might read from body
      const bodyArgs = { ...resolvedArgs };
      if (context.project && !bodyArgs.project)
        bodyArgs.project = context.project;
      if (context.agent && !bodyArgs.agent) bodyArgs.agent = context.agent;
      if (context.username && !bodyArgs.username)
        bodyArgs.username = context.username;

      const response = await fetch(url, {
        method: endpoint.method,
        headers,
        body: JSON.stringify(bodyArgs),
      });
      if (!response.ok) {
        return {
          error: `API returned ${response.status}: ${response.statusText}`,
        };
      }
      // Check content type — some POST endpoints return binary
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await response.json();
      }
      return { result: await response.text() };
    }

    const url = buildUrl(endpoint, resolvedArgs);
    const headers: Record<string, string> = {
      ...toolsSecretHeaders(),
      ...prismUserTokenHeaders(),
    };
    if (context.project) headers[IDENTITY_HEADERS.project] = context.project;
    if (context.agent) headers[IDENTITY_HEADERS.agent] = context.agent;
    if (context.username) headers[IDENTITY_HEADERS.username] = context.username;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      return {
        error: `API returned ${response.status}: ${response.statusText}`,
      };
    }
    return await response.json();
  } catch (error: unknown) {
    return { error: `Tool execution failed: ${errorMessage(error)}` };
  }
}

// ── Create the MCP Server ───────────────────────────────────
function createMcpServer(context: Record<string, string> = {}) {
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
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const aiSchemas = getToolSchemasForAI();
    return {
      tools: aiSchemas.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.parameters || { type: "object", properties: {} },
      })),
    };
  });

  // Register tools/call handler
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => {
      const { name, arguments: args = {} } = request.params;
      const schema = toolMap.get(name);

      if (!schema || !schema.endpoint) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await executeTool(name, schema.endpoint, args, context);
        const text =
          typeof result === "string" ? result : JSON.stringify(result);
        return {
          content: [{ type: "text", text }],
          isError: !!result?.error,
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: errorMessage(error) }),
            },
          ],
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
export function mountMcpRoutes(app: Application) {
  const sessions = new Map<
    string,
    { server: Server; transport: SSEServerTransport }
  >();

  app.get("/mcp/sse", async (req: Request, res: Response) => {
    const transport = new SSEServerTransport("/mcp/messages", res);
    const context = {
      project: (req.query.project as string) || "",
      agent: (req.query.agent as string) || "",
      username: (req.query.username as string) || "",
    };
    const server = createMcpServer(context);

    sessions.set(transport.sessionId, { server, transport });

    res.on("close", () => {
      sessions.delete(transport.sessionId);
      server.close().catch(() => {});
    });

    await server.connect(transport);
  });

  app.post("/mcp/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const session = sessions.get(sessionId);

    if (!session) {
      res.status(400).json({ error: "Invalid or expired session" });
      return;
    }

    await session.transport.handlePostMessage(req, res, req.body);
  });

  logger.info("   🔌 MCP adapter mounted at /mcp/sse");
}
