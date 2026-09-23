import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getLocalizedToolDefinitions } from "../ToolSchemaService.ts";

// The Discord action tools (polls, threads, reminders, Lupos's nickname)
// act where the conversation is: guild, channel and requester come from
// the x-discord-* headers, never from the model — so no action tool may
// offer them as parameters. Their descriptions must state the caps
// lupos-bot enforces, or the agent asks for what can never happen (see
// DiscordGoldToolDocs.test.ts). Parameter names are the cross-repo
// contract with lupos-bot and Prism's persona; change them together.

const ACTION_TOOL_PARAMETERS: Record<string, string[]> = {
  create_discord_poll: ["question", "answers", "durationHours", "allowMultiselect"],
  create_discord_thread: ["name", "messageId", "autoArchiveMinutes"],
  schedule_discord_reminder: ["text", "delayMinutes", "dueAt"],
  list_discord_reminders: [],
  cancel_discord_reminder: ["reminderId"],
  set_discord_nickname: ["nickname"],
};

function loadTools(locale: string): Record<string, string> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/tools.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Discord action tool definitions", () => {
  const definitions = getLocalizedToolDefinitions("en");

  it.each(Object.entries(ACTION_TOOL_PARAMETERS))(
    "%s takes exactly its contract parameters — no guild, channel or requester",
    (toolName, parameters) => {
      const tool = definitions.find((definition) => definition.name === toolName);
      expect(tool, toolName).toBeDefined();
      expect(Object.keys(tool!.parameters?.properties ?? {})).toEqual(parameters);
      const endpoint = tool!.endpoint!;
      expect([...(endpoint.bodyParams ?? []), ...(endpoint.queryParams ?? [])]).toEqual(
        parameters,
      );
    },
  );
});

describe.each(["en", "caveman"])("Discord action tool docs (%s)", (locale) => {
  const tools = loadTools(locale);

  it("create_discord_poll states its caps", () => {
    const description = tools["create_discord_poll.description"];
    for (const cap of ["300", "2-10", "55", "1-168", "24", "10 min"]) {
      expect(description).toContain(cap);
    }
  });

  it("create_discord_thread states its caps", () => {
    const description = tools["create_discord_thread.description"];
    expect(description).toContain("100");
    expect(description).toContain("10 min");
    expect(tools["create_discord_thread.params.autoArchiveMinutes"]).toContain(
      "60, 1440, 4320 or 10080",
    );
  });

  it("schedule_discord_reminder states its caps and that it is only for the requester", () => {
    const description = tools["schedule_discord_reminder.description"];
    for (const cap of ["300", "1-43200", "30 d", "5 pending", "100"]) {
      expect(description).toContain(cap);
    }
    expect(description).toMatch(/never anyone else/);
  });

  it("set_discord_nickname states its caps and that it is Lupos's own", () => {
    const description = tools["set_discord_nickname.description"];
    expect(description).toContain("32");
    expect(description).toContain("10 min");
    expect(description).toMatch(/never anyone else/);
  });
});
