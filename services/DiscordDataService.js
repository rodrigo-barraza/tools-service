import { getMessagesCollection } from "../models/LuposMessage.js";

// ═══════════════════════════════════════════════════════════════
//  Discord Data Service
//
//  Query layer for the Lupos `Messages` collection. Powers the
//  discord_message_search, discord_server_activity, and
//  discord_message_analytics tools.
// ═══════════════════════════════════════════════════════════════

// ── Excluded Categories ──────────────────────────────────────
// Messages from channels under these Discord category IDs are
// NEVER returned by any query. This is a hard server-side filter.
const EXCLUDED_CATEGORY_IDS = [
  "609652454375555082", // Private/staff channels
  "665736600042340352", // Staff/admin channels
];

/**
 * Build a Discord CDN avatar URL from raw author data stored in MongoDB.
 * Falls back to the default avatar URL (e.g. blue/green Wumpus silhouette).
 *
 * @param {object} author - Raw author subdocument { id, avatar, defaultAvatarURL }
 * @returns {string|null}
 */
function buildAvatarUrl(author) {
  if (!author) return null;
  if (author.avatar && author.id) {
    const ext = author.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${ext}?size=128`;
  }
  return author.defaultAvatarURL || null;
}

/**
 * Build the common MongoDB filter used by search and analytics.
 *
 * @param {object} opts - Filter options
 * @returns {object} MongoDB filter document
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
} = {}) {
  const filter = {};

  if (guildId) filter.guildId = guildId;
  if (channelId) filter.channelId = channelId;
  if (userId) filter["author.id"] = userId;

  // Username search — match across username, globalName, and displayName
  if (username && !userId) {
    const nameRegex = { $regex: username, $options: "i" };
    filter.$or = [
      { "author.username": nameRegex },
      { "author.globalName": nameRegex },
      { "member.displayName": nameRegex },
    ];
  }

  // Exclude bot messages by default — callers can opt-in with includeBots
  if (!includeBots) {
    filter["author.bot"] = { $ne: true };
  }

  // Exclude messages from restricted categories (hard filter)
  filter["channel.parentId"] = { $nin: EXCLUDED_CATEGORY_IDS };

  // Time range
  if (before || after) {
    filter.createdTimestamp = {};
    if (before) filter.createdTimestamp.$lte = new Date(before).getTime();
    if (after) filter.createdTimestamp.$gte = new Date(after).getTime();
  }

  // Text search — prefer $regex for reliability (text index may still be building)
  if (query) {
    filter.content = { $regex: query, $options: "i" };
  }

  return filter;
}

const DiscordDataService = {
  /**
   * Search Discord messages with flexible filters.
   *
   * @param {object} opts
   * @param {string} opts.guildId    - Filter by guild (required)
   * @param {string} [opts.channelId] - Filter by channel
   * @param {string} [opts.userId]    - Filter by author ID
   * @param {string} [opts.username]  - Filter by username/display name (case-insensitive)
   * @param {string} [opts.query]     - Text search query
   * @param {string} [opts.before]    - ISO date string — messages before this date
   * @param {string} [opts.after]     - ISO date string — messages after this date
   * @param {number} [opts.limit=50]  - Max results (capped at 200)
   * @param {string} [opts.mode="messages"] - Response mode:
   *   "messages" — full message objects (default)
   *   "count"    — only the matching count, zero message bodies
   *   "compact"  — minimal per-message data (author, timestamp, truncated content)
   * @returns {Promise<{ count: number, messages?: object[] }>}
   */
  async searchMessages({
    guildId,
    channelId,
    userId,
    username,
    query,
    before,
    after,
    limit = 50,
    mode = "messages",
    includeBots = false,
  } = {}) {
    const col = getMessagesCollection();
    const filter = buildBaseFilter({ guildId, channelId, userId, username, query, before, after, includeBots });
    const cappedLimit = Math.min(limit, 500);

    // ── Count mode — return only the total, zero payloads ──────
    if (mode === "count") {
      const total = await col.countDocuments(filter);
      return { count: total };
    }

    // ── Compact mode — minimal per-message data ───────────────
    if (mode === "compact") {
      const messages = await col
        .find(filter)
        .sort({ createdTimestamp: -1 })
        .limit(cappedLimit)
        .project({
          _id: 0,
          id: 1,
          content: 1,
          "author.id": 1,
          "author.username": 1,
          "author.globalName": 1,
          "author.avatar": 1,
          "author.defaultAvatarURL": 1,
          "member.displayName": 1,
          channelId: 1,
          "channel.name": 1,
          createdTimestamp: 1,
        })
        .toArray();

      const formatted = messages.map((m) => ({
        id: m.id,
        // Truncate content to 120 chars to save tokens
        content: m.content?.length > 120
          ? m.content.slice(0, 120) + "…"
          : m.content,
        author: m.member?.displayName || m.author?.globalName || m.author?.username,
        avatarUrl: buildAvatarUrl(m.author),
        channel: m.channel?.name || null,
        date: m.createdTimestamp
          ? new Date(m.createdTimestamp).toISOString().slice(0, 16)
          : null,
      }));

      return { count: formatted.length, messages: formatted };
    }

    // ── Messages mode — full message objects (default) ─────────
    const messages = await col
      .find(filter)
      .sort({ createdTimestamp: -1 })
      .limit(cappedLimit)
      .project({
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
        channelId: 1,
        "channel.name": 1,
        guildId: 1,
        "channel.guild.name": 1,
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
      })
      .toArray();

    // Format into a clean shape with human-readable names
    const formatted = messages.map((m) => {
      // Build attachment list with URLs for image rendering
      const attachments = Array.isArray(m.attachments) && m.attachments.length > 0
        ? m.attachments.map((a) => ({
          name: a.name || null,
          contentType: a.contentType || null,
          size: a.size || null,
          url: a.url || a.proxyURL || null,
          proxyURL: a.proxyURL || null,
          width: a.width || null,
          height: a.height || null,
        }))
        : undefined;

      // Build embed summary (just titles/descriptions, not full payloads)
      const embeds = Array.isArray(m.embeds) && m.embeds.length > 0
        ? m.embeds.map((e) => e.title || e.description || e.url).filter(Boolean).slice(0, 3)
        : undefined;

      // Role color — #000000 means no custom color, treat as null
      const roleColor = m.member?.displayHexColor && m.member.displayHexColor !== "#000000"
        ? m.member.displayHexColor
        : null;

      return {
        id: m.id,
        content: m.content,
        cleanContent: m.cleanContent,
        author: {
          id: m.author?.id,
          username: m.author?.username,
          displayName: m.member?.displayName || m.author?.globalName || m.author?.username,
          avatarUrl: buildAvatarUrl(m.author),
          isBot: m.author?.bot === true,
          roleColor,
        },
        channelId: m.channelId,
        channelName: m.channel?.name || null,
        guildId: m.guildId,
        guildName: m.channel?.guild?.name || null,
        createdAtISO: m.createdTimestamp
          ? new Date(m.createdTimestamp).toISOString()
          : m.createdAt,
        // Direct link to the message in Discord
        messageUrl: m.guildId && m.channelId && m.id
          ? `https://discord.com/channels/${m.guildId}/${m.channelId}/${m.id}`
          : null,
        // Reply reference — so Lupos can follow conversation threads
        replyTo: m.reference?.messageId || null,
        // Media indicators
        ...(attachments && { attachments }),
        ...(embeds && { embeds }),
        ...(m.stickers?.length > 0 && { stickerCount: m.stickers.length }),
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
   * @param {object} opts
   * @param {string} opts.guildId     - Guild to analyze (required)
   * @param {string} [opts.channelId] - Filter by channel
   * @param {string} [opts.userId]    - Filter by author ID
   * @param {string} [opts.username]  - Filter by username/display name
   * @param {string} [opts.query]     - Text search — count only messages matching this text
   * @param {string} [opts.before]    - ISO date string
   * @param {string} [opts.after]     - ISO date string
   * @param {string} [opts.groupBy="user"] - Dimension to group by:
   *   "user"    — group by author
   *   "channel" — group by channel
   *   "day"     — group by calendar day (YYYY-MM-DD)
   *   "hour"    — group by hour of day (0–23, UTC)
   *   "weekday" — group by day of week (Mon–Sun)
   *   "month"   — group by month (YYYY-MM)
   * @param {number} [opts.topN=25]   - Max groups to return (capped at 100)
   * @returns {Promise<object>}
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
  } = {}) {
    const col = getMessagesCollection();
    const filter = buildBaseFilter({ guildId, channelId, userId, username, query, before, after, includeBots });
    const cappedTopN = Math.min(topN, 100);

    // Weekday labels for the weekday grouping
    const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // ── Build group expression based on groupBy dimension ──────
    let groupId;

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
      col.aggregate(pipeline).toArray(),
      col.countDocuments(filter),
    ]);

    // ── Format results with human-readable labels ─────────────
    const groups = results.map((r) => {
      const base = { count: r.count };

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
      ...(query && { query }),
      groups,
    };
  },

  /**
   * Get server activity stats for a guild.
   *
   * @param {object} opts
   * @param {string} opts.guildId      - Guild to analyze (required)
   * @param {string} [opts.channelId]  - Narrow to a specific channel
   * @param {number} [opts.days=7]     - Lookback period in days (max 365)
   * @param {number} [opts.topN=15]    - Number of top users to return
   * @returns {Promise<object>}
   */
  async getServerActivity({
    guildId,
    channelId,
    days = 7,
    topN = 15,
  } = {}) {
    const col = getMessagesCollection();
    const cappedDays = Math.min(days, 365);
    const sinceTimestamp = Date.now() - cappedDays * 24 * 60 * 60 * 1000;

    const match = {
      guildId,
      createdTimestamp: { $gte: sinceTimestamp },
      "author.bot": { $ne: true },
      "channel.parentId": { $nin: EXCLUDED_CATEGORY_IDS },
    };
    if (channelId) match.channelId = channelId;

    const cappedTopN = Math.min(topN, 50);

    // Run all aggregations in parallel
    const [
      totalMessages,
      topUsers,
      channelBreakdown,
      hourlyActivity,
    ] = await Promise.all([
      // Total message count
      col.countDocuments(match),

      // Top users by message count
      col.aggregate([
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
      ]).toArray(),

      // Channel breakdown (top 10)
      col.aggregate([
        { $match: { ...match, channelId: channelId ? channelId : { $exists: true } } },
        {
          $group: {
            _id: "$channelId",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),

      // Hourly activity distribution
      col.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $hour: { $toDate: "$createdTimestamp" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id": 1 } },
      ]).toArray(),
    ]);

    // Unique users count
    const uniqueUsersResult = await col.aggregate([
      { $match: match },
      { $group: { _id: "$author.id" } },
      { $count: "total" },
    ]).toArray();
    const uniqueUsers = uniqueUsersResult[0]?.total || 0;

    return {
      guildId,
      period: {
        days: cappedDays,
        since: new Date(sinceTimestamp).toISOString(),
      },
      totalMessages,
      uniqueUsers,
      avgMessagesPerUser: uniqueUsers > 0
        ? Math.round(totalMessages / uniqueUsers * 10) / 10
        : 0,
      topUsers: topUsers.map((u) => ({
        userId: u._id,
        username: u.username,
        messageCount: u.count,
        lastActive: new Date(u.lastActive).toISOString(),
      })),
      channelBreakdown: channelBreakdown.map((c) => ({
        channelId: c._id,
        messageCount: c.count,
      })),
      hourlyActivity: hourlyActivity.map((h) => ({
        hour: h._id,
        messageCount: h.count,
      })),
    };
  },
};

export default DiscordDataService;
