import { days as daysToMs } from "@rodrigo-barraza/utilities-library";
import { discordAvatarUrl, discordMessageUrl } from "@rodrigo-barraza/utilities-library/discord";
import type { Document } from "mongodb";
import { getMessagesCollection } from "../models/LuposMessage.ts";

// ── Parameter Interfaces ─────────────────────────────────────

interface MessageSearchParams {
  guildId?: string;
  channelId?: string;
  userId?: string;
  username?: string;
  query?: string;
  /** Exact Discord message ID (snowflake) — fetches that one message. */
  messageId?: string;
  before?: string | number;
  after?: string | number;
  limit?: number;
  mode?: "messages" | "count" | "compact";
  includeBots?: boolean;
  /**
   * Channels (and threads) the requester can read — set on a Discord-scoped
   * call. Results never come from any other channel.
   */
  visibleChannelIds?: string[];
}

interface MessageAnalyticsParams {
  guildId?: string;
  channelId?: string;
  userId?: string;
  username?: string;
  query?: string;
  before?: string | number;
  after?: string | number;
  groupBy?: "user" | "channel" | "day" | "hour" | "weekday" | "month";
  topN?: number;
  includeBots?: boolean;
  /**
   * Channels (and threads) the requester can read — set on a Discord-scoped
   * call. Results never come from any other channel.
   */
  visibleChannelIds?: string[];
}

interface ServerActivityParams {
  guildId?: string;
  channelId?: string;
  days?: number;
  topN?: number;
  /**
   * Channels (and threads) the requester can read — set on a Discord-scoped
   * call. Results never come from any other channel.
   */
  visibleChannelIds?: string[];
}

/** MongoDB $dateToString expression. */
interface MongoDateToString {
  $dateToString: { format: string; date: { $toDate: string } };
}

/** MongoDB $hour/$dayOfWeek extraction expression. */
interface MongoDatePart {
  $hour?: { $toDate: string };
  $dayOfWeek?: { $toDate: string };
}

type MongoGroupId = string | MongoDateToString | MongoDatePart;

// ═══════════════════════════════════════════════════════════════
//  Discord Data Service
//
//  Query layer for the Lupos `Messages` collection. Powers the
//  search_discord_messages, get_discord_server_activity, and
//  discord_message_analytics tools.
// ═══════════════════════════════════════════════════════════════

// ── Excluded Categories ──────────────────────────────────────
// Messages from channels under these Discord category IDs are
// NEVER returned by any query. This is a hard server-side filter.
const EXCLUDED_CATEGORY_IDS = [
  "609652454375555082", // Private/staff channels
  "665736600042340352", // Staff/admin channels
];

// Discord snowflake shape — used to fall back from text search to an
// exact message-ID lookup when the query is a bare ID.
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

// ── Discord User Badge Flags ─────────────────────────────────
// Maps UserFlags bitfield values to badge identifiers used by the
// client to render inline badge icons next to usernames.
const BADGE_FLAGS = [
  { bit: 1, id: "staff", label: "Discord Staff" },
  { bit: 2, id: "partner", label: "Partnered Server Owner" },
  { bit: 4, id: "hypesquad", label: "HypeSquad Events" },
  { bit: 8, id: "bug_hunter_1", label: "Bug Hunter Level 1" },
  { bit: 64, id: "hypesquad_bravery", label: "HypeSquad Bravery" },
  { bit: 128, id: "hypesquad_brilliance", label: "HypeSquad Brilliance" },
  { bit: 256, id: "hypesquad_balance", label: "HypeSquad Balance" },
  { bit: 512, id: "early_supporter", label: "Early Supporter" },
  { bit: 16384, id: "bug_hunter_2", label: "Bug Hunter Level 2" },
  { bit: 65536, id: "verified_bot", label: "Verified Bot" },
  {
    bit: 131072,
    id: "verified_developer",
    label: "Early Verified Bot Developer",
  },
  {
    bit: 262144,
    id: "certified_moderator",
    label: "Moderator Programs Alumni",
  },
  { bit: 4194304, id: "active_developer", label: "Active Developer" },
];

/**
 * Extract badge identifiers from a UserFlags bitfield.
 * The bitfield can be a number, a string-encoded number, or a
 * discord.js BitField object with a `.bitfield` property.
 */
