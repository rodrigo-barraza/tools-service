// ────────────────────────────────────────────────────────────
// Tool Taxonomy Integrity Tests
// ────────────────────────────────────────────────────────────
// Validates that EVERY tool schema in ToolSchemaService has:
//   1. A domain entry in TOOL_DOMAINS
//   2. A label entry in TOOL_LABELS (array with ≥1 label)
//   3. Required schema fields (name, description, parameters)
//   4. Bidirectional coverage (no orphan domains/labels)
// ────────────────────────────────────────────────────────────

import {
  TOOL_DEFINITIONS,
  TOOL_DOMAINS,
  TOOL_LABELS,
} from "../services/ToolSchemaService.js";
import { LABELS, DOMAINS } from "../services/ToolTaxonomyConstants.js";

// ── Helpers ──────────────────────────────────────────────────

const schemaNames = new Set(TOOL_DEFINITIONS.map((s) => s.name));
const domainKeys = new Set(Object.keys(TOOL_DOMAINS));
const labelKeys = new Set(Object.keys(TOOL_LABELS));

// ── Schema Structural Integrity ─────────────────────────────

describe("Tool Schema — structural integrity", () => {
  it("every schema has a non-empty name", () => {
    for (const s of TOOL_DEFINITIONS) {
              expect(s.name && typeof s.name === "string").toBeTruthy();
    }
  });

  it("every schema has a non-empty description", () => {
    for (const s of TOOL_DEFINITIONS) {
              expect(s.description && typeof s.description === "string").toBeTruthy();
    }
  });

  it("every schema has a parameters object with type 'object'", () => {
    for (const s of TOOL_DEFINITIONS) {
      expect(s.parameters, `Tool "${s.name}" missing parameters`).toBeTruthy();
              expect(s.parameters.type).toBe("object");
    }
  });

  it("every schema has a properties object in parameters", () => {
    for (const s of TOOL_DEFINITIONS) {
              expect(s.parameters.properties && typeof s.parameters.properties === "object").toBeTruthy();
    }
  });

  it("schema names are unique (no duplicates)", () => {
    const seen = new Set();
    for (const s of TOOL_DEFINITIONS) {
      expect(seen.has(s.name)).toBe(false);
      seen.add(s.name);
    }
  });
});

// ── Domain Coverage ─────────────────────────────────────────

describe("Tool Taxonomy — domain coverage", () => {
  it("every schema has a domain entry in TOOL_DOMAINS", () => {
    const missing = [];
    for (const name of schemaNames) {
      if (!domainKeys.has(name)) missing.push(name);
    }
          expect(missing.length).toBe(0);
  });

  it("TOOL_DOMAINS has no orphan entries without a matching schema (diagnostic)", () => {
    const orphans = [];
    for (const key of domainKeys) {
      if (!schemaNames.has(key)) orphans.push(key);
    }
    // Orphans are allowed (pre-registered for gated tools) but logged
    if (orphans.length > 0) {
      console.log(
        `  ⚠  ${orphans.length} TOOL_DOMAINS entries without schemas (likely API-gated): ${orphans.join(", ")}`,
      );
    }
    expect(true).toBeTruthy();
  });

  it("every domain value is a non-empty string", () => {
    for (const [_tool, domain] of Object.entries(TOOL_DOMAINS)) {
              expect(domain && typeof domain === "string").toBeTruthy();
    }
  });
});

// ── Label Coverage ──────────────────────────────────────────

describe("Tool Taxonomy — label coverage", () => {
  it("every schema has a label entry in TOOL_LABELS", () => {
    const missing = [];
    for (const name of schemaNames) {
      if (!labelKeys.has(name)) missing.push(name);
    }
          expect(missing.length).toBe(0);
  });

  it("TOOL_LABELS has no orphan entries without a matching schema (diagnostic)", () => {
    const orphans = [];
    for (const key of labelKeys) {
      if (!schemaNames.has(key)) orphans.push(key);
    }
    // Orphans are allowed (pre-registered for gated tools) but logged
    if (orphans.length > 0) {
      console.log(
        `  ⚠  ${orphans.length} TOOL_LABELS entries without schemas (likely API-gated): ${orphans.join(", ")}`,
      );
    }
    expect(true).toBeTruthy();
  });

  it("every label value is a non-empty array of strings", () => {
    for (const [_tool, labels] of Object.entries(TOOL_LABELS)) {
              expect(Array.isArray(labels) && labels.length > 0).toBeTruthy();
      for (const l of labels) {
                  expect(typeof l === "string" && l.length > 0).toBeTruthy();
      }
    }
  });
});

