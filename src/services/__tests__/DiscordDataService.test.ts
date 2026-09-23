import { describe, it, expect, vi, beforeEach } from "vitest";

// ═══════════════════════════════════════════════════════════════
// DiscordDataService — Pure Logic Unit Tests
//
// Tests the filter construction, mode dispatch, analytics grouping,
// and parameter capping logic by mocking the MongoDB collection.
// ═══════════════════════════════════════════════════════════════

// ── Mock Setup — fresh per test ──────────────────────────────

let mockFind: ReturnType<typeof vi.fn>;
let mockCountDocuments: ReturnType<typeof vi.fn>;
let mockAggregate: ReturnType<typeof vi.fn>;

function createChainableFindMock() {
  const toArrayMock = vi.fn(async () => []);
  const projectMock = vi.fn(() => ({ toArray: toArrayMock }));
  const limitMock = vi.fn(() => ({ project: projectMock }));
  const sortMock = vi.fn(() => ({ limit: limitMock }));
  // ID lookups skip sort/limit and project directly off the cursor.
  mockFind = vi.fn(() => ({ sort: sortMock, project: projectMock }));
  mockCountDocuments = vi.fn(async () => 0);
  mockAggregate = vi.fn(() => ({ toArray: vi.fn(async () => []) }));

  return {
    find: mockFind,
    countDocuments: mockCountDocuments,
    aggregate: mockAggregate,
    limitMock,
  };
}

let currentCollection: ReturnType<typeof createChainableFindMock>;

vi.mock("../../models/LuposMessage.ts", () => ({
  getMessagesCollection: vi.fn(() => currentCollection),
}));

import DiscordDataService from "../DiscordDataService.ts";

beforeEach(() => {
  currentCollection = createChainableFindMock();
});

// ── Helper ───────────────────────────────────────────────────

function lastFilter(): Record<string, unknown> {
  const lastCall = mockFind.mock.calls[mockFind.mock.calls.length - 1];
  return lastCall ? lastCall[0] : {};
}

// ── searchMessages — Filter Construction ─────────────────────

describe("DiscordDataService.searchMessages — Filter Construction", () => {
  it("builds a filter with guildId when provided", async () => {
    await DiscordDataService.searchMessages({ guildId: "123456" });
    expect(lastFilter().guildId).toBe("123456");
  });

  it("builds a filter with channelId when provided", async () => {
    await DiscordDataService.searchMessages({ channelId: "chan-789" });
    expect(lastFilter().channelId).toBe("chan-789");
  });

  it("builds a filter with userId in author.id", async () => {
    await DiscordDataService.searchMessages({ userId: "user-42" });
    expect(lastFilter()["author.id"]).toBe("user-42");
  });

  it("builds a username regex filter across username, globalName, and displayName", async () => {
    await DiscordDataService.searchMessages({ username: "rodrigo" });
    const filter = lastFilter();
    expect(filter.$or).toBeDefined();
    expect(filter.$or).toHaveLength(3);
  });

  it("prefers userId over username when both are provided", async () => {
    await DiscordDataService.searchMessages({ userId: "user-42", username: "rodrigo" });
    const filter = lastFilter();
    expect(filter["author.id"]).toBe("user-42");
    expect(filter.$or).toBeUndefined();
  });

  it("excludes bots by default with $in: [false, null]", async () => {
    await DiscordDataService.searchMessages({});
    expect(lastFilter()["author.bot"]).toEqual({ $in: [false, null] });
  });

  it("includes bots when includeBots is true", async () => {
    await DiscordDataService.searchMessages({ includeBots: true });
    expect(lastFilter()["author.bot"]).toBeUndefined();
  });

  it("always excludes restricted category IDs", async () => {
    await DiscordDataService.searchMessages({});
    expect(lastFilter()["channel.parentId"]).toEqual({
      $not: { $in: expect.arrayContaining(["609652454375555082", "665736600042340352"]) },
    });
  });

  it("builds timestamp range filter for before/after", async () => {
    const beforeDate = "2026-01-01T00:00:00Z";
    const afterDate = "2025-01-01T00:00:00Z";
    await DiscordDataService.searchMessages({ before: beforeDate, after: afterDate });
    const filter = lastFilter();
    expect(filter.createdTimestamp).toBeDefined();
    expect(filter.createdTimestamp.$lte).toBe(new Date(beforeDate).getTime());
    expect(filter.createdTimestamp.$gte).toBe(new Date(afterDate).getTime());
  });

  it("adds $text search when query is provided", async () => {
    await DiscordDataService.searchMessages({ query: "hello world" });
    expect(lastFilter().$text).toEqual({ $search: "hello world" });
  });

  it("caps limit to 500 maximum", async () => {
    await DiscordDataService.searchMessages({ limit: 999 });
    const findResult = mockFind.mock.results[0].value;
    const sortResult = findResult.sort.mock.results[0].value;
    const limitCall = sortResult.limit.mock.calls[0][0];
    expect(limitCall).toBe(500);
  });
});

