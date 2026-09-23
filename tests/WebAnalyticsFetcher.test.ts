import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.ts", () => ({
  default: { PORTAL_SERVICE_URL: "http://portal.test" },
}));

const { getWebAnalytics } =
  await import("../src/fetchers/analytics/WebAnalyticsFetcher.ts");

const summary = (overrides: Record<string, number> = {}) => ({
  visitors: 40,
  newVisitors: 30,
  sessions: 50,
  engagedSessions: 30,
  pageviews: 120,
  engagedMs: 2_500_000,
  avgEngagedMs: 50_000,
  engagementRate: 0.6,
  bounceRate: 0.4,
  pagesPerSession: 2.4,
  ...overrides,
});

const report = {
  summary: summary(),
  previous: summary({ sessions: 40, visitors: 0, engagementRate: 0.5 }),
  series: [
    {
      bucket: "2026-09-23",
      visitors: 4,
      sessions: 5,
      pageviews: 9,
      engagedMs: 1,
    },
  ],
  pages: [{ path: "/", views: 80 }],
  channels: [{ channel: "Direct", sessions: 30 }],
  referrers: [{ host: "news.ycombinator.com", sessions: 10 }],
  campaigns: [],
  countries: [{ country: "CA", name: "Canada", sessions: 20 }],
  cities: [],
  devices: [{ name: "desktop", sessions: 40 }],
  browsers: [],
  os: [],
  screens: [],
};

const routes: Record<string, unknown> = {
  "/google-analytics/properties": { properties: [] },
  "/session-analytics/projects?period=30d": {
    success: true,
    data: [
      {
        projectId: "rod-dev-client",
        visitors: 40,
        sessions: 50,
        pageviews: 120,
        engagedMs: 2_500_000,
        live: 3,
        firstSeenAt: "2026-09-23T00:00:00.000Z",
        lastSeenAt: "2026-09-23T20:00:00.000Z",
      },
    ],
  },
  "/session-analytics/report?projectId=rod-dev-client&period=30d": {
    success: true,
    data: report,
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const path = String(input).replace("http://portal.test", "");
      if (!(path in routes)) return new Response("{}", { status: 404 });
      return Response.json(routes[path]);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getWebAnalytics — first-party", () => {
  it("normalises the report summary, with deltas and the live count", async () => {
    const result = await getWebAnalytics({ source: "firstParty" });
    expect(result.properties).toHaveLength(1);
    const [property] = result.properties;
    expect(property.lastActivity).toBe("2026-09-23T20:00:00.000Z");
    expect(property.firstParty).toEqual({
      projectId: "rod-dev-client",
      sessions: 50,
      pageviews: 120,
      visitors: 40,
      newUsers: 30,
      avgSessionDurationSeconds: 50,
      engagementRatePct: 60,
      bounceRatePct: 40,
      pagesPerSession: 2.4,
      activeNow: 3,
      deltas: {
        sessions: 0.25,
        pageviews: 0,
        totalUsers: 1,
        avgSessionDuration: 0,
        engagementRate: 0.2,
      },
    });
    expect(property.headline).toMatchObject({
      primarySource: "firstParty",
      sessions: 50,
    });
  });

  it("slices a breakdown out of the one report", async () => {
    const result = await getWebAnalytics({
      source: "firstParty",
      breakdown: "sources",
    });
    expect(result.properties[0].firstParty).toEqual({
      channels: report.channels,
      referrers: report.referrers,
      campaigns: [],
    });
  });
});
