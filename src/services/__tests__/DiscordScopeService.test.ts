import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DISCORD_CONTEXT_HEADERS,
  DISCORD_SCOPE_ERRORS,
  DiscordRefusal,
  clearVisibleChannelsCache,
  getVisibleChannels,
  readDiscordScope,
  requireDiscordConversation,
  scopeChannelRead,
  scopeGuildAndChannel,
  scopedGuildId,
} from "../DiscordScopeService.ts";

// ═══════════════════════════════════════════════════════════════
// DiscordScopeService — what a Discord conversation may reach
//
// Header parsing, the guild rule, and lupos-bot's visible-channel list
// (fetch stubbed) with its 60 s per-(guild, user) cache.
// ═══════════════════════════════════════════════════════════════

const GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const CHANNEL = "333333333333333333";
const VISIBLE_CHANNEL = "444444444444444444";
const HIDDEN_CHANNEL = "555555555555555555";
const THREAD = "666666666666666666";
const USER = "777777777777777777";

const SCOPE = { guildId: GUILD, channelId: CHANNEL, userId: USER };

function headers(values: Partial<Record<"guildId" | "channelId" | "userId", string>>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      DISCORD_CONTEXT_HEADERS[key as keyof typeof DISCORD_CONTEXT_HEADERS],
      value,
    ]),
  );
}

/** Whatever `run` throws (or fails the test if it does not). */
async function caught(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearVisibleChannelsCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    jsonResponse({
      guildId: GUILD,
      userId: USER,
      channelIds: [VISIBLE_CHANNEL],
      threadIds: [THREAD],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readDiscordScope", () => {
  it("is null without any Discord header — not a Discord conversation", () => {
    expect(readDiscordScope({ "x-project": "prism" })).toBeNull();
    expect(readDiscordScope(headers({ guildId: "  " }))).toBeNull();
  });

  it("reads all three headers", () => {
    expect(
      readDiscordScope(headers({ guildId: GUILD, channelId: CHANNEL, userId: USER })),
    ).toEqual(SCOPE);
  });

  it("keeps a partial context as Discord's, with the missing parts null", () => {
    expect(readDiscordScope(headers({ userId: USER }))).toEqual({
      guildId: null,
      channelId: null,
      userId: USER,
    });
  });

  it("treats a header that is not a snowflake as present but unusable", () => {
    expect(readDiscordScope(headers({ guildId: "not-a-guild" }))).toEqual({
      guildId: null,
      channelId: null,
      userId: null,
    });
  });
});

describe("scopedGuildId", () => {
  it("passes the requested value through untouched outside Discord", () => {
    expect(scopedGuildId(null, OTHER_GUILD)).toBe(OTHER_GUILD);
    expect(scopedGuildId(null, undefined)).toBeUndefined();
  });

  it("defaults a missing guild to the conversation's", () => {
    expect(scopedGuildId(SCOPE, undefined)).toBe(GUILD);
    expect(scopedGuildId(SCOPE, "")).toBe(GUILD);
    expect(scopedGuildId(SCOPE, GUILD)).toBe(GUILD);
  });

  it("refuses another guild with the exact error", async () => {
    const error = await caught(() => scopedGuildId(SCOPE, OTHER_GUILD));
    expect(error).toBeInstanceOf(DiscordRefusal);
    expect((error as DiscordRefusal).status).toBe(403);
    expect((error as DiscordRefusal).body).toEqual({
      error: "Lupos can only reach into the server this conversation is in.",
    });
  });

  it("refuses every guild when the conversation has none (fails closed)", async () => {
    const error = await caught(() =>
      scopedGuildId({ guildId: null, channelId: CHANNEL, userId: USER }, undefined),
    );
    expect((error as DiscordRefusal).body.error).toBe(DISCORD_SCOPE_ERRORS.otherGuild);
  });
});

describe("requireDiscordConversation", () => {
  it("returns the full conversation", () => {
    expect(requireDiscordConversation(SCOPE)).toEqual(SCOPE);
  });

  it.each([
    ["no Discord context", null],
    ["no requester", { ...SCOPE, userId: null }],
    ["no channel", { ...SCOPE, channelId: null }],
    ["no guild", { ...SCOPE, guildId: null }],
  ])("refuses with %s", async (_label, scope) => {
    const error = await caught(() => requireDiscordConversation(scope));
    expect((error as DiscordRefusal).status).toBe(403);
    expect((error as DiscordRefusal).body.error).toBe(
      "This tool only works inside a Discord conversation with Lupos.",
    );
  });
});

describe("getVisibleChannels", () => {
  const calledUrl = (call = 0) => new URL(String(fetchMock.mock.calls[call][0]));

  it("asks lupos-bot for the requester's view", async () => {
    const visible = await getVisibleChannels(GUILD, USER);
    expect(calledUrl().pathname).toBe("/guild/visible-channels");
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      guildId: GUILD,
      userId: USER,
    });
    expect([...visible.channelIds]).toEqual([VISIBLE_CHANNEL]);
    expect([...visible.threadIds]).toEqual([THREAD]);
  });

  it("asks for the @everyone view without a user", async () => {
    await getVisibleChannels(GUILD, null);
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({ guildId: GUILD });
  });

  it("caches per (guild, user) for 60 s", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await getVisibleChannels(GUILD, USER);
    await getVisibleChannels(GUILD, USER);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await getVisibleChannels(GUILD, null);
    await getVisibleChannels(OTHER_GUILD, USER);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now.mockReturnValue(1_000_000 + 59_999);
    await getVisibleChannels(GUILD, USER);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now.mockReturnValue(1_000_000 + 60_000);
    await getVisibleChannels(GUILD, USER);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("relays an unknown guild/member as a refusal and does not cache it", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ error: "Member not found" }, 404),
    );
    const error = await caught(() => getVisibleChannels(GUILD, USER));
    expect(error).toBeInstanceOf(DiscordRefusal);
    expect((error as DiscordRefusal).status).toBe(404);
    expect((error as DiscordRefusal).body.error).toContain("Member not found");

    await getVisibleChannels(GUILD, USER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails as a service error (not a refusal) when lupos-bot is down or unreadable", async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: "boom" }, 503));
    const down = await caught(() => getVisibleChannels(GUILD, USER));
    expect(down).not.toBeInstanceOf(DiscordRefusal);

    fetchMock.mockImplementationOnce(async () => jsonResponse({ channelIds: "all" }));
    const unreadable = await caught(() => getVisibleChannels(GUILD, USER));
    expect(unreadable).not.toBeInstanceOf(DiscordRefusal);
    expect(String(unreadable)).toContain("unreadable");
  });
});