// ── searchMessages — Message-ID Lookup ───────────────────────

describe("DiscordDataService.searchMessages — Message-ID Lookup", () => {
  const SNOWFLAKE = "1526820952019701853";

  it("fetches by exact id when messageId is provided (bots included, categories still excluded)", async () => {
    await DiscordDataService.searchMessages({
      guildId: "g1",
      messageId: SNOWFLAKE,
    });
    const filter = lastFilter();
    expect(filter.id).toBe(SNOWFLAKE);
    expect(filter.guildId).toBe("g1");
    expect(filter.$text).toBeUndefined();
    // Fetching a known ID implies intent — bot messages are included
    expect(filter["author.bot"]).toBeUndefined();
    // The hard privacy filter still applies
    expect(filter["channel.parentId"]).toBeDefined();
  });

  it("falls back to an id lookup when a bare snowflake query matches nothing as text", async () => {
    await DiscordDataService.searchMessages({ query: SNOWFLAKE });
    expect(mockFind).toHaveBeenCalledTimes(2);
    expect(mockFind.mock.calls[0][0].$text).toEqual({ $search: SNOWFLAKE });
    expect(lastFilter().id).toBe(SNOWFLAKE);
  });

  it("does not fall back for non-snowflake queries with zero hits", async () => {
    await DiscordDataService.searchMessages({ query: "hello world" });
    expect(mockFind).toHaveBeenCalledTimes(1);
  });

  it("applies the id lookup in compact and count modes too", async () => {
    await DiscordDataService.searchMessages({
      messageId: SNOWFLAKE,
      mode: "compact",
    });
    expect(lastFilter().id).toBe(SNOWFLAKE);

    await DiscordDataService.searchMessages({
      messageId: SNOWFLAKE,
      mode: "count",
    });
    const countFilter =
      mockCountDocuments.mock.calls[mockCountDocuments.mock.calls.length - 1][0];
    expect(countFilter.id).toBe(SNOWFLAKE);
  });
});

// ── searchMessages — Count Mode ──────────────────────────────

describe("DiscordDataService.searchMessages — Count Mode", () => {
  it("calls countDocuments instead of find for count mode", async () => {
    const result = await DiscordDataService.searchMessages({ mode: "count" });
    expect(mockCountDocuments).toHaveBeenCalled();
    expect(result).toHaveProperty("count");
    expect(result).not.toHaveProperty("messages");
  });
});

// ── searchMessages — Compact Mode ────────────────────────────

describe("DiscordDataService.searchMessages — Compact Mode", () => {
  it("returns formatted compact results", async () => {
    const result = await DiscordDataService.searchMessages({ mode: "compact" });
    expect(result).toHaveProperty("count", 0);
    expect(result).toHaveProperty("messages");
    expect(result.messages).toEqual([]);
  });
});

// ── analyzeMessages — GroupBy Dimensions ─────────────────────

describe("DiscordDataService.analyzeMessages — GroupBy Dimensions", () => {
  it("accepts groupBy: user", async () => {
    const result = await DiscordDataService.analyzeMessages({ groupBy: "user" });
    expect(result.groupBy).toBe("user");
    expect(result).toHaveProperty("groups");
    expect(result).toHaveProperty("totalMatchingMessages");
  });

  it("accepts groupBy: channel", async () => {
    const result = await DiscordDataService.analyzeMessages({ groupBy: "channel" });
    expect(result.groupBy).toBe("channel");
  });

  it("accepts groupBy: day", async () => {
    const result = await DiscordDataService.analyzeMessages({ groupBy: "day" });
    expect(result.groupBy).toBe("day");
  });

  it("accepts groupBy: hour", async () => {
    const result = await DiscordDataService.analyzeMessages({ groupBy: "hour" });
    expect(result.groupBy).toBe("hour");
  });

  it("accepts groupBy: weekday", async () => {
    const result = await DiscordDataService.analyzeMessages({ groupBy: "weekday" });
    expect(result.groupBy).toBe("weekday");
  });

  it("accepts groupBy: month", async () => {
    const result = await DiscordDataService.analyzeMessages({ groupBy: "month" });
    expect(result.groupBy).toBe("month");
  });

  it("defaults to groupBy: user when not specified", async () => {
    const result = await DiscordDataService.analyzeMessages({});
    expect(result.groupBy).toBe("user");
  });

  it("caps topN to 100", async () => {
    await DiscordDataService.analyzeMessages({ topN: 999 });

    const aggregateCall = mockAggregate.mock.calls[0][0];
    const limitStage = aggregateCall.find(
      (stage: Record<string, unknown>) => "$limit" in stage,
    );
    expect(limitStage.$limit).toBe(100);
  });

  it("includes query in response when provided", async () => {
    const result = await DiscordDataService.analyzeMessages({ query: "test" });
    expect(result.query).toBe("test");
  });

  it("omits query from response when not provided", async () => {
    const result = await DiscordDataService.analyzeMessages({});
    expect(result.query).toBeUndefined();
  });
});

