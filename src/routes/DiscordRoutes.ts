import {
  asyncHandler,
  HealthTracker,
  setupStreamingServerSentEvents,
} from "@rodrigo-barraza/utilities-library/express";
import { parseIntParam } from "@rodrigo-barraza/utilities-library";
import { type Request, type Response, Router } from "express";
import DiscordDataService from "../services/DiscordDataService.ts";
import {
  DiscordRefusal,
  conversationGuildId,
  getVisibleChannels,
  isChannelVisible,
  readDiscordScope,
  requireDiscordConversation,
  scopeChannelRead,
  scopeGuildAndChannel,
  scopedGuildId,
  type DiscordConversation,
  type DiscordScope,
  type VisibleChannels,
} from "../services/DiscordScopeService.ts";
import {
  parseNicknameArguments,
  parsePollArguments,
  parseReminderArguments,
  parseReminderCancelArguments,
  parseThreadArguments,
} from "../services/DiscordActions.ts";
import logger from "../logger.ts";
import { errorMessage } from "../utilities.ts";
import CONFIG from "../config.ts";

const router = Router();
// ─── Health ─────────────────────────────────────────────────────
const health = new HealthTracker();
export function getDiscordHealth() {
  return health.getHealth();
}
const options = { errorStatus: 500, health };
// ─── Discord scope ──────────────────────────────────────────────
// Tool routes run through `discordHandler`, which hands the handler the
// caller's Discord scope — null outside a Discord conversation, where the
// routes behave as they always have (DiscordScopeService). A
// DiscordRefusal the handler throws — out of scope, bad arguments,
// lupos-bot saying no — is the tool's answer: sent as `{ error }` with its
// own status, and not a failure of the domain's health.
function discordHandler(
  handler: (req: Request, scope: DiscordScope | null) => unknown,
  label: string,
) {
  return asyncHandler(
    async (req: Request, res: Response) => {
      try {
        return await handler(req, readDiscordScope(req.headers));
      } catch (error: unknown) {
        if (!(error instanceof DiscordRefusal)) throw error;
        res.status(error.status).json(error.body);
        return undefined;
      }
    },
    label,
    options,
  );
}

/**
 * The guild/channel arguments of an archive read: as given outside a
 * Discord conversation; inside one, the conversation's guild, an explicit
 * channel only if the requester can see it, and every result held to the
 * channels (and threads) they can see.
 */
async function archiveScope(req: Request, scope: DiscordScope | null) {
  const scoped = await scopeChannelRead(
    scope,
    req.query.guildId,
    req.query.channelId,
  );
  if (!scoped) {
    return {
      guildId: req.query.guildId as string,
      channelId: req.query.channelId as string,
    };
  }
  return scoped;
}

