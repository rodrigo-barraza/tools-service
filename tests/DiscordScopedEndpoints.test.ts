import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import {
  CHANNEL,
  DISCORD_HEADERS,
  GUILD,
  HIDDEN_CHANNEL,
  HIDDEN_CHANNEL_ERROR,
  OTHER_GUILD,
  OTHER_GUILD_ERROR,
  THREAD,
  USER,
  VISIBLE_CHANNEL,
  luposBotCalls,
  luposBotFetch,
  luposBotReplies,
  replyVisibleChannels,
} from "./discordTestHarness.ts";

// ═══════════════════════════════════════════════════════════════
// Discord scope — a Discord conversation reaches only its own server
// and the channels its requester can see
//
// Prism sends x-discord-guild-id / -channel-id / -user-id for a Discord
// turn. The archive is a mocked Messages collection (the real
// DiscordDataService builds the filters); lupos-bot is a stubbed fetch.
// ═══════════════════════════════════════════════════════════════

let mockFind: ReturnType<typeof vi.fn>;
let mockCountDocuments: ReturnType<typeof vi.fn>;
let mockAggregate: ReturnType<typeof vi.fn>;

function createCollection() {
  const toArray = vi.fn(async () => []);
  const project = vi.fn(() => ({ toArray }));
  const limit = vi.fn(() => ({ project }));
  const sort = vi.fn(() => ({ limit }));
  mockFind = vi.fn(() => ({ sort, project }));
  mockCountDocuments = vi.fn(async () => 0);
  mockAggregate = vi.fn(() => ({ toArray: vi.fn(async () => []) }));
  return { find: mockFind, countDocuments: mockCountDocuments, aggregate: mockAggregate };
}

let collection: ReturnType<typeof createCollection>;

vi.mock("../src/models/LuposMessage.ts", () => ({
  getMessagesCollection: vi.fn(() => collection),
}));

const { default: discordRoutes } = await import("../src/routes/DiscordRoutes.ts");
const { clearVisibleChannelsCache } = await import("../src/services/DiscordScopeService.ts");

const app = createTestApp("/discord", discordRoutes);

const lastFindFilter = () => mockFind.mock.calls.at(-1)?.[0];

