import { vi } from "vitest";

/**
 * Shared fixtures for the Discord route tests: snowflakes, the three
 * Discord context headers, and a stubbed lupos-bot behind global fetch
 * (supertest itself does not use fetch, so the stub only sees the
 * routes' own calls to lupos-bot).
 */

export const GUILD = "111111111111111111";
export const OTHER_GUILD = "222222222222222222";
export const CHANNEL = "333333333333333333";
export const VISIBLE_CHANNEL = "444444444444444444";
export const HIDDEN_CHANNEL = "555555555555555555";
export const THREAD = "666666666666666666";
export const USER = "777777777777777777";

export const OTHER_GUILD_ERROR =
  "Lupos can only reach into the server this conversation is in.";
export const HIDDEN_CHANNEL_ERROR = "Lupos can't reach into a channel you can't see.";
export const OUTSIDE_CONVERSATION_ERROR =
  "This tool only works inside a Discord conversation with Lupos.";

/** Everything Prism sends for a Discord turn. */
export const DISCORD_HEADERS = {
  "x-discord-guild-id": GUILD,
  "x-discord-channel-id": CHANNEL,
  "x-discord-user-id": USER,
};

export interface LuposBotReply {
  status?: number;
  body: unknown;
}

/** Replies keyed "METHOD /path"; anything unexpected is a 500. */
export const luposBotReplies = new Map<string, LuposBotReply>();

export const luposBotFetch = vi.fn(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const reply = luposBotReplies.get(`${init?.method ?? "GET"} ${url.pathname}`) ?? {
      status: 500,
      body: { error: `unexpected lupos-bot call ${url.pathname}` },
    };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  },
);

/** A lupos-bot call as the route made it. */
export interface LuposBotCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

export function luposBotCalls(path?: string): LuposBotCall[] {
  return luposBotFetch.mock.calls
    .map(([input, init]) => {
      const url = new URL(String(input));
      return {
        method: init?.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
    })
    .filter((call) => path === undefined || call.path === path);
}

/** lupos-bot's GET /guild/visible-channels answer for the requester. */
export function replyVisibleChannels(
  channelIds: string[] = [VISIBLE_CHANNEL],
  threadIds: string[] = [THREAD],
) {
  luposBotReplies.set("GET /guild/visible-channels", {
    body: { guildId: GUILD, userId: USER, channelIds, threadIds },
  });
}