// ─── GET /messages/search ───────────────────────────────────────
// Search Discord messages with flexible filters.
// Query: ?guildId=...&channelId=...&userId=...&query=...&before=...&after=...&limit=50&mode=messages
router.get(
  "/messages/search",
  discordHandler(async (req, scope) => {
    return DiscordDataService.searchMessages({
      ...(await archiveScope(req, scope)),
      userId: req.query.userId as string,
      username: req.query.username as string,
      query: req.query.query as string,
      messageId: req.query.messageId as string,
      before: req.query.before as string,
      after: req.query.after as string,
      limit: parseIntParam(req.query.limit as string, 50),
      mode: (req.query.mode as "messages" | "count" | "compact") || "messages",
      includeBots: (req.query.includeBots as string) === "true",
    });
  }, "Message search"),
);
// ─── GET /messages/stream ───────────────────────────────────────
// SSE endpoint — streams Discord messages in real-time.
// Sends an `init` event with the initial batch, then polls every
// second and pushes:
//   `new`       — messages that appeared since the last poll
//   `delete`    — IDs of messages removed since the last poll
//   `heartbeat` — keep-alive ping every 15s
// Query: ?guildId=...&channelId=...&limit=50
router.get("/messages/stream", (req: Request, res: Response) => {
  const guildId = req.query.guildId as string;
  const channelId = req.query.channelId as string;
  const limit = parseIntParam(req.query.limit as string, 50, 500);
  const includeBots = (req.query.includeBots as string) === "true";
  if (!guildId) {
    return res.status(400).json({ error: "guildId is required" });
  }
  // Set SSE headers (Content-Type: text/event-stream, etc.)
  setupStreamingServerSentEvents(res);
  let closed = false;
  // Track known message IDs so we can detect deletions
  let knownIds = new Set<string>();
  // Track per-message reaction fingerprints to detect reaction changes
  // on existing messages (reactions don't change the message ID, so
  // the old poll missed them entirely).
  let reactionFingerprints = new Map<string, string>();

  interface StreamMessage {
    id: string;
    reactions?: Array<{
      emoji?: { id?: string; name?: string };
      count: number;
    }>;
    [key: string]: unknown;
  }

  /**
   * Build a lightweight fingerprint of a message's reactions array.
   * Used to detect when someone adds/removes a reaction on Discord
   * without the message ID itself changing.
   */
  function reactionHash(message: StreamMessage) {
    if (!message.reactions?.length) return "";
    return message.reactions
      .map((r) => `${r.emoji?.id || r.emoji?.name}:${r.count}`)
      .join(",");
  }

  // ── Initial load ──────────────────────────────────────────────
  async function init() {
    try {
      const data = await DiscordDataService.searchMessages({
        guildId,
        channelId,
        limit,
        includeBots,
      });
      if (closed) return;
      const messages = data.messages || [];
      knownIds = new Set(
        (messages as StreamMessage[]).map((message) => message.id),
      );
      reactionFingerprints = new Map(
        (messages as StreamMessage[]).map((message) => [
          message.id,
          reactionHash(message),
        ]),
      );
      res.write(`event: init\ndata: ${JSON.stringify({ messages })}\n\n`);
      health.markSuccess();
    } catch (error: unknown) {
      logger.error("[discord/stream] Init error:", errorMessage(error));
      health.markError(error);
      if (!closed) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: errorMessage(error) })}\n\n`,
        );
      }
    }
  }
  // ── Poll for changes (new messages + deletions + reaction changes) ──
  async function poll() {
    if (closed) return;
    try {
      const data = await DiscordDataService.searchMessages({
        guildId,
        channelId,
        limit,
        includeBots,
      });
      const messages = data.messages || [];
      const currentIds = new Set(
        (messages as StreamMessage[]).map((message) => message.id),
      );
      // ── Detect new messages ─────────────────────────────────
      const newMessages = (messages as StreamMessage[]).filter(
        (message) => !knownIds.has(message.id),
      );
      if (newMessages.length > 0) {
        // Send newest-first (same order as searchMessages returns)
        res.write(
          `event: new\ndata: ${JSON.stringify({ messages: newMessages })}\n\n`,
        );
        health.markSuccess();
      }
      // ── Detect deleted messages ─────────────────────────────
      const deletedIds: unknown[] = [];
      for (const id of knownIds) {
        if (!currentIds.has(id)) {
          deletedIds.push(id);
        }
      }
      if (deletedIds.length > 0) {
        res.write(
          `event: delete\ndata: ${JSON.stringify({ ids: deletedIds })}\n\n`,
        );
      }
      // ── Detect reaction changes on existing messages ─────────
      // Compare reaction fingerprints — if they differ, the message's
      // reactions were added/removed since the last poll.
      const updatedMessages = (messages as StreamMessage[]).filter(
        (message) => {
          if (!knownIds.has(message.id)) return false; // new messages handled above
          const oldHash = reactionFingerprints.get(message.id);
          const newHash = reactionHash(message);
          return oldHash !== newHash;
        },
      );
      if (updatedMessages.length > 0) {
        res.write(
          `event: update\ndata: ${JSON.stringify({ messages: updatedMessages })}\n\n`,
        );
      }
      // Update tracked sets
      knownIds = currentIds;
      reactionFingerprints = new Map(
        (messages as StreamMessage[]).map((message) => [
          message.id,
          reactionHash(message),
        ]),
      );
    } catch (error: unknown) {
      logger.error("[discord/stream] Poll error:", errorMessage(error));
      health.markError(error);
    }
  }
  // ── Heartbeat — keeps the connection alive through proxies ────
  const heartbeatInterval = setInterval(() => {
    if (closed) return;
    res.write(
      `event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`,
    );
  }, 15_000);
  // ── Start polling at 1s interval ──────────────────────────────
  init().then(() => {
    if (!closed) {
      pollInterval = setInterval(poll, 1_000);
    }
  });
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  // ── Cleanup on disconnect ─────────────────────────────────────
  req.on("close", () => {
    closed = true;
    if (pollInterval) clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
  });
});
// ─── GET /messages/analytics ────────────────────────────────────
// Aggregate Discord messages with group-by queries.
// Query: ?guildId=...&groupBy=user&query=...&before=...&after=...&topN=25
router.get(
  "/messages/analytics",
  discordHandler(async (req, scope) => {
    return DiscordDataService.analyzeMessages({
      ...(await archiveScope(req, scope)),
      userId: req.query.userId as string,
      username: req.query.username as string,
      query: req.query.query as string,
      before: req.query.before as string,
      after: req.query.after as string,
      groupBy:
        (req.query.groupBy as
          | "user"
          | "channel"
          | "day"
          | "hour"
          | "weekday"
          | "month") || "user",
      topN: parseIntParam(req.query.topN as string, 25),
      includeBots: (req.query.includeBots as string) === "true",
    });
  }, "Message analytics"),
);
// ─── GET /activity ──────────────────────────────────────────────
// Get server activity stats: top users, channel breakdown, hourly distribution.
// Query: ?guildId=...&channelId=...&days=7&topN=15
router.get(
  "/activity",
  discordHandler(async (req, scope) => {
    return DiscordDataService.getServerActivity({
      ...(await archiveScope(req, scope)),
      days: parseIntParam(req.query.days as string, 7),
      topN: parseIntParam(req.query.topN as string, 15),
    });
  }, "Server activity"),
);

const LUPOS_BOT_URL = CONFIG.LUPOS_BOT_URL || "http://localhost:1337";

interface ForwardOptions {
  /** The caller's Discord scope — its requester rides on every forward. */
  scope?: DiscordScope | null;
  /** Answer a lupos-bot 4xx as the tool's error instead of throwing. */
  relayRefusals?: boolean;
}

/**
 * lupos-bot's answer: a 2xx is its JSON. With `relayRefusals`, a 4xx is
 * the tool's error — its body kept (e.g. `{ ok: false, error }`), `error`
 * always a string, the status kept; anything else throws as before.
 */
async function readLuposBotResponse(
  response: globalThis.Response,
  relayRefusals: boolean,
) {
  if (response.ok) return response.json();
  if (relayRefusals && response.status >= 400 && response.status < 500) {
    const body: unknown = await response.json().catch(() => null);
    const fields =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const error =
      typeof fields.error === "string"
        ? fields.error
        : `Lupos-bot API returned ${response.status}: ${response.statusText}${body ? ` — ${JSON.stringify(body)}` : ""}`;
    throw new DiscordRefusal(response.status, error, fields);
  }
  throw new Error(`Lupos-bot API returned ${response.status}: ${response.statusText}`);
}

async function forwardToLuposBot(
  path: string,
  queryParams: Record<string, unknown> = {},
  { scope = null, relayRefusals = false }: ForwardOptions = {},
) {
  const urlParams = new URLSearchParams();
  const params = { ...queryParams, requesterUserId: scope?.userId };
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      urlParams.set(key, String(value));
    }
  }
  const queryString = urlParams.toString();
  const targetUrl = `${LUPOS_BOT_URL}${path}${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(targetUrl);
  return readLuposBotResponse(response, relayRefusals);
}

/**
 * `result.channels` narrowed to the channels the requester can see — none
 * when lupos-bot's answer has no readable list.
 */
function withVisibleChannels(
  result: unknown,
  scope: DiscordScope,
  visible: VisibleChannels,
  idKey: "id" | "channelId",
) {
  const body = (result ?? {}) as Record<string, unknown>;
  const channels = Array.isArray(body.channels)
    ? body.channels.filter((channel: Record<string, unknown> | null) =>
        isChannelVisible(scope, visible, String(channel?.[idKey])),
      )
    : [];
  return { ...body, channels };
}

// ─── GET /guild/channels ────────────────────────────────────────
// Discord-scoped: only the channels the requester can see are listed.
router.get(
  "/guild/channels",
  discordHandler(async (req, scope) => {
    const guildId = scopedGuildId(scope, req.query.guildId);
    const [result, visible] = await Promise.all([
      forwardToLuposBot("/guild/channels", { guildId }, { scope }),
      scope
        ? getVisibleChannels(conversationGuildId(scope, guildId), scope.userId)
        : null,
    ]);
    return scope && visible
      ? withVisibleChannels(result, scope, visible, "id")
      : result;
  }, "Get guild channels"),
);

// ─── GET /guild/members ─────────────────────────────────────────
router.get(
  "/guild/members",
  discordHandler((req, scope) => {
    return forwardToLuposBot(
      "/guild/members",
      { guildId: scopedGuildId(scope, req.query.guildId) },
      { scope },
    );
  }, "Get guild members"),
);

// ─── GET /guild/emojis ──────────────────────────────────────────
router.get(
  "/guild/emojis",
  discordHandler((req, scope) => {
    return forwardToLuposBot(
      "/guild/emojis",
      { guildId: scopedGuildId(scope, req.query.guildId) },
      { scope },
    );
  }, "Get guild emojis"),
);

// ─── GET /bot/stats ─────────────────────────────────────────────
router.get(
  "/bot/stats",
  discordHandler((_req, scope) => {
    return forwardToLuposBot("/bot/stats", {}, { scope });
  }, "Get bot stats"),
);

// ─── GET /bot/guilds ────────────────────────────────────────────
// Discord-scoped: only the conversation's own server is listed.
router.get(
  "/bot/guilds",
  discordHandler(async (_req, scope) => {
    const result = await forwardToLuposBot("/bot/guilds", {}, { scope });
    if (!scope) return result;
    const body = (result ?? {}) as Record<string, unknown>;
    const guilds = Array.isArray(body.guilds)
      ? body.guilds.filter(
          (guild: Record<string, unknown> | null) =>
            scope.guildId !== null && guild?.id === scope.guildId,
        )
      : [];
    return { ...body, count: guilds.length, guilds };
  }, "Get bot guilds"),
);

// ─── GET /bot/activity ──────────────────────────────────────────
router.get(
  "/bot/activity",
  discordHandler((_req, scope) => {
    return forwardToLuposBot("/bot/activity", {}, { scope });
  }, "Get bot activity timeline"),
);

// ─── GET /guild/heatmap ─────────────────────────────────────────
router.get(
  "/guild/heatmap",
  discordHandler(async (req, scope) => {
    const { guildId, channelId } = await scopeGuildAndChannel(
      scope,
      req.query.guildId,
      req.query.channelId,
    );
    return forwardToLuposBot(
      "/guild/heatmap",
      {
        guildId,
        userId: req.query.userId,
        channelId,
        years: req.query.years,
        months: req.query.months,
        days: req.query.days,
      },
      { scope },
    );
  }, "Get user heatmap data"),
);

// ─── GET /guild/mentions ────────────────────────────────────────
router.get(
  "/guild/mentions",
  discordHandler(async (req, scope) => {
    const { guildId, channelId } = await scopeGuildAndChannel(
      scope,
      req.query.guildId,
      req.query.channelId,
    );
    return forwardToLuposBot(
      "/guild/mentions",
      {
        guildId,
        userId: req.query.userId,
        years: req.query.years,
        months: req.query.months,
        days: req.query.days,
        channelId,
      },
      { scope },
    );
  }, "Get user mentions"),
);

// ─── GET /guild/leaderboard ─────────────────────────────────────
router.get(
  "/guild/leaderboard",
  discordHandler(async (req, scope) => {
    const { guildId, channelId } = await scopeGuildAndChannel(
      scope,
      req.query.guildId,
      req.query.channelId,
    );
    return forwardToLuposBot(
      "/guild/leaderboard",
      {
        guildId,
        years: req.query.years,
        months: req.query.months,
        days: req.query.days,
        channelId,
      },
      { scope },
    );
  }, "Get server message leaderboard"),
);

// ─── GET /guild/word-frequencies ────────────────────────────────
router.get(
  "/guild/word-frequencies",
  discordHandler((req, scope) => {
    return forwardToLuposBot(
      "/guild/word-frequencies",
      {
        guildId: scopedGuildId(scope, req.query.guildId),
        userId: req.query.userId,
        years: req.query.years,
        months: req.query.months,
        days: req.query.days,
        limit: req.query.limit,
      },
      { scope },
    );
  }, "Get user word frequencies"),
);

/**
 * POST to lupos-bot. `requesterUserId` and `scopeGuildId` come only from
 * the caller's Discord scope — either one in `body` (the model's
 * arguments) is dropped. A 4xx answer (e.g. `{ ok: false, error }`) is
 * relayed as the tool's error.
 */
async function forwardPostToLuposBot(
  path: string,
  body: Record<string, unknown> = {},
  scope: DiscordScope | null = null,
) {
  const targetUrl = `${LUPOS_BOT_URL}${path}`;
  const forwarded: Record<string, unknown> = { ...body };
  delete forwarded.requesterUserId;
  delete forwarded.scopeGuildId;
  if (scope?.userId) forwarded.requesterUserId = scope.userId;
  if (scope?.guildId) forwarded.scopeGuildId = scope.guildId;

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(forwarded),
  });
  return readLuposBotResponse(response, true);
}