beforeEach(() => {
  collection = createCollection();
  clearVisibleChannelsCache();
  luposBotReplies.clear();
  luposBotFetch.mockClear();
  replyVisibleChannels();
  vi.stubGlobal("fetch", luposBotFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Without Discord headers — exactly as before ──────────────

describe("without Discord context, the read tools behave as before", () => {
  it("searches any guild asked for, unrestricted by channel, without asking lupos-bot", async () => {
    const res = await request(app).get(`/discord/messages/search?guildId=${OTHER_GUILD}`);
    expect(res.status).toBe(200);
    expect(lastFindFilter().guildId).toBe(OTHER_GUILD);
    expect(lastFindFilter().channelId).toBeUndefined();
    expect(luposBotFetch).not.toHaveBeenCalled();
  });

  it("searches every guild when none is given", async () => {
    await request(app).get(`/discord/messages/search?channelId=${HIDDEN_CHANNEL}`).expect(200);
    expect(lastFindFilter().guildId).toBeUndefined();
    expect(lastFindFilter().channelId).toBe(HIDDEN_CHANNEL);
  });

  it("forwards lupos-bot reads as given, with no requester", async () => {
    luposBotReplies.set("GET /guild/members", { body: { guildId: OTHER_GUILD, roles: [] } });
    const res = await request(app).get(`/discord/guild/members?guildId=${OTHER_GUILD}`);
    expect(res.body).toEqual({ guildId: OTHER_GUILD, roles: [] });
    expect(luposBotCalls()).toEqual([
      { method: "GET", path: "/guild/members", query: { guildId: OTHER_GUILD }, body: undefined },
    ]);
  });

  it("lists every guild", async () => {
    const guilds = [{ id: GUILD }, { id: OTHER_GUILD }];
    luposBotReplies.set("GET /bot/guilds", { body: { count: 2, guilds } });
    const res = await request(app).get("/discord/bot/guilds");
    expect(res.body).toEqual({ count: 2, guilds });
  });

  it("lists every channel and every channel's stats", async () => {
    const channels = [{ id: VISIBLE_CHANNEL }, { id: HIDDEN_CHANNEL }];
    luposBotReplies.set("GET /guild/channels", { body: { guildId: GUILD, channels } });
    expect((await request(app).get(`/discord/guild/channels?guildId=${GUILD}`)).body.channels).toEqual(
      channels,
    );
  });

  it("forwards a POST body as given, minus any requester/scope the model made up", async () => {
    luposBotReplies.set("POST /guild/react", { body: { success: true } });
    const res = await request(app).post("/discord/guild/react").send({
      guildId: OTHER_GUILD,
      channelId: HIDDEN_CHANNEL,
      messageId: "1526820952019701853",
      emoji: "👍",
      requesterUserId: USER,
      scopeGuildId: OTHER_GUILD,
    });
    expect(res.body).toEqual({ success: true });
    expect(luposBotCalls("/guild/react")[0].body).toEqual({
      guildId: OTHER_GUILD,
      channelId: HIDDEN_CHANNEL,
      messageId: "1526820952019701853",
      emoji: "👍",
    });
  });
});

// ── Guild scope ──────────────────────────────────────────────

describe("inside a Discord conversation, only its own server", () => {
  it("defaults a missing guildId to the conversation's", async () => {
    await request(app).get("/discord/messages/search").set(DISCORD_HEADERS).expect(200);
    expect(lastFindFilter().guildId).toBe(GUILD);
  });

  it.each([
    ["/discord/messages/search"],
    ["/discord/messages/analytics"],
    ["/discord/activity"],
  ])("refuses another guild on %s before touching the archive", async (path) => {
    const res = await request(app).get(`${path}?guildId=${OTHER_GUILD}`).set(DISCORD_HEADERS);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: OTHER_GUILD_ERROR });
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(mockCountDocuments).not.toHaveBeenCalled();
  });

  it("fails closed for a Discord context without a guild", async () => {
    const res = await request(app)
      .get("/discord/messages/search")
      .set({ "x-discord-user-id": USER, "x-discord-channel-id": CHANNEL });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: OTHER_GUILD_ERROR });
  });

  const LUPOS_BOT_READS: Array<[string, string, Record<string, string>]> = [
    ["/discord/guild/members", "/guild/members", {}],
    ["/discord/guild/emojis", "/guild/emojis", {}],
    ["/discord/guild/voice-members", "/guild/voice-members", {}],
    ["/discord/guild/user-profile", "/guild/user-profile", { userId: USER }],
    ["/discord/gold/balance", "/gold/balance", { userId: USER }],
    ["/discord/guild/word-frequencies", "/guild/word-frequencies", { userId: USER }],
    ["/discord/guild/heatmap", "/guild/heatmap", { userId: USER }],
    ["/discord/guild/mentions", "/guild/mentions", { userId: USER }],
    ["/discord/guild/leaderboard", "/guild/leaderboard", {}],
    ["/discord/guild/channel-stats", "/guild/channel-stats", {}],
    ["/discord/guild/channels", "/guild/channels", {}],
  ];

  it.each(LUPOS_BOT_READS)(
    "%s forwards the conversation's guild and the requester",
    async (path, luposPath, extraQuery) => {
      luposBotReplies.set(`GET ${luposPath}`, { body: { ok: true } });
      const query = new URLSearchParams(extraQuery).toString();
      const res = await request(app).get(`${path}?${query}`).set(DISCORD_HEADERS);
      expect(res.status).toBe(200);
      expect(luposBotCalls(luposPath)[0].query).toEqual({
        ...extraQuery,
        guildId: GUILD,
        requesterUserId: USER,
      });
    },
  );

  it.each(LUPOS_BOT_READS)("%s refuses another guild", async (path, luposPath) => {
    const res = await request(app).get(`${path}?guildId=${OTHER_GUILD}`).set(DISCORD_HEADERS);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: OTHER_GUILD_ERROR });
    expect(luposBotCalls(luposPath)).toEqual([]);
  });

  it("lists only the conversation's guild from get_bot_guilds", async () => {
    luposBotReplies.set("GET /bot/guilds", {
      body: { count: 2, guilds: [{ id: OTHER_GUILD, name: "B" }, { id: GUILD, name: "A" }] },
    });
    const res = await request(app).get("/discord/bot/guilds").set(DISCORD_HEADERS);
    expect(res.body).toEqual({ count: 1, guilds: [{ id: GUILD, name: "A" }] });
  });

  it("forwards the requester on the guild-less bot reads", async () => {
    luposBotReplies.set("GET /bot/stats", { body: { somatic: {} } });
    luposBotReplies.set("GET /bot/activity", { body: { hours: [] } });
    await request(app).get("/discord/bot/stats").set(DISCORD_HEADERS).expect(200);
    await request(app).get("/discord/bot/activity").set(DISCORD_HEADERS).expect(200);
    expect(luposBotCalls("/bot/stats")[0].query).toEqual({ requesterUserId: USER });
    expect(luposBotCalls("/bot/activity")[0].query).toEqual({ requesterUserId: USER });
  });

  it.each([["/discord/guild/react"], ["/discord/gold/give"], ["/discord/gold/mug"]])(
    "%s refuses another guild",
    async (path) => {
      const res = await request(app)
        .post(path)
        .set(DISCORD_HEADERS)
        .send({ guildId: OTHER_GUILD, targetUserId: USER, amount: 1, channelId: CHANNEL });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: OTHER_GUILD_ERROR });
      expect(luposBotFetch).not.toHaveBeenCalled();
    },
  );

  it("gives gold in the conversation's guild, carrying the requester and scope", async () => {
    luposBotReplies.set("POST /gold/give", { body: { ok: true, amount: 3 } });
    const res = await request(app)
      .post("/discord/gold/give")
      .set(DISCORD_HEADERS)
      .send({ targetUserId: USER, amount: 3, requesterUserId: "999999999999999999" });
    expect(res.body).toEqual({ ok: true, amount: 3 });
    expect(luposBotCalls("/gold/give")[0].body).toEqual({
      targetUserId: USER,
      amount: 3,
      guildId: GUILD,
      requesterUserId: USER,
      scopeGuildId: GUILD,
    });
  });
});

