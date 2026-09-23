import CONFIG from "../config.ts";

// ═══════════════════════════════════════════════════════════════
//  Discord Scope — what a Discord conversation may reach
//
//  Prism sends the running turn's Discord context as headers, taken
//  from the turn (never from the model's arguments). With them, every
//  Discord tool is held to the server the conversation is in, and
//  archive reads to the channels the person asking can see — the list
//  comes from lupos-bot's GET /guild/visible-channels. Without them
//  (a non-Discord caller, e.g. the owner in prism-client) the read
//  tools behave as they always have.
// ═══════════════════════════════════════════════════════════════

/**
 * The trusted Discord context of a tool call. Defined here, not in
 * utilities-library: tools-service and prism-service each keep their own
 * copy of these three names.
 */
export const DISCORD_CONTEXT_HEADERS = {
  guildId: "x-discord-guild-id",
  channelId: "x-discord-channel-id",
  userId: "x-discord-user-id",
} as const;

/** The refusals a scoped tool answers with — the model reads them verbatim. */
export const DISCORD_SCOPE_ERRORS = {
  otherGuild: "Lupos can only reach into the server this conversation is in.",
  hiddenChannel: "Lupos can't reach into a channel you can't see.",
  outsideConversation:
    "This tool only works inside a Discord conversation with Lupos.",
} as const;

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

const VISIBLE_CHANNELS_TTL_MS = 60_000;
const VISIBLE_CHANNELS_TIMEOUT_MS = 10_000;
const VISIBLE_CHANNELS_CACHE_PRUNE_SIZE = 500;

const LUPOS_BOT_URL = CONFIG.LUPOS_BOT_URL || "http://localhost:1337";

/**
 * The Discord conversation a tool call comes from. A field is null when
 * its header is missing or is not a snowflake.
 */
export interface DiscordScope {
  guildId: string | null;
  channelId: string | null;
  userId: string | null;
}

/** A scope carrying all three — what the Discord action tools need. */
export interface DiscordConversation {
  guildId: string;
  channelId: string;
  userId: string;
}

/** Channels one requester can read in one guild. */
export interface VisibleChannels {
  channelIds: Set<string>;
  threadIds: Set<string>;
}

/**
 * A tool call the Discord routes answer with an error instead of a result
 * — out of scope, bad arguments, or lupos-bot saying no. It is the tool's
 * answer, not a failure of the service: the route sends `body` (always
 * carrying a string `error`) with `status`.
 */
export class DiscordRefusal extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, error: string, body: Record<string, unknown> = {}) {
    super(error);
    this.name = "DiscordRefusal";
    this.status = status;
    this.body = { ...body, error };
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read the Discord context of a request. Null when it carries none of the
 * three headers (not a Discord conversation). A header that is present but
 * not a snowflake counts as present — the conversation is Discord's, its
 * value unusable — so the read fails closed rather than falling back to the
 * unscoped behaviour.
 */
export function readDiscordScope(
  headers: Record<string, string | string[] | undefined>,
): DiscordScope | null {
  const raw = {
    guildId: headerValue(headers[DISCORD_CONTEXT_HEADERS.guildId]),
    channelId: headerValue(headers[DISCORD_CONTEXT_HEADERS.channelId]),
    userId: headerValue(headers[DISCORD_CONTEXT_HEADERS.userId]),
  };
  if (!raw.guildId && !raw.channelId && !raw.userId) return null;
  const snowflake = (value: string | undefined) =>
    value && SNOWFLAKE_PATTERN.test(value) ? value : null;
  return {
    guildId: snowflake(raw.guildId),
    channelId: snowflake(raw.channelId),
    userId: snowflake(raw.userId),
  };
}

/** A tool argument naming an ID: trimmed, or undefined when absent/empty. */
export function argumentId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

/**
 * The guild a tool call may use. Outside a Discord conversation the
 * requested value passes through untouched; inside one, a missing guild
 * becomes the conversation's and any other guild is refused (so is every
 * guild when the conversation has none).
 */
export function scopedGuildId<T>(scope: DiscordScope | null, requested: T): string | T {
  return scope ? conversationGuildId(scope, requested) : requested;
}

/** `scopedGuildId` inside a Discord conversation: always its guild. */
export function conversationGuildId(scope: DiscordScope, requested: unknown): string {
  if (!scope.guildId) {
    throw new DiscordRefusal(403, DISCORD_SCOPE_ERRORS.otherGuild);
  }
  const requestedGuildId = argumentId(requested);
  if (requestedGuildId && requestedGuildId !== scope.guildId) {
    throw new DiscordRefusal(403, DISCORD_SCOPE_ERRORS.otherGuild);
  }
  return scope.guildId;
}

/** The full context the action tools act in, or their refusal. */
export function requireDiscordConversation(
  scope: DiscordScope | null,
): DiscordConversation {
  if (!scope?.guildId || !scope.channelId || !scope.userId) {
    throw new DiscordRefusal(403, DISCORD_SCOPE_ERRORS.outsideConversation);
  }
  return { guildId: scope.guildId, channelId: scope.channelId, userId: scope.userId };
}

// ── Visible channels (lupos-bot, cached per guild + requester) ───

const visibleChannelsCache = new Map<
  string,
  { expiresAt: number; value: Promise<VisibleChannels> }
>();

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

async function fetchVisibleChannels(
  guildId: string,
  userId: string | null,
): Promise<VisibleChannels> {
  const query = new URLSearchParams({ guildId });
  if (userId) query.set("userId", userId);
  const response = await fetch(
    `${LUPOS_BOT_URL}/guild/visible-channels?${query.toString()}`,
    { signal: AbortSignal.timeout(VISIBLE_CHANNELS_TIMEOUT_MS) },
  );
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail =
      typeof body?.error === "string"
        ? body.error
        : `Lupos-bot API returned ${response.status}: ${response.statusText}`;
    const message = `Couldn't check which channels you can see — ${detail}`;
    // An unknown guild or member is an answer about the requester; a
    // lupos-bot that is down or broken is a failure of the service.
    if (response.status >= 400 && response.status < 500) {
      throw new DiscordRefusal(response.status, message);
    }
    throw new Error(message);
  }
  const channelIds = stringList(body?.channelIds);
  const threadIds = body?.threadIds === undefined ? [] : stringList(body.threadIds);
  if (!channelIds || !threadIds) {
    throw new Error("Couldn't check which channels you can see — lupos-bot sent an unreadable channel list");
  }
  return { channelIds: new Set(channelIds), threadIds: new Set(threadIds) };
}