// ─── POST /guild/react ──────────────────────────────────────────
// Discord-scoped: a missing channel is the conversation's; another one
// only if the requester can see it.
router.post(
  "/guild/react",
  discordHandler(async (req, scope) => {
    const body = req.body ?? {};
    const { guildId, channelId } = await scopeGuildAndChannel(
      scope,
      body.guildId,
      body.channelId,
      { defaultToConversationChannel: true },
    );
    return forwardPostToLuposBot(
      "/guild/react",
      { ...body, guildId, channelId },
      scope,
    );
  }, "React to discord message"),
);

// ─── GET /gold/balance ──────────────────────────────────────────
router.get(
  "/gold/balance",
  discordHandler((req, scope) => {
    return forwardToLuposBot(
      "/gold/balance",
      {
        guildId: scopedGuildId(scope, req.query.guildId),
        userId: req.query.userId,
      },
      { scope },
    );
  }, "Get discord gold balance"),
);

// ─── POST /gold/give ────────────────────────────────────────────
router.post(
  "/gold/give",
  discordHandler((req, scope) => {
    const body = req.body ?? {};
    return forwardPostToLuposBot(
      "/gold/give",
      { ...body, guildId: scopedGuildId(scope, body.guildId) },
      scope,
    );
  }, "Give discord gold"),
);

