import { describe, it, expect } from "vitest";
import { getToolSchemas } from "../ToolSchemaService.ts";

describe("Dynamic Complexity Scoring", () => {
  it("produces correct scores and tier distribution", () => {
    const schemas = getToolSchemas();

    const targetToolNames = [
      "create_3d_scene", "generate_audio", "create_vector_animation",
      "manipulate_image", "build_meal_plan", "draw_turtle_graphics",
      "get_weather", "evaluate_expression", "get_moon_phase",
      "execute_python", "execute_javascript", "execute_shell",
      "execute_browser_script", "control_browser",
      "search_discord_messages", "get_discord_message_analytics",
      "get_bot_stats", "get_bot_guilds", "create_cron_job",
      "search_torrents", "replace_in_file", "replace_file_block",
      "replace_file_regions", "test_regex", "generate_diagram",
      "transform_json", "execute_command", "run_git",
      "parse_cron_expression", "emit_structured_output",
      "sleep", "think", "get_moon_phase", "get_word_definition",
    ];

    console.log("\n=== KEY TOOLS ===");
    console.log(
      "Name".padEnd(40),
      "Score".padStart(7),
      "Tier".padStart(10),
    );
    console.log("-".repeat(60));

    for (const name of targetToolNames) {
      const schema = schemas.find((schemaItem) => schemaItem.name === name);
      if (schema) {
        console.log(
          schema.name.padEnd(40),
          String(schema.complexityScore.toFixed(1)).padStart(7),
          schema.intelligenceTier.padStart(10),
        );
      }
    }

    const tierCounts: Record<string, number> = {
      frontier: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const schema of schemas) {
      tierCounts[schema.intelligenceTier]++;
    }
    console.log("\n=== DISTRIBUTION ===");
    console.log(tierCounts);
    console.log(`Total: ${schemas.length}`);

    expect(schemas.length).toBeGreaterThan(100);
    expect(tierCounts.frontier).toBeGreaterThan(0);
    expect(tierCounts.high).toBeGreaterThan(0);
    expect(tierCounts.medium).toBeGreaterThan(0);
    expect(tierCounts.low).toBeGreaterThan(0);

    // Code execution tools must be "high" via semantic detection
    const executePython = schemas.find((schema) => schema.name === "execute_python");
    expect(executePython?.intelligenceTier).toBe("high");

    const executeJavascript = schemas.find((schema) => schema.name === "execute_javascript");
    expect(executeJavascript?.intelligenceTier).toBe("high");

    const executeShell = schemas.find((schema) => schema.name === "execute_shell");
    expect(executeShell?.intelligenceTier).toBe("high");

    // control_browser dropped from frontier to high when the run_script
    // action + script param moved out of its schema (2026-07): production
    // usage showed its only real users are small local models, and the
    // code-generation surface lives in execute_browser_script instead.
    const controlBrowser = schemas.find((schema) => schema.name === "control_browser");
    expect(controlBrowser?.intelligenceTier).toBe("high");

    const executeBrowserScript = schemas.find(
      (schema) => schema.name === "execute_browser_script",
    );
    expect(executeBrowserScript?.intelligenceTier).toBe("high");

    // Simple tools must stay low
    const sleep = schemas.find((schema) => schema.name === "sleep");
    expect(sleep?.intelligenceTier).toBe("low");

    const think = schemas.find((schema) => schema.name === "think");
    expect(think?.intelligenceTier).toBe("low");

    const getMoonPhase = schemas.find((schema) => schema.name === "get_moon_phase");
    expect(getMoonPhase?.intelligenceTier).toBe("low");
  });
});