// ── Channel visibility ───────────────────────────────────────

describe("inside a Discord conversation, only channels the requester can see", () => {
  it("limits a search to the visible channels, threads and the conversation's channel", async () => {
    await request(app).get("/discord/messages/search").set(DISCORD_HEADERS).expect(200);
    expect(luposBotCalls("/guild/visible-channels")[0].query).toEqual({
      guildId: GUILD,
      userId: USER,
    });
    expect(lastFindFilter().channelId.$in.sort()).toEqual(
      [VISIBLE_CHANNEL, THREAD, CHANNEL].sort(),
    );
  });

  it("uses the @everyone view when no requester is known", async () => {
    await request(app)
      .get("/discord/messages/search")
      .set({ "x-discord-guild-id": GUILD, "x-discord-channel-id": CHANNEL })
      .expect(200);
    expect(luposBotCalls("/guild/visible-channels")[0].query).toEqual({ guildId: GUILD });
  });

  it("refuses an explicit channel the requester can't see", async () => {
    const res = await request(app)
      .get(`/discord/messages/search?channelId=${HIDDEN_CHANNEL}`)
      .set(DISCORD_HEADERS);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: HIDDEN_CHANNEL_ERROR });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("reads a visible thread (archived under the thread's own ID)", async () => {
    await request(app)
      .get(`/discord/messages/search?channelId=${THREAD}`)
      .set(DISCORD_HEADERS)
      .expect(200);
    expect(lastFindFilter().channelId).toBe(THREAD);
  });

  it("holds a message-ID lookup to the visible channels", async () => {
    await request(app)
      .get("/discord/messages/search?messageId=1526820952019701853")
      .set(DISCORD_HEADERS)
      .expect(200);
    expect(lastFindFilter()).toMatchObject({
      id: "1526820952019701853",
      guildId: GUILD,
      channelId: { $in: expect.arrayContaining([VISIBLE_CHANNEL, THREAD, CHANNEL]) },
    });
    expect(lastFindFilter().channelId.$in).not.toContain(HIDDEN_CHANNEL);
  });

  it("holds counts, analytics and server activity to the visible channels", async () => {
    await request(app).get("/discord/messages/search?mode=count").set(DISCORD_HEADERS).expect(200);
    expect(mockCountDocuments.mock.calls[0][0].channelId.$in).toContain(VISIBLE_CHANNEL);

    await request(app)
      .get("/discord/messages/analytics?groupBy=channel")
      .set(DISCORD_HEADERS)
      .expect(200);
    expect(mockAggregate.mock.calls[0][0][0].$match.channelId.$in).toContain(VISIBLE_CHANNEL);

    mockAggregate.mockClear();
    await request(app).get("/discord/activity").set(DISCORD_HEADERS).expect(200);
    for (const [pipeline] of mockAggregate.mock.calls) {
      expect(pipeline[0].$match.channelId.$in).not.toContain(HIDDEN_CHANNEL);
      expect(pipeline[0].$match.channelId.$in).toContain(VISIBLE_CHANNEL);
    }
  });

  it("asks lupos-bot once per minute per requester", async () => {
    await request(app).get("/discord/messages/search").set(DISCORD_HEADERS).expect(200);
    await request(app).get("/discord/messages/analytics").set(DISCORD_HEADERS).expect(200);
    expect(luposBotCalls("/guild/visible-channels")).toHaveLength(1);
  });

  it("surfaces lupos-bot not knowing the requester, and asks again next time", async () => {
    luposBotReplies.set("GET /guild/visible-channels", {
      status: 404,
      body: { error: "Member not found" },
    });
    const res = await request(app).get("/discord/messages/search").set(DISCORD_HEADERS);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Member not found");
    expect(mockFind).not.toHaveBeenCalled();

    replyVisibleChannels();
    await request(app).get("/discord/messages/search").set(DISCORD_HEADERS).expect(200);
    expect(luposBotCalls("/guild/visible-channels")).toHaveLength(2);
  });

  it.each([["/discord/guild/leaderboard"], ["/discord/guild/heatmap"], ["/discord/guild/mentions"]])(
    "%s refuses a hidden channel and forwards a visible one",
    async (path) => {
      const luposPath = path.replace("/discord", "");
      luposBotReplies.set(`GET ${luposPath}`, { body: { totalMessages: 0 } });

      const hidden = await request(app)
        .get(`${path}?userId=${USER}&channelId=${HIDDEN_CHANNEL}`)
        .set(DISCORD_HEADERS);
      expect(hidden.status).toBe(403);
      expect(hidden.body).toEqual({ error: HIDDEN_CHANNEL_ERROR });
      expect(luposBotCalls(luposPath)).toEqual([]);

      await request(app)
        .get(`${path}?userId=${USER}&channelId=${VISIBLE_CHANNEL}`)
        .set(DISCORD_HEADERS)
        .expect(200);
      expect(luposBotCalls(luposPath)[0].query.channelId).toBe(VISIBLE_CHANNEL);
    },
  );

  it("lists only the channels the requester can see", async () => {
    luposBotReplies.set("GET /guild/channels", {
      body: {
        guildId: GUILD,
        guildName: "A",
        channels: [{ id: CHANNEL }, { id: VISIBLE_CHANNEL }, { id: HIDDEN_CHANNEL }],
      },
    });
    const res = await request(app).get("/discord/guild/channels").set(DISCORD_HEADERS);
    expect(res.body).toEqual({
      guildId: GUILD,
      guildName: "A",
      channels: [{ id: CHANNEL }, { id: VISIBLE_CHANNEL }],
    });
  });

  it("reports stats only for channels and threads the requester can see", async () => {
    luposBotReplies.set("GET /guild/channel-stats", {
      body: {
        guildId: GUILD,
        days: 7,
        channels: [
          { channelId: HIDDEN_CHANNEL, messageCount: 9 },
          { channelId: THREAD, messageCount: 5 },
          { channelId: VISIBLE_CHANNEL, messageCount: 2 },
        ],
      },
    });
    const res = await request(app).get("/discord/guild/channel-stats").set(DISCORD_HEADERS);
    expect(res.body.channels).toEqual([
      { channelId: THREAD, messageCount: 5 },
      { channelId: VISIBLE_CHANNEL, messageCount: 2 },
    ]);
  });

  it("reacts in the conversation's channel by default, and refuses a hidden one", async () => {
    luposBotReplies.set("POST /guild/react", { body: { success: true } });
    const messageId = "1526820952019701853";

    const res = await request(app)
      .post("/discord/guild/react")
      .set(DISCORD_HEADERS)
      .send({ messageId, emoji: "🐺" });
    expect(res.body).toEqual({ success: true });
    expect(luposBotCalls("/guild/react")[0].body).toEqual({
      messageId,
      emoji: "🐺",
      guildId: GUILD,
      channelId: CHANNEL,
      requesterUserId: USER,
      scopeGuildId: GUILD,
    });
    // The conversation's own channel needs no visibility lookup.
    expect(luposBotCalls("/guild/visible-channels")).toEqual([]);

    const hidden = await request(app)
      .post("/discord/guild/react")
      .set(DISCORD_HEADERS)
      .send({ channelId: HIDDEN_CHANNEL, messageId, emoji: "🐺" });
    expect(hidden.status).toBe(403);
    expect(hidden.body).toEqual({ error: HIDDEN_CHANNEL_ERROR });
    expect(luposBotCalls("/guild/react")).toHaveLength(1);
  });

  it("scatters a mugging in the conversation's channel by default", async () => {
    luposBotReplies.set("POST /gold/mug", { body: { ok: true, outcome: "hoarded" } });
    await request(app)
      .post("/discord/gold/mug")
      .set(DISCORD_HEADERS)
      .send({ targetUserId: USER, amount: 2 })
      .expect(200);
    expect(luposBotCalls("/gold/mug")[0].body).toMatchObject({
      guildId: GUILD,
      channelId: CHANNEL,
      requesterUserId: USER,
      scopeGuildId: GUILD,
    });
  });
});

// ── lupos-bot refusals reach the model ───────────────────────

describe("a lupos-bot 4xx on a POST is the tool's error", () => {
  it("relays { ok: false, error } with its status", async () => {
    luposBotReplies.set("POST /gold/give", {
      status: 429,
      body: { ok: false, error: "You've asked for 5 gold actions today — that's the limit." },
    });
    const res = await request(app)
      .post("/discord/gold/give")
      .set(DISCORD_HEADERS)
      .send({ targetUserId: USER, amount: 1 });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      ok: false,
      error: "You've asked for 5 gold actions today — that's the limit.",
    });
  });

  it("gives an error to a body without one", async () => {
    luposBotReplies.set("POST /guild/react", { status: 409, body: { alreadyReacted: true } });
    const res = await request(app)
      .post("/discord/guild/react")
      .set(DISCORD_HEADERS)
      .send({ messageId: "1526820952019701853", emoji: "🐺" });
    expect(res.status).toBe(409);
    expect(res.body.alreadyReacted).toBe(true);
    expect(res.body.error).toContain("409");
    expect(res.body.error).toContain("alreadyReacted");
  });
});