// ─── POST /gold/mug ─────────────────────────────────────────────
// Discord-scoped: fumbled loot scatters in the conversation's channel
// unless a channel the requester can see is named.
router.post(
  "/gold/mug",
  discordHandler(async (req, scope) => {
    const body = req.body ?? {};
    const { guildId, channelId } = await scopeGuildAndChannel(
      scope,
      body.guildId,
      body.channelId,
      { defaultToConversationChannel: true },
    );
    return forwardPostToLuposBot(
      "/gold/mug",
      { ...body, guildId, channelId },
      scope,
    );
  }, "Mug discord gold"),
);

// ─── GET /guild/voice-members ───────────────────────────────────
router.get(
  "/guild/voice-members",
  discordHandler((req, scope) => {
    return forwardToLuposBot(
      "/guild/voice-members",
      { guildId: scopedGuildId(scope, req.query.guildId) },
      { scope },
    );
  }, "Get voice channel members"),
);

// ─── GET /guild/user-profile ────────────────────────────────────
router.get(
  "/guild/user-profile",
  discordHandler((req, scope) => {
    return forwardToLuposBot(
      "/guild/user-profile",
      {
        userId: req.query.userId,
        guildId: scopedGuildId(scope, req.query.guildId),
      },
      { scope },
    );
  }, "Get discord user profile"),
);

