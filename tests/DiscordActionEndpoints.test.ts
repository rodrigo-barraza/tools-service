import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import discordRoutes from "../src/routes/DiscordRoutes.ts";
import {
  CHANNEL,
  DISCORD_HEADERS,
  GUILD,
  OTHER_GUILD,
  OUTSIDE_CONVERSATION_ERROR,
  USER,
  luposBotCalls,
  luposBotFetch,
  luposBotReplies,
} from "./discordTestHarness.ts";

// ═══════════════════════════════════════════════════════════════
// Discord action tools — polls, threads, reminders, Lupos's nickname
//
// Only inside a Discord conversation; the model gives the action's own
// arguments, the conversation gives guild, channel and requester.
// lupos-bot (a stubbed fetch) enforces permissions and rate limits —
// its { ok: false, error } comes back as the tool's error.
// ═══════════════════════════════════════════════════════════════

const app = createTestApp("/discord", discordRoutes);

/** What every forwarded action carries from the conversation. */
const CONVERSATION = {
  guildId: GUILD,
  channelId: CHANNEL,
  requesterUserId: USER,
  scopeGuildId: GUILD,
};

beforeEach(() => {
  luposBotReplies.clear();
  luposBotFetch.mockClear();
  vi.stubGlobal("fetch", luposBotFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACTIONS: Array<[string, "get" | "post", Record<string, unknown>]> = [
  ["/discord/guild/poll", "post", { question: "Pizza?", answers: ["yes", "no"] }],
  ["/discord/guild/thread", "post", { name: "Raid night" }],
  ["/discord/guild/reminders", "post", { text: "stretch", delayMinutes: 30 }],
  ["/discord/guild/reminders/pending", "get", {}],
  ["/discord/guild/reminders/cancel", "post", { reminderId: "66f0c0ffee" }],
  ["/discord/guild/nickname", "post", { nickname: "Lupos the Wise" }],
];

describe("outside a Discord conversation the action tools refuse", () => {
  it.each(ACTIONS)("%s without Discord headers", async (path, method, body) => {
    const res = await request(app)[method](path).send(body);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: OUTSIDE_CONVERSATION_ERROR });
    expect(luposBotFetch).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)("%s without a known requester", async (path, method, body) => {
    const res = await request(app)
      [method](path)
      .set({ "x-discord-guild-id": GUILD, "x-discord-channel-id": CHANNEL })
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: OUTSIDE_CONVERSATION_ERROR });
    expect(luposBotFetch).not.toHaveBeenCalled();
  });
});