function extractBadges(
  flags: number | string | { bitfield: number } | null | undefined,
) {
  if (!flags) return [];
  // discord.js stores BitField as { bitfield: <number> }
  const bits =
    typeof flags === "object" && flags !== null && "bitfield" in flags
      ? Number(flags.bitfield)
      : Number(flags);
  if (!bits || isNaN(bits)) return [];
  return BADGE_FLAGS.filter((flag) => (bits & flag.bit) === flag.bit).map(
    (item) => ({ id: item.id, label: item.label }),
  );
}

/**
 * Extract visible role tags from a member's roles array.
 * Returns the top non-@everyone roles (sorted by position desc),
 * limited to the top 3 for UI space — matching Discord's inline
 * role badge behavior.
 */
interface DiscordRole {
  id: string;
  name: string;
  position?: number;
  hexColor?: string;
  iconURL?: string;
}

function extractRoleTags(
  roles: DiscordRole[] | undefined,
  guildId: string | undefined,
) {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  return roles
    .filter((r) => r.id !== guildId && r.name !== "@everyone")
    .sort((firstItem, b) => (b.position ?? 0) - (firstItem.position ?? 0))
    .slice(0, 3)
    .map((r) => ({
      name: r.name,
      color: r.hexColor && r.hexColor !== "#000000" ? r.hexColor : null,
      iconUrl: r.iconURL || null,
    }));
}

/**
 * Build a Discord CDN avatar URL from raw author data stored in MongoDB.
 * Falls back to the default avatar URL (e.g. blue/green Wumpus silhouette).
 */
interface DiscordAuthor {
  id?: string;
  avatar?: string;
  defaultAvatarURL?: string;
}

interface DiscordMember {
  avatar?: string;
  displayName?: string;
  displayHexColor?: string;
  roles?: DiscordRole[];
  roleColors?: { secondary?: string; tertiary?: string };
  premiumSince?: string;
  premiumSinceTimestamp?: number;
}

function buildAvatarUrl(
  author: DiscordAuthor | undefined,
  member?: DiscordMember,
  guildId?: string,
) {
  if (!author) return null;
  return discordAvatarUrl(author.id, author.avatar, {
    size: 128,
    guildId,
    guildAvatarHash: member?.avatar,
    fallbackUrl: author.defaultAvatarURL || null,
  });
}

/**
 * Resolve a media URL using the mediaArchive map.
 * Prefers the permanent MinIO URL when the original URL was archived.
 * Falls back to the original URL otherwise.
 */
function resolveArchivedUrl(
  url: string | undefined,
  archiveMap: Record<string, { publicUrl?: string }> | null,
) {
  if (!url || !archiveMap) return url;
  const archiveReference = archiveMap[url];
  // If the entry was marked as expired during backfill, it has no publicUrl
  if (archiveReference?.publicUrl) return archiveReference.publicUrl;
  return url;
}

/**
 * The `channelId` clause of a query: the explicit channel, the requester's
 * visible channels (a Discord-scoped call), or none. A thread's messages
 * are archived under the thread's own ID, so a visible thread is matched
 * here like a channel. An explicit channel outside the visible set matches
 * nothing — the route refuses it first; this keeps the query honest on its
 * own.
 */
function channelClause(
  channelId: string | undefined,
  visibleChannelIds: string[] | undefined,
): string | Document | undefined {
  if (!visibleChannelIds) return channelId || undefined;
  if (channelId) {
    return visibleChannelIds.includes(channelId) ? channelId : { $in: [] };
  }
  return { $in: visibleChannelIds };
}

/**
 * Build the common MongoDB filter used by search and analytics.
 */