// ─── GET /guild/channel-stats ───────────────────────────────────
// Discord-scoped: only the channels the requester can see are reported.
router.get(
  "/guild/channel-stats",
  discordHandler(async (req, scope) => {
    const guildId = scopedGuildId(scope, req.query.guildId);
    const [result, visible] = await Promise.all([
      forwardToLuposBot(
        "/guild/channel-stats",
        { guildId, days: req.query.days },
        { scope },
      ),
      scope
        ? getVisibleChannels(conversationGuildId(scope, guildId), scope.userId)
        : null,
    ]);
    return scope && visible
      ? withVisibleChannels(result, scope, visible, "channelId")
      : result;
  }, "Get channel activity stats"),
);

// ═══════════════════════════════════════════════════════════════
//  Discord actions — polls, threads, reminders, Lupos's nickname
//
//  Only inside a Discord conversation. The model gives the action's own
//  arguments (checked in DiscordActions); guild, channel and requester
//  are the conversation's. lupos-bot enforces permissions, rate limits
//  and the content filter — its `{ ok: false, error }` comes back as
//  the tool's error.
// ═══════════════════════════════════════════════════════════════

function conversationBody(
  conversation: DiscordConversation,
  payload: object,
): Record<string, unknown> {
  return {
    ...payload,
    guildId: conversation.guildId,
    channelId: conversation.channelId,
  };
}