// ── getServerActivity ────────────────────────────────────────

describe("DiscordDataService.getServerActivity", () => {
  it("caps days to 365", async () => {
    // getServerActivity calls countDocuments first, then multiple aggregations
    await DiscordDataService.getServerActivity({ days: 999, guildId: "test-guild" });

    const countCall = mockCountDocuments.mock.calls[0][0];
    const sinceTimestamp = countCall.createdTimestamp.$gte;
    const daysDifference = (Date.now() - sinceTimestamp) / (1000 * 60 * 60 * 24);
    expect(daysDifference).toBeCloseTo(365, 0);
  });

  it("returns structured activity response", async () => {
    const result = await DiscordDataService.getServerActivity({
      guildId: "test-guild",
      days: 7,
    });

    expect(result).toHaveProperty("guildId", "test-guild");
    expect(result.period).toHaveProperty("days", 7);
    expect(result).toHaveProperty("totalMessages");
    expect(result).toHaveProperty("uniqueUsers");
    expect(result).toHaveProperty("avgMessagesPerUser");
    expect(result).toHaveProperty("topUsers");
    expect(result).toHaveProperty("channelBreakdown");
    expect(result).toHaveProperty("hourlyActivity");
  });
});

// ── Discord-scoped calls — the requester's visible channels ──

describe("DiscordDataService — visibleChannelIds (Discord-scoped calls)", () => {
  const VISIBLE = ["chan-a", "thread-b"];

  it("limits a search to the visible channels and threads", async () => {
    await DiscordDataService.searchMessages({ guildId: "g1", visibleChannelIds: VISIBLE });
    expect(lastFilter().channelId).toEqual({ $in: VISIBLE });
  });

  it("keeps an explicit visible channel, and matches nothing for a hidden one", async () => {
    await DiscordDataService.searchMessages({ channelId: "thread-b", visibleChannelIds: VISIBLE });
    expect(lastFilter().channelId).toBe("thread-b");

    await DiscordDataService.searchMessages({ channelId: "staff", visibleChannelIds: VISIBLE });
    expect(lastFilter().channelId).toEqual({ $in: [] });
  });

  it("holds a message-ID lookup, and the bare-snowflake fallback, to the visible channels", async () => {
    await DiscordDataService.searchMessages({
      guildId: "g1",
      messageId: "1526820952019701853",
      visibleChannelIds: VISIBLE,
    });
    expect(lastFilter()).toMatchObject({
      id: "1526820952019701853",
      guildId: "g1",
      channelId: { $in: VISIBLE },
    });

    await DiscordDataService.searchMessages({
      query: "1526820952019701853",
      visibleChannelIds: VISIBLE,
    });
    expect(lastFilter()).toMatchObject({ id: "1526820952019701853", channelId: { $in: VISIBLE } });
  });

  it("holds count mode to the visible channels", async () => {
    await DiscordDataService.searchMessages({ mode: "count", visibleChannelIds: VISIBLE });
    expect(mockCountDocuments.mock.calls[0][0].channelId).toEqual({ $in: VISIBLE });
  });

  it("groups analytics (by channel too) over the visible channels only", async () => {
    await DiscordDataService.analyzeMessages({ groupBy: "channel", visibleChannelIds: VISIBLE });
    const [pipeline] = mockAggregate.mock.calls[0];
    expect(pipeline[0].$match.channelId).toEqual({ $in: VISIBLE });
    expect(mockCountDocuments.mock.calls[0][0].channelId).toEqual({ $in: VISIBLE });
  });

  it("keeps the visible set in every server-activity aggregation, the channel breakdown included", async () => {
    await DiscordDataService.getServerActivity({ guildId: "g1", visibleChannelIds: VISIBLE });
    expect(mockCountDocuments.mock.calls[0][0].channelId).toEqual({ $in: VISIBLE });
    for (const [pipeline] of mockAggregate.mock.calls) {
      expect(pipeline[0].$match.channelId).toEqual({ $in: VISIBLE });
    }
  });

  it("leaves an unscoped server activity as before (breakdown over every channel)", async () => {
    await DiscordDataService.getServerActivity({ guildId: "g1" });
    expect(mockCountDocuments.mock.calls[0][0].channelId).toBeUndefined();
    const breakdown = mockAggregate.mock.calls.find(([pipeline]) =>
      pipeline.some((stage: Record<string, unknown>) =>
        JSON.stringify(stage).includes('"$group":{"_id":"$channelId"'),
      ),
    );
    expect(breakdown?.[0][0].$match.channelId).toEqual({ $exists: true });
  });
});
