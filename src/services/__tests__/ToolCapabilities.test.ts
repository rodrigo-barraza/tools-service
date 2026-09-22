// ────────────────────────────────────────────────────────────
// Tool capability tags
// ────────────────────────────────────────────────────────────
// Prism's permission rules match `capability:<tag>`, so a tool with
// no entry is a tool no capability rule can see. Every tool must
// declare, every tag must be in the shared vocabulary, and the
// schema endpoint must carry the tags to prism.
// ────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import request from "supertest";
import {
  TOOL_CAPABILITIES,
  TOOL_CAPABILITY_TAGS,
} from "../ToolCapabilities.ts";
import {
  TOOL_DEFINITIONS,
  getToolSchemas,
  getToolSchemasForAI,
  validateToolRegistries,
} from "../ToolSchemaService.ts";
import adminRoutes from "../../routes/AdminRoutes.ts";
import { createTestApp } from "../../../tests/testApp.ts";

describe("TOOL_CAPABILITIES", () => {
  const report = validateToolRegistries();

  it("every tool declares its capabilities", () => {
    expect(report.missingCapabilities).toEqual([]);
  });

  it("has no entries for tools that no longer exist", () => {
    expect(report.staleKeys.TOOL_CAPABILITIES ?? []).toEqual([]);
  });

  it("uses only the shared vocabulary, without duplicates", () => {
    const vocabulary = new Set<string>(TOOL_CAPABILITY_TAGS);
    for (const [toolName, tags] of Object.entries(TOOL_CAPABILITIES)) {
      for (const tag of tags) {
        expect(vocabulary.has(tag), `${toolName}: ${tag}`).toBe(true);
      }
      expect(new Set(tags).size, toolName).toBe(tags.length);
    }
  });

  it("matches the vocabulary prism-service evaluates", () => {
    // Mirrors prism-service src/services/permissions/types.ts CAPABILITIES.
    expect([...TOOL_CAPABILITY_TAGS]).toEqual([
      "fs_read",
      "fs_write",
      "shell",
      "network",
      "mcp",
      "subagent",
      "memory_write",
      "external_side_effect",
    ]);
  });

  it("tags the tools a permission rule most often targets", () => {
    expect(TOOL_CAPABILITIES.read_file).toEqual(["fs_read"]);
    expect(TOOL_CAPABILITIES.write_file).toEqual(["fs_write"]);
    expect(TOOL_CAPABILITIES.execute_shell).toContain("shell");
    expect(TOOL_CAPABILITIES.execute_command).toContain("shell");
    expect(TOOL_CAPABILITIES.read_web_page).toEqual(["network"]);
    expect(TOOL_CAPABILITIES.send_email).toEqual([
      "network",
      "external_side_effect",
    ]);
    expect(TOOL_CAPABILITIES.save_memory).toEqual(["memory_write"]);
    expect(TOOL_CAPABILITIES.convert_units).toEqual([]);
  });

  it("marks every tool that runs a process as shell", () => {
    for (const toolName of [
      "execute_shell",
      "execute_command",
      "execute_python",
      "execute_javascript",
      "debug",
    ]) {
      expect(TOOL_CAPABILITIES[toolName], toolName).toContain("shell");
    }
  });
});

describe("schemas carry capabilities", () => {
  it("getToolSchemas and getToolSchemasForAI include the declared tags", () => {
    const full = getToolSchemas();
    const forAI = getToolSchemasForAI();
    for (const schemas of [full, forAI]) {
      const readFile = schemas.find((schema) => schema.name === "read_file");
      expect(readFile?.capabilities).toEqual(["fs_read"]);
    }
    // Every schema served is covered — nothing reaches prism untagged.
    expect(full.every((schema) => Array.isArray(schema.capabilities))).toBe(
      true,
    );
  });

  it("returns a copy, so a consumer cannot mutate the registry", () => {
    const readFile = getToolSchemas().find(
      (schema) => schema.name === "read_file",
    );
    readFile?.capabilities?.push("shell");
    expect(TOOL_CAPABILITIES.read_file).toEqual(["fs_read"]);
  });

  it("GET /admin/tool-schemas serves them", async () => {
    const app = createTestApp("/admin", adminRoutes);
    const response = await request(app).get("/admin/tool-schemas");
    expect(response.status).toBe(200);
    const executeShell = (
      response.body as Array<{ name: string; capabilities?: string[] }>
    ).find((schema) => schema.name === "execute_shell");
    expect(executeShell?.capabilities).toContain("shell");
  });

  it("covers every definition", () => {
    expect(Object.keys(TOOL_CAPABILITIES).length).toBe(TOOL_DEFINITIONS.length);
  });
});
