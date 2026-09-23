import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// lupos-bot owns the wolf's gold caps and clamps silently
// (src/commands/utility/gold/luposAgentGold.ts: gift 1-5g, mug 1-3g). When
// the economy was cut to a tenth (lupos-bot f6c0319) these descriptions kept
// advertising 5-50g and 5-25g, so the agent asked for amounts that could
// never move and announced them as if they had. Change both together.

function loadTools(locale: string): Record<string, string> {
  const path = fileURLToPath(
    new URL(`../../locales/${locale}/tools.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

describe.each(["en", "caveman"])("Discord gold tool docs (%s)", (locale) => {
  const tools = loadTools(locale);

  it("give_discord_gold states the 1-5g cap", () => {
    expect(tools["give_discord_gold.description"]).toContain("1-5g");
    expect(tools["give_discord_gold.params.amount"]).toContain("1-5");
  });

  it("mug_discord_gold states the 1-3g cap", () => {
    expect(tools["mug_discord_gold.description"]).toContain("1-3g");
    expect(tools["mug_discord_gold.params.amount"]).toContain("1-3");
  });

  it("no gold tool text promises the pre-cut amounts", () => {
    const goldText = Object.entries(tools)
      .filter(([key]) => /_discord_gold\./.test(key))
      .map(([, value]) => value)
      .join("\n");
    expect(goldText).not.toMatch(/5-50|5-25/);
  });
});
