import { getMessagesCollection } from "../models/LuposMessage.js";

// ═══════════════════════════════════════════════════════════════
//  Discord Data Service
//
//  Query layer for the Lupos `Messages` collection. Powers the
//  discord_message_search and discord_server_activity tools.
// ═══════════════════════════════════════════════════════════════

const DiscordDataService = {
  /**
   * Search Discord messages with flexible filters.
   *
   * @param {object} opts
   * @param {string} opts.guildId    - Filter by guild (required)
   * @param {string} [opts.channelId] - Filter by channel
   * @param {string} [opts.userId]    - Filter by author ID
   * @param {string} [opts.query]     - Text search query
   * @param {string} [opts.before]    - ISO date string — messages before this date
   * @param {string} [opts.after]     - ISO date string — messages after this date
   * @param {number} [opts.limit=50]  - Max results (capped at 200)
   * @returns {Promise<{ count: number, messages: object[] }>}
   */
  async searchMessages({
    guildId,
    channelId,
    userId,
    query,
    before,
    after,
    limit = 50,
  } = {}) {
    const col = getMessagesCollection();
    const filter = {};

    if (guildId) filter.guildId = guildId;
    if (channelId) filter.channelId = channelId;
    if (userId) filter["author.id"] = userId;

    // Exclude bot messages by default
    filter["author.bot"] = { $ne: true };

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

    const cappedLimit = Math.min(limit, 200);

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
        "author.bot": 1,
        channelId: 1,
        guildId: 1,
        createdTimestamp: 1,
        createdAt: 1,
      })
      .toArray();

    // Format timestamps for readability
    const formatted = messages.map((m) => ({
      ...m,
      createdAtISO: m.createdTimestamp
        ? new Date(m.createdTimestamp).toISOString()
        : m.createdAt,
    }));

    return { count: formatted.length, messages: formatted };
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