/**
 * The channels `userId` can read in `guildId` — with no user, the ones
 * @everyone can. Cached for 60 s per (guild, user); a failed lookup is not
 * cached.
 */
export function getVisibleChannels(
  guildId: string,
  userId: string | null,
): Promise<VisibleChannels> {
  const key = `${guildId}:${userId ?? "@everyone"}`;
  const now = Date.now();
  const cached = visibleChannelsCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  if (visibleChannelsCache.size >= VISIBLE_CHANNELS_CACHE_PRUNE_SIZE) {
    for (const [cachedKey, entry] of visibleChannelsCache) {
      if (entry.expiresAt <= now) visibleChannelsCache.delete(cachedKey);
    }
  }

  const value = fetchVisibleChannels(guildId, userId);
  visibleChannelsCache.set(key, { expiresAt: now + VISIBLE_CHANNELS_TTL_MS, value });
  value.catch(() => {
    if (visibleChannelsCache.get(key)?.value === value) {
      visibleChannelsCache.delete(key);
    }
  });
  return value;
}

/** Test hook — forget every cached visibility list. */
export function clearVisibleChannelsCache() {
  visibleChannelsCache.clear();
}

/**
 * Whether the requester can read `channelId`. The conversation's own
 * channel always counts: they are talking in it.
 */
export function isChannelVisible(
  scope: DiscordScope,
  visible: VisibleChannels,
  channelId: string,
) {
  return (
    channelId === scope.channelId ||
    visible.channelIds.has(channelId) ||
    visible.threadIds.has(channelId)
  );
}

/**
 * Every channel and thread the requester can read, the conversation's own
 * channel included — the `channelId $in` of a scoped archive query.
 */
export function visibleChannelIdList(scope: DiscordScope, visible: VisibleChannels) {
  const ids = new Set([...visible.channelIds, ...visible.threadIds]);
  if (scope.channelId) ids.add(scope.channelId);
  return [...ids];
}

/** A scoped read of one guild's channels: where, and what it may see. */
export interface ScopedChannelRead {
  guildId: string;
  /** The explicit channel asked for — already checked visible. */
  channelId: string | undefined;
  visibleChannelIds: string[];
}

/**
 * Scope a read that can look into channels: the conversation's guild, the
 * requester's visible channels, and an explicit channel only when they can
 * see it. Null outside a Discord conversation (the arguments stand).
 */
export async function scopeChannelRead(
  scope: DiscordScope | null,
  requestedGuildId: unknown,
  requestedChannelId: unknown,
): Promise<ScopedChannelRead | null> {
  if (!scope) return null;
  const guildId = conversationGuildId(scope, requestedGuildId);
  const visible = await getVisibleChannels(guildId, scope.userId);
  const channelId = argumentId(requestedChannelId);
  if (channelId && !isChannelVisible(scope, visible, channelId)) {
    throw new DiscordRefusal(403, DISCORD_SCOPE_ERRORS.hiddenChannel);
  }
  return { guildId, channelId, visibleChannelIds: visibleChannelIdList(scope, visible) };
}

/**
 * Check one explicit channel of a scoped call (no list needed). The
 * conversation's own channel passes without asking lupos-bot.
 */
export async function assertChannelVisible(
  scope: DiscordScope,
  guildId: string,
  channelId: string,
) {
  if (channelId === scope.channelId) return;
  const visible = await getVisibleChannels(guildId, scope.userId);
  if (!isChannelVisible(scope, visible, channelId)) {
    throw new DiscordRefusal(403, DISCORD_SCOPE_ERRORS.hiddenChannel);
  }
}

/**
 * The guild and channel arguments of a call that names one channel (a
 * lupos-bot stat, a reaction, a mugging). Outside a Discord conversation
 * both pass through untouched. Inside one: the conversation's guild, and a
 * channel only if the requester can see it — with
 * `defaultToConversationChannel`, a missing channel is the conversation's.
 */
export async function scopeGuildAndChannel(
  scope: DiscordScope | null,
  requestedGuildId: unknown,
  requestedChannelId: unknown,
  { defaultToConversationChannel = false } = {},
): Promise<{ guildId: unknown; channelId: unknown }> {
  if (!scope) return { guildId: requestedGuildId, channelId: requestedChannelId };
  const guildId = conversationGuildId(scope, requestedGuildId);
  const channelId =
    argumentId(requestedChannelId) ??
    (defaultToConversationChannel ? (scope.channelId ?? undefined) : undefined);
  if (channelId) await assertChannelVisible(scope, guildId, channelId);
  return { guildId, channelId };
}