function buildBaseFilter({
  guildId,
  channelId,
  userId,
  username,
  query,
  before,
  after,
  includeBots = false,
  visibleChannelIds,
}: MessageSearchParams = {}) {
  const filter: Document = {};

  if (guildId) filter.guildId = guildId;
  const channel = channelClause(channelId, visibleChannelIds);
  if (channel !== undefined) filter.channelId = channel;
  if (userId) filter["author.id"] = userId;

  // Username search — match across username, globalName, and displayName
  if (username && !userId) {
    const namePattern = { $regex: username, $options: "i" };
    filter.$or = [
      { "author.username": namePattern },
      { "author.globalName": namePattern },
      { "member.displayName": namePattern },
    ];
  }

  // Exclude bot messages — use `$in: [false, null]` instead of `$ne: true`
  // because $ne forces full index/collection scan (matches "everything except"),
  // while $in can be served by a standard index on `author.bot`.
  if (!includeBots) {
    filter["author.bot"] = { $in: [false, null] };
  }

  // Exclude messages from restricted categories (hard filter).
  // `$not/$in` has better query planner behavior than bare `$nin` for
  // index intersection on compound queries.
  filter["channel.parentId"] = {
    $not: { $in: EXCLUDED_CATEGORY_IDS },
  };

  // Time range
  if (before || after) {
    const timestampFilter: { $lte?: number; $gte?: number } = {};
    if (before) timestampFilter.$lte = new Date(before).getTime();
    if (after) timestampFilter.$gte = new Date(after).getTime();
    filter.createdTimestamp = timestampFilter;
  }

  // Text search — use $text search to leverage the text index for 8M+ messages,
  // drastically improving query performance.
  if (query) {
    filter.$text = { $search: query };
  }

  return filter;
}