describe("create_discord_poll", () => {
  it("posts in the conversation's channel with the defaults filled in", async () => {
    const reply = { ok: true, messageId: "1526820952019701853", url: "https://discord.com/x" };
    luposBotReplies.set("POST /guild/poll", { body: reply });
    const res = await request(app)
      .post("/discord/guild/poll")
      .set(DISCORD_HEADERS)
      .send({
        question: "Pizza?",
        answers: ["yes", "no"],
        // The model never picks where: these are ignored.
        guildId: OTHER_GUILD,
        channelId: "999999999999999999",
        requesterUserId: "888888888888888888",
        // Prism's trusted session fields ride on every POST body.
        project: "lupos",
        agent: "LUPOS",
        username: "lupos",
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(reply);
    expect(luposBotCalls()).toEqual([
      {
        method: "POST",
        path: "/guild/poll",
        query: {},
        body: {
          question: "Pizza?",
          answers: ["yes", "no"],
          durationHours: 24,
          allowMultiselect: false,
          ...CONVERSATION,
        },
      },
    ]);
  });

  it("refuses bad arguments without calling lupos-bot", async () => {
    const res = await request(app)
      .post("/discord/guild/poll")
      .set(DISCORD_HEADERS)
      .send({ question: "Pizza?", answers: ["yes"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("2-10 answers");
    expect(luposBotFetch).not.toHaveBeenCalled();
  });

  it("relays lupos-bot's refusal as the tool's error", async () => {
    const refusal = { ok: false, error: "There was already a poll here in the last 10 minutes." };
    luposBotReplies.set("POST /guild/poll", { status: 429, body: refusal });
    const res = await request(app)
      .post("/discord/guild/poll")
      .set(DISCORD_HEADERS)
      .send({ question: "Pizza?", answers: ["yes", "no"] });
    expect(res.status).toBe(429);
    expect(res.body).toEqual(refusal);
  });

  it("still fails as a service error when lupos-bot breaks", async () => {
    luposBotReplies.set("POST /guild/poll", { status: 500, body: { error: "boom" } });
    const res = await request(app)
      .post("/discord/guild/poll")
      .set(DISCORD_HEADERS)
      .send({ question: "Pizza?", answers: ["yes", "no"] });
    expect(res.status).toBe(500);
  });
});

describe("create_discord_thread", () => {
  it("starts the thread in the conversation's channel", async () => {
    luposBotReplies.set("POST /guild/thread", {
      body: { ok: true, threadId: "1526820952019701999", url: "u" },
    });
    await request(app)
      .post("/discord/guild/thread")
      .set(DISCORD_HEADERS)
      .send({ name: "Raid night", messageId: "1526820952019701853", autoArchiveMinutes: 60 })
      .expect(200);
    expect(luposBotCalls("/guild/thread")[0].body).toEqual({
      name: "Raid night",
      messageId: "1526820952019701853",
      autoArchiveMinutes: 60,
      ...CONVERSATION,
    });
  });

  it("refuses an auto-archive Discord does not offer", async () => {
    const res = await request(app)
      .post("/discord/guild/thread")
      .set(DISCORD_HEADERS)
      .send({ name: "Raid night", autoArchiveMinutes: 30 });
    expect(res.status).toBe(400);
    expect(luposBotFetch).not.toHaveBeenCalled();
  });
});

describe("reminders", () => {
  it("schedules one for the requester, in the conversation's channel", async () => {
    const reply = {
      ok: true,
      reminder: { id: "r1", dueAt: "2026-09-22T12:30:00.000Z", text: "stretch", channelId: CHANNEL },
    };
    luposBotReplies.set("POST /guild/reminders", { body: reply });
    const res = await request(app)
      .post("/discord/guild/reminders")
      .set(DISCORD_HEADERS)
      .send({ text: "stretch", delayMinutes: 30, targetUserId: "888888888888888888" });
    expect(res.body).toEqual(reply);
    expect(luposBotCalls("/guild/reminders")[0].body).toEqual({
      text: "stretch",
      delayMinutes: 30,
      ...CONVERSATION,
    });
  });

  it("sends a dueAt in UTC", async () => {
    luposBotReplies.set("POST /guild/reminders", { body: { ok: true } });
    const dueAt = new Date(Date.now() + 2 * 60 * 60_000);
    const offset = dueAt.toISOString().replace("Z", "+00:00");
    await request(app)
      .post("/discord/guild/reminders")
      .set(DISCORD_HEADERS)
      .send({ text: "stretch", dueAt: offset })
      .expect(200);
    expect(luposBotCalls("/guild/reminders")[0].body?.dueAt).toBe(dueAt.toISOString());
  });

  it("refuses a reminder with both or neither of delayMinutes and dueAt", async () => {
    for (const body of [{ text: "t" }, { text: "t", delayMinutes: 5, dueAt: "2030-01-01T00:00:00Z" }]) {
      const res = await request(app).post("/discord/guild/reminders").set(DISCORD_HEADERS).send(body);
      expect(res.status).toBe(400);
    }
    expect(luposBotFetch).not.toHaveBeenCalled();
  });

  it("lists the requester's pending reminders in this guild", async () => {
    const reply = { ok: true, reminders: [{ id: "r1" }] };
    luposBotReplies.set("GET /guild/reminders", { body: reply });
    const res = await request(app).get("/discord/guild/reminders/pending").set(DISCORD_HEADERS);
    expect(res.body).toEqual(reply);
    expect(luposBotCalls()).toEqual([
      {
        method: "GET",
        path: "/guild/reminders",
        query: { guildId: GUILD, requesterUserId: USER },
        body: undefined,
      },
    ]);
  });

  it("relays a refused list as the tool's error", async () => {
    luposBotReplies.set("GET /guild/reminders", {
      status: 404,
      body: { ok: false, error: "Guild not found" },
    });
    const res = await request(app).get("/discord/guild/reminders/pending").set(DISCORD_HEADERS);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "Guild not found" });
  });

  it("cancels the requester's own reminder, and relays a refusal", async () => {
    luposBotReplies.set("POST /guild/reminders/cancel", {
      status: 404,
      body: { ok: false, error: "No pending reminder of yours with that ID." },
    });
    const res = await request(app)
      .post("/discord/guild/reminders/cancel")
      .set(DISCORD_HEADERS)
      .send({ reminderId: "r9" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No pending reminder of yours with that ID.");
    expect(luposBotCalls("/guild/reminders/cancel")[0].body).toEqual({
      reminderId: "r9",
      ...CONVERSATION,
    });
  });
});

describe("set_discord_nickname", () => {
  it("forwards an empty nickname as a reset", async () => {
    luposBotReplies.set("POST /guild/nickname", { body: { ok: true, nickname: null } });
    const res = await request(app)
      .post("/discord/guild/nickname")
      .set(DISCORD_HEADERS)
      .send({ nickname: "" });
    expect(res.body).toEqual({ ok: true, nickname: null });
    expect(luposBotCalls("/guild/nickname")[0].body).toEqual({ nickname: "", ...CONVERSATION });
  });

  it("refuses a nickname over 32 characters", async () => {
    const res = await request(app)
      .post("/discord/guild/nickname")
      .set(DISCORD_HEADERS)
      .send({ nickname: "x".repeat(33) });
    expect(res.status).toBe(400);
    expect(luposBotFetch).not.toHaveBeenCalled();
  });
});