// ─── POST /guild/poll ───────────────────────────────────────────
// Body: { question, answers[], durationHours?, allowMultiselect? }
router.post(
  "/guild/poll",
  discordHandler((req, scope) => {
    const conversation = requireDiscordConversation(scope);
    const poll = parsePollArguments(req.body ?? {});
    return forwardPostToLuposBot(
      "/guild/poll",
      conversationBody(conversation, poll),
      scope,
    );
  }, "Create discord poll"),
);

// ─── POST /guild/thread ─────────────────────────────────────────
// Body: { name, messageId?, autoArchiveMinutes? }
router.post(
  "/guild/thread",
  discordHandler((req, scope) => {
    const conversation = requireDiscordConversation(scope);
    const thread = parseThreadArguments(req.body ?? {});
    return forwardPostToLuposBot(
      "/guild/thread",
      conversationBody(conversation, thread),
      scope,
    );
  }, "Create discord thread"),
);

// ─── POST /guild/reminders ──────────────────────────────────────
// Body: { text, delayMinutes? | dueAt? } — always the requester's own.
router.post(
  "/guild/reminders",
  discordHandler((req, scope) => {
    const conversation = requireDiscordConversation(scope);
    const reminder = parseReminderArguments(req.body ?? {});
    return forwardPostToLuposBot(
      "/guild/reminders",
      conversationBody(conversation, reminder),
      scope,
    );
  }, "Schedule discord reminder"),
);

// ─── GET /guild/reminders/pending ───────────────────────────────
// The requester's pending reminders in this guild (lupos-bot GET
// /guild/reminders?guildId=&requesterUserId=).
router.get(
  "/guild/reminders/pending",
  discordHandler((_req, scope) => {
    const conversation = requireDiscordConversation(scope);
    return forwardToLuposBot(
      "/guild/reminders",
      { guildId: conversation.guildId },
      { scope, relayRefusals: true },
    );
  }, "List discord reminders"),
);

// ─── POST /guild/reminders/cancel ───────────────────────────────
// Body: { reminderId } — only the requester's own pending reminder.
router.post(
  "/guild/reminders/cancel",
  discordHandler((req, scope) => {
    const conversation = requireDiscordConversation(scope);
    const cancel = parseReminderCancelArguments(req.body ?? {});
    return forwardPostToLuposBot(
      "/guild/reminders/cancel",
      conversationBody(conversation, cancel),
      scope,
    );
  }, "Cancel discord reminder"),
);

// ─── POST /guild/nickname ───────────────────────────────────────
// Body: { nickname } — Lupos's own nickname in this guild; "" resets it.
router.post(
  "/guild/nickname",
  discordHandler((req, scope) => {
    const conversation = requireDiscordConversation(scope);
    const nickname = parseNicknameArguments(req.body ?? {});
    return forwardPostToLuposBot(
      "/guild/nickname",
      conversationBody(conversation, nickname),
      scope,
    );
  }, "Set discord nickname"),
);

export default router;