const DiscordDataService = {
  /**
   * Search Discord messages with flexible filters.
   *


   *   "messages" — full message objects (default)
   *   "count"    — only the matching count, zero message bodies
   *   "compact"  — minimal per-message data (author, timestamp, truncated content)
   */
  async searchMessages({
    guildId,
    channelId,
    userId,
    username,
    query,
    messageId,
    before,
    after,
    limit = 50,
    mode = "messages",
    includeBots = false,
    visibleChannelIds,
  }: MessageSearchParams = {}) {
    const collection = getMessagesCollection();
    const filter = buildBaseFilter({
      guildId,
      channelId,
      userId,
      username,
      query,
      before,
      after,
      includeBots,
      visibleChannelIds,
    });
    const cappedLimit = Math.min(Number(limit), 500);

    // ── Exact message-ID lookup ────────────────────────────────
    // A direct `messageId` fetches one specific message. As a fallback, a
    // bare snowflake typed into `query` that matches nothing as text is
    // retried as an ID lookup — models reach for this tool with IDs from
    // reply chains and message links, and $text search can't find those.
    // Bot messages are included (fetching a known ID implies intent); the
    // restricted-category exclusion still applies, and so does a scoped
    // call's visible-channel set — an ID must not reach a hidden channel.
    const idLookupFilter = (idValue: string): Document => ({
      id: idValue,
      ...(guildId ? { guildId } : {}),
      ...(visibleChannelIds ? { channelId: { $in: visibleChannelIds } } : {}),
      "channel.parentId": { $not: { $in: EXCLUDED_CATEGORY_IDS } },
    });
    const snowflakeQuery =
      !messageId && query && SNOWFLAKE_PATTERN.test(query.trim())
        ? query.trim()
        : null;

    // ── Count mode — return only the total, zero payloads ──────
    if (mode === "count") {
      const total = await collection.countDocuments(
        messageId ? idLookupFilter(messageId) : filter,
      );
      return { count: total };
    }

    // ── Compact mode — minimal per-message data ───────────────
    if (mode === "compact") {
      const compactProjection = {
        _id: 0,
        id: 1,
        content: 1,
        "author.id": 1,
        "author.username": 1,
        "author.globalName": 1,
        "author.avatar": 1,
        "author.defaultAvatarURL": 1,
        "member.displayName": 1,
        "member.avatar": 1,
        guildId: 1,
        channelId: 1,
        "channel.name": 1,
        createdTimestamp: 1,
      };
      let messages = await collection
        .find(messageId ? idLookupFilter(messageId) : filter)
        .sort({ createdTimestamp: -1 })
        .limit(cappedLimit)
        .project(compactProjection)
        .toArray();
      if (messages.length === 0 && snowflakeQuery) {
        messages = await collection
          .find(idLookupFilter(snowflakeQuery))
          .project(compactProjection)
          .toArray();
      }

      const formatted = messages.map((messageDoc: Document) => ({
        id: messageDoc.id,
        // Truncate content to 120 chars to save tokens
        content:
          messageDoc.content?.length > 120 ? messageDoc.content.slice(0, 120) + "…" : messageDoc.content,
        author:
          messageDoc.member?.displayName || messageDoc.author?.globalName || messageDoc.author?.username,
        avatarUrl: buildAvatarUrl(messageDoc.author, messageDoc.member, messageDoc.guildId),
        channel: messageDoc.channel?.name || null,
        date: messageDoc.createdTimestamp
          ? new Date(messageDoc.createdTimestamp).toISOString().slice(0, 16)
          : null,
      }));

      return { count: formatted.length, messages: formatted };
    }

    // ── Messages mode — full message objects (default) ─────────
    const fullProjection = {
        _id: 0,
        id: 1,
        content: 1,
        cleanContent: 1,
        "author.id": 1,
        "author.username": 1,
        "author.globalName": 1,
        "author.bot": 1,
        "author.avatar": 1,
        "author.defaultAvatarURL": 1,
        "member.displayName": 1,
        "member.displayHexColor": 1,
        "member.avatar": 1,
        // Enhanced Role Styles (gradient/holographic)
        "member.roleColors": 1,
        channelId: 1,
        "channel.name": 1,
        "channel.parentName": 1,
        guildId: 1,
        "channel.guild.name": 1,
        // Guild icon/banner/splash hashes for CDN URL reconstruction
        "channel.guild.icon": 1,
        "channel.guild.banner": 1,
        "channel.guild.splash": 1,
        createdTimestamp: 1,
        createdAt: 1,
        // Reply context
        reference: 1,
        // Attachments (images, files)
        attachments: 1,
        // Embeds (link previews)
        embeds: 1,
        // Stickers
        stickers: 1,
        // Reactions (emoji reactions on the message)
        reactions: 1,
        // Member roles (for badge detection — e.g. Nitro Booster)
        "member.premiumSince": 1,
        "member.premiumSinceTimestamp": 1,
        "member.roles": 1,
        // Author flags (public_flags bitfield for profile badges)
        "author.flags": 1,
        // Archived media URLs (MinIO permanent URLs)
        mediaArchive: 1,
      };
    let messages = await collection
      .find(messageId ? idLookupFilter(messageId) : filter)
      .sort({ createdTimestamp: -1 })
      .limit(cappedLimit)
      .project(fullProjection)
      .toArray();
    if (messages.length === 0 && snowflakeQuery) {
      messages = await collection
        .find(idLookupFilter(snowflakeQuery))
        .project(fullProjection)
        .toArray();
    }

    // Format into a clean shape with human-readable names
    const formatted = messages.map((messageDoc: Document) => {
      // Build attachment list with URLs for image rendering.
      // Prefer archived MinIO URLs over potentially-expired Discord CDN URLs.
      const archive = messageDoc.mediaArchive || null;
      const attachments =
        Array.isArray(messageDoc.attachments) && messageDoc.attachments.length > 0
          ? messageDoc.attachments.map((attachment: Document) => {
              const resolvedUrl =
                resolveArchivedUrl(attachment.url, archive) ||
                resolveArchivedUrl(attachment.proxyURL, archive) ||
                null;
              const resolvedProxy =
                resolveArchivedUrl(attachment.proxyURL, archive) || null;
              return {
                name: attachment.name || null,
                contentType: attachment.contentType || null,
                size: attachment.size || null,
                url: resolvedUrl,
                proxyURL: resolvedProxy,
                width: attachment.width || null,
                height: attachment.height || null,
                duration: attachment.duration ?? null,
                waveform: attachment.waveform ?? null,
                spoiler: attachment.spoiler === true,
              };
            })
          : undefined;

      // Build rich embed objects — preserve image/thumbnail/video for rendering.
      // Resolve archived URLs for embed media as well (belt-and-suspenders).
      const embeds =
        Array.isArray(messageDoc.embeds) && messageDoc.embeds.length > 0
          ? messageDoc.embeds
              .map((embed: Document) => {
                // Skip empty embeds
                if (
                  !embed.title &&
                  !embed.description &&
                  !embed.url &&
                  !embed.image &&
                  !embed.thumbnail &&
                  !embed.video
                )
                  return null;
                return {
                  ...(embed.title && { title: embed.title }),
                  ...(embed.description && { description: embed.description }),
                  ...(embed.url && { url: embed.url }),
                  ...(embed.image && {
                    image: {
                      ...embed.image,
                      url: resolveArchivedUrl(embed.image.url, archive),
                      proxyURL: resolveArchivedUrl(embed.image.proxyURL, archive),
                    },
                  }),
                  ...(embed.thumbnail && {
                    thumbnail: {
                      ...embed.thumbnail,
                      url: resolveArchivedUrl(embed.thumbnail.url, archive),
                      proxyURL: resolveArchivedUrl(
                        embed.thumbnail.proxyURL,
                        archive,
                      ),
                    },
                  }),
                  ...(embed.video && {
                    video: {
                      ...embed.video,
                      ...(embed.video.url && {
                        url: resolveArchivedUrl(embed.video.url, archive),
                      }),
                      ...(embed.video.proxyURL && {
                        proxyURL: resolveArchivedUrl(embed.video.proxyURL, archive),
                      }),
                    },
                  }),
                  ...(embed.provider && { provider: embed.provider }),
                  ...(embed.color != null && { color: embed.color }),
                  // Rich embed body — author, footer, fields, timestamp
                  // (bot embeds lose most of their content without these)
                  ...(embed.author && { author: embed.author }),
                  ...(embed.footer && { footer: embed.footer }),
                  ...(Array.isArray(embed.fields) &&
                    embed.fields.length > 0 && {
                      fields: embed.fields.slice(0, 25),
                    }),
                  ...(embed.timestamp && { timestamp: embed.timestamp }),
                };
              })
              .filter(Boolean)
              .slice(0, 5)
          : undefined;

      // Role color — #000000 means no custom color, treat as null
      const roleColor =
        messageDoc.member?.displayHexColor && messageDoc.member.displayHexColor !== "#000000"
          ? messageDoc.member.displayHexColor
          : null;

      return {
        id: messageDoc.id,
        content: messageDoc.content,
        cleanContent: messageDoc.cleanContent,
        author: {
          id: messageDoc.author?.id,
          username: messageDoc.author?.username,
          displayName:
            messageDoc.member?.displayName || messageDoc.author?.globalName || messageDoc.author?.username,
          avatarUrl: buildAvatarUrl(messageDoc.author, messageDoc.member, messageDoc.guildId),
          isBot: messageDoc.author?.bot === true,
          roleColor,
          // Enhanced Role Styles — gradient (secondary) / holographic (tertiary)
          ...(messageDoc.member?.roleColors?.secondary && {
            roleColors: messageDoc.member.roleColors,
          }),
          // Profile badges (HypeSquad, Active Developer, Nitro Early Supporter, etc.)
          badges: extractBadges(messageDoc.author?.flags),
          // Top role tags displayed to the right of the username (colored pill badges)
          roleTags: extractRoleTags(messageDoc.member?.roles, messageDoc.guildId),
        },
        channelId: messageDoc.channelId,
        channelName: messageDoc.channel?.name || null,
        parentName: messageDoc.channel?.parentName || null,
        guildId: messageDoc.guildId,
        guildName: messageDoc.channel?.guild?.name || null,
        // Guild icon/banner/splash hashes — lets clients build CDN URLs
        // e.g. https://cdn.discordapp.com/icons/{guildId}/{hash}.png
        ...(messageDoc.channel?.guild?.icon && { guildIcon: messageDoc.channel.guild.icon }),
        ...(messageDoc.channel?.guild?.banner && {
          guildBanner: messageDoc.channel.guild.banner,
        }),
        ...(messageDoc.channel?.guild?.splash && {
          guildSplash: messageDoc.channel.guild.splash,
        }),
        createdAtISO: messageDoc.createdTimestamp
          ? new Date(messageDoc.createdTimestamp).toISOString()
          : messageDoc.createdAt,
        // Direct link to the message in Discord
        messageUrl:
          messageDoc.guildId && messageDoc.channelId && messageDoc.id
            ? discordMessageUrl(messageDoc.guildId, messageDoc.channelId, messageDoc.id)
            : null,
        // Reply reference — so Lupos can follow conversation threads
        replyTo: messageDoc.reference?.messageId || null,
        // Emoji reactions (array of { emoji, count, me })
        ...(Array.isArray(messageDoc.reactions) &&
          messageDoc.reactions.length > 0 && {
            reactions: messageDoc.reactions.map((reaction: Document) => ({
              emoji: {
                id: reaction.emoji?.id || null,
                name: reaction.emoji?.name || null,
                animated: reaction.emoji?.animated || false,
              },
              count: reaction.count || reaction.countDetails?.normal || 0,
              // `me` = true when the bot (Lupos) has this reaction — used by
              // the client to render the pill as "already reacted" (blurple,
              // unclickable) since all website reactions go through Lupos.
              me: reaction.me === true,
            })),
          }),
        // Media indicators
        ...(attachments && { attachments }),
        ...(embeds && { embeds }),
        ...(messageDoc.stickers?.length > 0 && {
          stickerCount: messageDoc.stickers.length,
          // Sticker data for rendering — CDN URL is
          // https://media.discordapp.net/stickers/{id}.{png|gif}
          stickers: messageDoc.stickers.map((sticker: Document) => ({
            id: sticker.id,
            name: sticker.name || null,
            // discord.js serializes StickerFormatType as `format`;
            // raw API payloads use `format_type`
            format: sticker.format ?? sticker.formatType ?? sticker.format_type ?? null,
            url: sticker.url || null,
          })),
        }),
      };
    });

    return { count: formatted.length, messages: formatted };
  },

  /**
   * Analyze Discord messages with aggregation queries.
   *
   * Groups messages by a chosen dimension and returns counted
   * results, sorted by count descending. Supports all the same
   * filters as searchMessages.
   *


   *   "user"    — group by author
   *   "channel" — group by channel
   *   "day"     — group by calendar day (YYYY-MM-DD)
   *   "hour"    — group by hour of day (0–23, UTC)
   *   "weekday" — group by day of week (Mon–Sun)
   *   "month"   — group by month (YYYY-MM)


   */
  async analyzeMessages({
    guildId,
    channelId,
    userId,
    username,
    query,
    before,
    after,
    groupBy = "user",
    topN = 25,
    includeBots = false,
    visibleChannelIds,
  }: MessageAnalyticsParams = {}) {
    const collection = getMessagesCollection();
    const filter = buildBaseFilter({
      guildId,
      channelId,
      userId,
      username,
      query,
      before,
      after,
      includeBots,
      visibleChannelIds,
    });
    const cappedTopN = Math.min(Number(topN), 100);

    // Weekday labels for the weekday grouping
    const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // ── Build group expression based on groupBy dimension ──────
    let groupId: MongoGroupId;

    switch (groupBy) {
      case "user":
        groupId = "$author.id";
        break;

      case "channel":
        groupId = "$channelId";
        break;

      case "day":
        // Group by YYYY-MM-DD
        groupId = {
          $dateToString: {
            format: "%Y-%m-%d",
            date: { $toDate: "$createdTimestamp" },
          },
        };
        break;

      case "hour":
        // Group by hour of day (0–23)
        groupId = { $hour: { $toDate: "$createdTimestamp" } };
        break;

      case "weekday":
        // Group by day of week (1=Sun … 7=Sat in MongoDB)
        groupId = { $dayOfWeek: { $toDate: "$createdTimestamp" } };
        break;

      case "month":
        // Group by YYYY-MM
        groupId = {
          $dateToString: {
            format: "%Y-%m",
            date: { $toDate: "$createdTimestamp" },
          },
        };
        break;

      default:
        groupId = "$author.id";
        break;
    }

    // ── Run aggregation ───────────────────────────────────────
    const pipeline = [
      { $match: filter },
      {
        $group: {
          _id: groupId,
          count: { $sum: 1 },
          // Capture extra fields for label building
          ...(groupBy === "user" && {
            username: { $last: "$author.username" },
            displayName: { $last: "$member.displayName" },
            globalName: { $last: "$author.globalName" },
          }),
          ...(groupBy === "channel" && {
            channelName: { $last: "$channel.name" },
          }),
          // First/last timestamps for time-based groups
          firstMessage: { $min: "$createdTimestamp" },
          lastMessage: { $max: "$createdTimestamp" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: cappedTopN },
    ];

    const [results, totalCount] = await Promise.all([
      collection.aggregate(pipeline).toArray(),
      collection.countDocuments(filter),
    ]);

    // ── Format results with human-readable labels ─────────────
    const groups = results.map((r: Document) => {
      const base: Document = { count: r.count };

      switch (groupBy) {
        case "user":
          base.userId = r._id;
          base.label = r.displayName || r.globalName || r.username || r._id;
          base.username = r.username;
          break;

        case "channel":
          base.channelId = r._id;
          base.label = r.channelName || r._id;
          break;

        case "day":
        case "month":
          base.label = r._id; // Already formatted as YYYY-MM-DD or YYYY-MM
          break;

        case "hour":
          base.label = `${String(r._id).padStart(2, "0")}:00 UTC`;
          base.hour = r._id;
          break;

        case "weekday":
          // MongoDB dayOfWeek: 1=Sun, 2=Mon, ..., 7=Sat
          base.label = weekdayLabels[r._id - 1] || `Day ${r._id}`;
          base.dayOfWeek = r._id;
          break;

        default:
          base.label = String(r._id);
          break;
      }

      return base;
    });

    return {
      guildId,
      groupBy,
      totalMatchingMessages: totalCount,
      groupCount: groups.length,
      ...(typeof query === "string" && query ? { query } : {}),
      groups,
    };
  },

  /**
   * Get server activity stats for a guild.
   */
  async getServerActivity({
    guildId,
    channelId,
    days = 7,
    topN = 15,
    visibleChannelIds,
  }: ServerActivityParams = {}) {
    const collection = getMessagesCollection();
    const cappedDays = Math.min(Number(days), 365);
    const sinceTimestamp = Date.now() - daysToMs(cappedDays);

    const match: Document = {
      guildId,
      createdTimestamp: { $gte: sinceTimestamp },
      "author.bot": { $in: [false, null] },
      "channel.parentId": { $not: { $in: EXCLUDED_CATEGORY_IDS } },
    };
    const channel = channelClause(channelId, visibleChannelIds);
    if (channel !== undefined) match.channelId = channel;

    const cappedTopN = Math.min(Number(topN), 50);

    // Run all aggregations in parallel
    const [totalMessages, topUsers, channelBreakdown, hourlyActivity, uniqueUsersResult] =
      await Promise.all([
        // Total message count
        collection.countDocuments(match),

        // Top users by message count
        collection
          .aggregate([
            { $match: match },
            {
              $group: {
                _id: "$author.id",
                username: { $last: "$author.username" },
                count: { $sum: 1 },
                lastActive: { $max: "$createdTimestamp" },
              },
            },
            { $sort: { count: -1 } },
            { $limit: cappedTopN },
          ])
          .toArray(),

        // Channel breakdown (top 10)
        collection
          .aggregate([
            {
              // Keep the match's own channel clause — a scoped call's
              // visible set must hold here too.
              $match: {
                ...match,
                channelId: match.channelId ?? { $exists: true },
              },
            },
            {
              $group: {
                _id: "$channelId",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ])
          .toArray(),

        // Hourly activity distribution
        collection
          .aggregate([
            { $match: match },
            {
              $group: {
                _id: { $hour: { $toDate: "$createdTimestamp" } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray(),

        // Unique users count
        collection
          .aggregate([
            { $match: match },
            { $group: { _id: "$author.id" } },
            { $count: "total" },
          ])
          .toArray(),
      ]);

    const uniqueUsers = uniqueUsersResult[0]?.total || 0;

    return {
      guildId,
      period: {
        days: cappedDays,
        since: new Date(sinceTimestamp).toISOString(),
      },
      totalMessages,
      uniqueUsers,
      avgMessagesPerUser:
        uniqueUsers > 0
          ? Math.round((totalMessages / uniqueUsers) * 10) / 10
          : 0,
      topUsers: topUsers.map((userDoc: Document) => ({
        userId: userDoc._id,
        username: userDoc.username,
        messageCount: userDoc.count,
        lastActive: new Date(userDoc.lastActive).toISOString(),
      })),
      channelBreakdown: channelBreakdown.map((channelDoc: Document) => ({
        channelId: channelDoc._id,
        messageCount: channelDoc.count,
      })),
      hourlyActivity: hourlyActivity.map((hourDoc: Document) => ({
        hour: hourDoc._id,
        messageCount: hourDoc.count,
      })),
    };
  },
};

export default DiscordDataService;
