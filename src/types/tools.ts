/**
 * Tool Schema System TypeScript Definitions
 */

// ─── Tool Endpoint ─────────────────────────────────────────────

export interface ToolConditionalPath {
  param: string;
  template: string;
}

export interface ToolEndpoint {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  queryParams?: string[];
  pathParams?: string[];
  bodyParams?: string[];
  conditionalPath?: ToolConditionalPath;
}

// ─── Tool Definition ───────────────────────────────────────────

export interface ToolParameterProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty | { type: string; properties?: Record<string, ToolParameterProperty>; required?: string[] };
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  anyOf?: ToolParameterProperty[];
}

export interface ToolParameters {
  type: string;
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

// ─── Data Source Metadata ───────────────────────────────────────

export interface CachedDataSource {
  type: "cached";
  provider: string;
  intervalSeconds: number;
}

export interface OnDemandDataSource {
  type: "onDemand";
  provider: string;
}

export interface StaticDataSource {
  type: "static";
  provider: string;
  dataset: string;
}

export interface ComputeDataSource {
  type: "compute";
  provider: string;
  runtime: string;
}

export interface RealtimeDataSource {
  type: "realtime";
  provider: string;
}

export type ToolDataSource =
  | CachedDataSource
  | OnDemandDataSource
  | StaticDataSource
  | ComputeDataSource
  | RealtimeDataSource;

export type ToolIntelligenceTier = "low" | "medium" | "high" | "frontier";

// ─── Tool Display Metadata ──────────────────────────────────────
// Canonical source: @rodrigo-barraza/utilities-library
import {
  type ToolDisplayMetadata,
  type ToolDisplaySubjectFormat,
} from "@rodrigo-barraza/utilities-library";
export { type ToolDisplayMetadata, type ToolDisplaySubjectFormat };
import type { ToolCapabilityTag } from "../services/ToolCapabilities.ts";

// ─── Tool Definition ───────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  dataSource?: ToolDataSource;
  endpoint?: ToolEndpoint;
  parameters?: ToolParameters;
  intelligenceTier?: ToolIntelligenceTier;
  display?: ToolDisplayMetadata;
}

// ─── Enriched Tool Schema (returned by getToolSchemas) ─────────

export interface ToolSchema extends ToolDefinition {
  domain: string;
  domainKey?: string;
  emoji: string | null;
  intelligenceTier: ToolIntelligenceTier;
  complexityScore: number;
  /** What the tool can do (`ToolCapabilities.ts`). Absent = not declared. */
  capabilities?: ToolCapabilityTag[];
}

// ─── Stripped schema for AI consumption ─────────────────────────

export type ToolSchemaForAI = Omit<
  ToolDefinition,
  "endpoint" | "dataSource"
> & {
  intelligenceTier: ToolIntelligenceTier;
  complexityScore: number;
  capabilities?: ToolCapabilityTag[];
};

// ─── Scored match from AgenticToolSearchService ─────────────────

export interface ScoredToolMatch {
  schema: ToolSchema;
  score: number;
}

// ─── Tool search result entry ───────────────────────────────────

export interface ToolSearchMatch {
  name: string;
  description: string;
  domain: string | null;
  parameters: ToolParameters | null;
  isEnabled?: boolean;
  /** Present on "recipe:*" matches — a multi-tool plan for a goal. */
  recipe?: {
    title: string;
    steps: string;
    tools: string[];
    /** Subset of tools the recipe cannot work without (availability gate). */
    requiredTools: string[];
  };
}