describe("scopeChannelRead", () => {
  it("is null outside Discord", async () => {
    expect(await scopeChannelRead(null, OTHER_GUILD, HIDDEN_CHANNEL)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists visible channels, threads and the conversation's own channel", async () => {
    const scoped = await scopeChannelRead(SCOPE, undefined, undefined);
    expect(scoped?.guildId).toBe(GUILD);
    expect(scoped?.channelId).toBeUndefined();
    expect(scoped?.visibleChannelIds.sort()).toEqual(
      [VISIBLE_CHANNEL, THREAD, CHANNEL].sort(),
    );
  });

  it("allows an explicit visible channel or thread", async () => {
    expect((await scopeChannelRead(SCOPE, GUILD, VISIBLE_CHANNEL))?.channelId).toBe(
      VISIBLE_CHANNEL,
    );
    expect((await scopeChannelRead(SCOPE, GUILD, THREAD))?.channelId).toBe(THREAD);
  });

  it("refuses an explicit channel the requester can't see", async () => {
    const error = await caught(() => scopeChannelRead(SCOPE, GUILD, HIDDEN_CHANNEL));
    expect((error as DiscordRefusal).status).toBe(403);
    expect((error as DiscordRefusal).body.error).toContain("a channel you can't see");
  });
});

describe("scopeGuildAndChannel", () => {
  it("passes both through outside Discord", async () => {
    expect(await scopeGuildAndChannel(null, OTHER_GUILD, HIDDEN_CHANNEL)).toEqual({
      guildId: OTHER_GUILD,
      channelId: HIDDEN_CHANNEL,
    });
  });

  it("accepts the conversation's own channel without asking lupos-bot", async () => {
    expect(await scopeGuildAndChannel(SCOPE, undefined, CHANNEL)).toEqual({
      guildId: GUILD,
      channelId: CHANNEL,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults a missing channel to the conversation's when asked to", async () => {
    expect(
      await scopeGuildAndChannel(SCOPE, GUILD, undefined, {
        defaultToConversationChannel: true,
      }),
    ).toEqual({ guildId: GUILD, channelId: CHANNEL });
    expect(await scopeGuildAndChannel(SCOPE, GUILD, undefined)).toEqual({
      guildId: GUILD,
      channelId: undefined,
    });
  });

  it("refuses a hidden channel", async () => {
    const error = await caught(() => scopeGuildAndChannel(SCOPE, GUILD, HIDDEN_CHANNEL));
    expect((error as DiscordRefusal).body.error).toBe(DISCORD_SCOPE_ERRORS.hiddenChannel);
  });
});