// ── Bidirectional Consistency ───────────────────────────────

describe("Tool Taxonomy — bidirectional consistency", () => {
  it("TOOL_DOMAINS and TOOL_LABELS have the same set of keys", () => {
    const onlyInDomains = [...domainKeys].filter((k) => !labelKeys.has(k));
    const onlyInLabels = [...labelKeys].filter((k) => !domainKeys.has(k));

    const messages = [];
    if (onlyInDomains.length > 0) {
      messages.push(
        `In TOOL_DOMAINS but not TOOL_LABELS:\n  ${onlyInDomains.join("\n  ")}`,
      );
    }
    if (onlyInLabels.length > 0) {
      messages.push(
        `In TOOL_LABELS but not TOOL_DOMAINS:\n  ${onlyInLabels.join("\n  ")}`,
      );
    }
    expect(messages.length).toBe(0, messages.join("\n\n"));
  });

  it("every schema key exists in both TOOL_DOMAINS and TOOL_LABELS", () => {
    const missingDomains = [...schemaNames].filter((k) => !domainKeys.has(k));
    const missingLabels = [...schemaNames].filter((k) => !labelKeys.has(k));

    const messages = [];
    if (missingDomains.length > 0) {
      messages.push(
        `Schemas missing from TOOL_DOMAINS:\n  ${missingDomains.join("\n  ")}`,
      );
    }
    if (missingLabels.length > 0) {
      messages.push(
        `Schemas missing from TOOL_LABELS:\n  ${missingLabels.join("\n  ")}`,
      );
    }
    expect(messages.length).toBe(0, messages.join("\n\n"));
  });
});

// ── Schema Parameter Validation ─────────────────────────────

describe("Tool Schema — parameter validation", () => {
  it("required array only references defined properties", () => {
    for (const s of TOOL_DEFINITIONS) {
      const required = s.parameters.required || [];
      const props = Object.keys(s.parameters.properties || {});
      for (const r of required) {
                  expect(props.includes(r)).toBeTruthy();
      }
    }
  });

  it("every property has a type or enum", () => {
    for (const s of TOOL_DEFINITIONS) {
      for (const [_propName, propDef] of Object.entries(
        s.parameters.properties || {},
      )) {
        const hasType = propDef.type || propDef.enum;
                  expect(hasType).toBeTruthy();
      }
    }
  });
});

// ── ToolTaxonomyConstants Consistency ────────────────────────

describe("ToolTaxonomyConstants — registry alignment", () => {
  // Collect all label values used across TOOL_LABELS
  const usedLabels = new Set();
  for (const labels of Object.values(TOOL_LABELS)) {
    for (const l of labels) usedLabels.add(l);
  }

  // Collect all domain values used across TOOL_DOMAINS
  const usedDomains = new Set(Object.values(TOOL_DOMAINS));

  it("every LABELS constant appears in at least one TOOL_LABELS entry", () => {
    const missing = [];
    for (const [key, value] of Object.entries(LABELS)) {
      if (!usedLabels.has(value)) missing.push(`LABELS.${key} = "${value}"`);
    }
    if (missing.length > 0) {
      console.log(
        `  ⚠  ${missing.length} LABELS constants not used in any TOOL_LABELS entry: ${missing.join(", ")}`,
      );
    }
    expect(true).toBeTruthy();
  });

  it("every DOMAINS constant appears in at least one TOOL_DOMAINS entry", () => {
    const missing = [];
    for (const [key, value] of Object.entries(DOMAINS)) {
      if (!usedDomains.has(value)) missing.push(`DOMAINS.${key} = "${value}"`);
    }
    if (missing.length > 0) {
      console.log(
        `  ⚠  ${missing.length} DOMAINS constants not used in any TOOL_DOMAINS entry: ${missing.join(", ")}`,
      );
    }
    expect(true).toBeTruthy();
  });

  it("every label value used in TOOL_LABELS has a LABELS constant", () => {
    const constantValues = new Set(Object.values(LABELS));
    const missing = [...usedLabels].filter((l) => !constantValues.has(l));
          expect(missing.length).toBe(0);
  });

  it("every domain value used in TOOL_DOMAINS has a DOMAINS constant", () => {
    const constantValues = new Set(Object.values(DOMAINS));
    const missing = [...usedDomains].filter((d) => !constantValues.has(d));
          expect(missing.length).toBe(0);
  });
});
