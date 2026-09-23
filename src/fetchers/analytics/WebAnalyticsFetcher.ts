// ─── Web Analytics Fetcher ──────────────────────────────────
// Unified web-analytics reader for the user's own web properties.
//
// Two independent analytics sources cover these sites:
//   • Google Analytics (GA4)  — proxied by portal-service at
//     /google-analytics/*, keyed by a numeric GA property id.
//   • First-party sessions-service — proxied by portal-service at
//     /session-analytics/* (which forwards to sessions-service
//     /stats/* with the shared secret), keyed by projectId.
//
// Some properties exist in BOTH sources. They are joined on the
// registry project id — exposed as `serviceId` on a GA property and
// as `projectId` on a sessions-service project — so each property is
// reported ONCE, with whichever source(s) have data attached.
//
// Data flows entirely through portal-service, which tools-service
// already reaches via PORTAL_SERVICE_URL. No GA credentials or
// sessions secret are needed here.
//
// NOTE ON UNIFICATION: a "GA session" and a "sessions-service
// session" are measured differently (GA models consent and sampling;
// sessions-service counts every browser that ran its tracker, bots and
// automation excluded, with engaged time only while the page was in use).
// The two are therefore reported SIDE BY SIDE and never summed. The
// `headline` block picks a single primary source (Google Analytics
// when present, else first-party) so a caller has one coherent set
// of numbers to cite.

import CONFIG from "../../config.ts";
import logger from "../../logger.ts";
import { getErrorMessage } from "@rodrigo-barraza/utilities-library";
import {
  createApiClient,
  type ApiClient,
} from "@rodrigo-barraza/utilities-library/http";

const REQUEST_TIMEOUT_MS = 15_000;

export type AnalyticsPeriod = "7d" | "30d" | "90d";
export type AnalyticsSource = "all" | "google" | "firstParty";
export type AnalyticsBreakdown =
  | "overview"
  | "timeseries"
  | "pages"
  | "sources"
  | "geo"
  | "devices";

export const VALID_PERIODS: AnalyticsPeriod[] = ["7d", "30d", "90d"];
export const VALID_SOURCES: AnalyticsSource[] = ["all", "google", "firstParty"];
export const VALID_BREAKDOWNS: AnalyticsBreakdown[] = [
  "overview",
  "timeseries",
  "pages",
  "sources",
  "geo",
  "devices",
];

// ─── Portal transport ──────────────────────────────────────────

function resolvePortalBaseUrl(): string {
  const baseUrl = CONFIG.PORTAL_SERVICE_URL;
  if (!baseUrl) {
    throw new Error("PORTAL_SERVICE_URL is not configured");
  }
  return baseUrl;
}

export function isAnalyticsConfigured(): boolean {
  return Boolean(CONFIG.PORTAL_SERVICE_URL);
}

// Lazily created so an unconfigured PORTAL_SERVICE_URL throws at call time
// (inside safeGet's catch) rather than at import time, and runtime CONFIG
// changes are picked up. Both GA and sessions analytics flow through
// portal-service, so a single client covers both sources.
let cachedPortalClient: ApiClient | null = null;
let cachedPortalBaseUrl: string | null = null;

function portalClient(): ApiClient {
  const baseUrl = resolvePortalBaseUrl();
  if (!cachedPortalClient || cachedPortalBaseUrl !== baseUrl) {
    cachedPortalClient = createApiClient(baseUrl, {
      headers: { Accept: "application/json" },
      timeoutMilliseconds: REQUEST_TIMEOUT_MS,
      fetchImplementation: (input, init) => fetch(input, init),
    });
    cachedPortalBaseUrl = baseUrl;
  }
  return cachedPortalClient;
}

// A single failing source must not break the whole tool — callers
// treat null as "no data from this source for this property".
async function safeGet<T = unknown>(path: string): Promise<T | null> {
  try {
    return await portalClient().get<T>(path);
  } catch (error: unknown) {
    logger.warn(`[WebAnalytics] GET ${path} failed: ${getErrorMessage(error)}`);
    return null;
  }
}

// sessions-service wraps every /stats payload as { success, data }.
// portal-service forwards it verbatim; unwrap to the inner data.
async function safeSessionsGet<T = unknown>(path: string): Promise<T | null> {
  const response = await safeGet<{ success?: boolean; data?: T }>(path);
  if (!response) return null;
  return response.data ?? null;
}

// ─── Source enumeration ────────────────────────────────────────

interface GaProperty {
  id: string;
  label: string;
  measurementId: string;
  serviceId: string;
  domain: string | null;
}

interface SessionsProject {
  projectId: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  engagedMs: number;
  live: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

async function listGaProperties(): Promise<GaProperty[]> {
  const response = await safeGet<{ properties?: GaProperty[] }>(
    "/google-analytics/properties",
  );
  return response?.properties ?? [];
}

async function listSessionsProjects(
  period: string,
): Promise<SessionsProject[]> {
  const data = await safeSessionsGet<SessionsProject[]>(
    `/session-analytics/projects?period=${encodeURIComponent(period)}`,
  );
  return Array.isArray(data) ? data : [];
}

// ─── Property registry (the join) ──────────────────────────────

interface PropertyMeta {
  key: string; // registry project id — the join key (serviceId === projectId)
  label: string;
  domain: string | null;
  gaPropertyId: string | null;
  measurementId: string | null;
  hasSessions: boolean;
  /** First-party sessions active in the last 5 minutes. */
  activeNow: number | null;
  lastActivity: string | null;
}

function buildRegistry(
  gaProperties: GaProperty[],
  sessionsProjects: SessionsProject[],
): Map<string, PropertyMeta> {
  const registry = new Map<string, PropertyMeta>();

  for (const property of gaProperties) {
    registry.set(property.serviceId, {
      key: property.serviceId,
      label: property.label || property.serviceId,
      domain: property.domain ?? null,
      gaPropertyId: property.id,
      measurementId: property.measurementId || null,
      hasSessions: false,
      activeNow: null,
      lastActivity: null,
    });
  }

  for (const project of sessionsProjects) {
    const existing = registry.get(project.projectId);
    if (existing) {
      existing.hasSessions = true;
      existing.activeNow = project.live ?? 0;
      existing.lastActivity = project.lastSeenAt ?? null;
    } else {
      registry.set(project.projectId, {
        key: project.projectId,
        label: project.projectId,
        domain: null,
        gaPropertyId: null,
        measurementId: null,
        hasSessions: true,
        activeNow: project.live ?? 0,
        lastActivity: project.lastSeenAt ?? null,
      });
    }
  }

  return registry;
}

// Match the caller's `property` filter against any stable identifier.
function matchesFilter(meta: PropertyMeta, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return [meta.key, meta.domain, meta.gaPropertyId, meta.label]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase() === needle);
}

// ─── Normalisation ─────────────────────────────────────────────
// GA reports rates as 0..1 ratios and durations in seconds;
// sessions-service reports rates as 0..1 ratios and durations in
// milliseconds. Normalise both to percentages + seconds so the two
// blocks (and the headline) are directly comparable.

interface NormalizedOverview {
  sessions: number;
  pageviews: number;
  visitors: number;
  newUsers: number | null;
  avgSessionDurationSeconds: number;
  engagementRatePct: number;
  bounceRatePct: number;
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((value || 0) * factor) / factor;
}

interface GaOverviewPayload {
  sessions?: number;
  pageviews?: number;
  activeUsers?: number;
  totalUsers?: number;
  newUsers?: number;
  bounceRate?: number;
  avgSessionDuration?: number;
  engagementRate?: number;
  deltas?: Record<string, number>;
}

function normalizeGaOverview(ga: GaOverviewPayload): NormalizedOverview {
  return {
    sessions: ga.sessions ?? 0,
    pageviews: ga.pageviews ?? 0,
    visitors: ga.totalUsers ?? 0,
    newUsers: ga.newUsers ?? 0,
    avgSessionDurationSeconds: round(ga.avgSessionDuration ?? 0),
    engagementRatePct: round((ga.engagementRate ?? 0) * 100, 1),
    bounceRatePct: round((ga.bounceRate ?? 0) * 100, 1),
  };
}

/** sessions-service /stats/report `summary` (and `previous`). */
interface SessionsSummary {
  visitors: number;
  newVisitors: number;
  sessions: number;
  engagedSessions: number;
  pageviews: number;
  engagedMs: number;
  avgEngagedMs: number;
  engagementRate: number; // 0..1
  bounceRate: number; // 0..1
  pagesPerSession: number;
}

/** The parts of sessions-service /stats/report this tool reads. */
interface SessionsReport {
  summary: SessionsSummary;
  previous: SessionsSummary | null;
  series: unknown[];
  pages: unknown[];
  channels: unknown[];
  referrers: unknown[];
  campaigns: unknown[];
  countries: unknown[];
  cities: unknown[];
  devices: unknown[];
  browsers: unknown[];
  os: unknown[];
  screens: unknown[];
}

function normalizeSessionsOverview(
  summary: SessionsSummary,
): NormalizedOverview {
  return {
    sessions: summary.sessions ?? 0,
    pageviews: summary.pageviews ?? 0,
    visitors: summary.visitors ?? 0,
    newUsers: summary.newVisitors ?? 0,
    avgSessionDurationSeconds: round((summary.avgEngagedMs ?? 0) / 1000),
    engagementRatePct: round((summary.engagementRate ?? 0) * 100, 1),
    bounceRatePct: round((summary.bounceRate ?? 0) * 100, 1),
  };
}

/** Same ratio as GA's deltas (0.25 = +25 %), under GA's key names. */
function relativeDelta(current: number, previous: number): number {
  if (!previous) return current > 0 ? 1 : 0;
  return round((current - previous) / Math.abs(previous), 4);
}

function sessionsDeltas(
  summary: SessionsSummary,
  previous: SessionsSummary | null,
): Record<string, number> | null {
  if (!previous) return null;
  return {
    sessions: relativeDelta(summary.sessions, previous.sessions),
    pageviews: relativeDelta(summary.pageviews, previous.pageviews),
    totalUsers: relativeDelta(summary.visitors, previous.visitors),
    avgSessionDuration: relativeDelta(
      summary.avgEngagedMs,
      previous.avgEngagedMs,
    ),
    engagementRate: relativeDelta(
      summary.engagementRate,
      previous.engagementRate,
    ),
  };
}

// ─── Breakdown sources ─────────────────────────────────────────
// GA has one endpoint per breakdown; sessions-service answers every
// breakdown from its single /report, sliced here.

const GA_ENDPOINTS: Record<
  AnalyticsBreakdown,
  (propertyId: string, period: string) => string
> = {
  overview: (id, p) =>
    `/google-analytics/${encodeURIComponent(id)}/overview?period=${p}`,
  timeseries: (id, p) =>
    `/google-analytics/${encodeURIComponent(id)}/timeseries?period=${p}`,
  pages: (id, p) =>
    `/google-analytics/${encodeURIComponent(id)}/pages?period=${p}`,
  sources: (id, p) =>
    `/google-analytics/${encodeURIComponent(id)}/sources?period=${p}`,
  geo: (id, p) =>
    `/google-analytics/${encodeURIComponent(id)}/geography?period=${p}`,
  devices: (id, p) =>
    `/google-analytics/${encodeURIComponent(id)}/devices?period=${p}`,
};

const SESSIONS_SECTIONS: Record<
  Exclude<AnalyticsBreakdown, "overview">,
  (report: SessionsReport) => Record<string, unknown>
> = {
  timeseries: (report) => ({ series: report.series }),
  pages: (report) => ({ pages: report.pages }),
  sources: (report) => ({
    channels: report.channels,
    referrers: report.referrers,
    campaigns: report.campaigns,
  }),
  geo: (report) => ({ countries: report.countries, cities: report.cities }),
  devices: (report) => ({
    devices: report.devices,
    browsers: report.browsers,
    os: report.os,
    screens: report.screens,
  }),
};

function sessionsReport(
  projectId: string,
  period: string,
): Promise<SessionsReport | null> {
  return safeSessionsGet<SessionsReport>(
    `/session-analytics/report?projectId=${encodeURIComponent(projectId)}&period=${period}`,
  );
}

// ─── Per-property assembly ─────────────────────────────────────

interface UnifiedProperty {
  property: string;
  label: string;
  domain: string | null;
  sources: string[];
  google: Record<string, unknown> | null;
  firstParty: Record<string, unknown> | null;
  headline?: Record<string, unknown> | null;
  lastActivity?: string | null;
}

async function buildOverviewProperty(
  meta: PropertyMeta,
  period: string,
  includeGoogle: boolean,
  includeSessions: boolean,
): Promise<UnifiedProperty> {
  const [gaRaw, report] = await Promise.all([
    includeGoogle && meta.gaPropertyId
      ? safeGet<GaOverviewPayload>(
          GA_ENDPOINTS.overview(meta.gaPropertyId, period),
        )
      : Promise.resolve(null),
    includeSessions && meta.hasSessions
      ? sessionsReport(meta.key, period)
      : Promise.resolve(null),
  ]);

  const google = gaRaw
    ? {
        propertyId: meta.gaPropertyId,
        measurementId: meta.measurementId,
        ...normalizeGaOverview(gaRaw),
        deltas: gaRaw.deltas ?? null,
      }
    : null;

  const firstParty = report
    ? {
        projectId: meta.key,
        ...normalizeSessionsOverview(report.summary),
        pagesPerSession: round(report.summary.pagesPerSession ?? 0, 2),
        activeNow: meta.activeNow,
        deltas: sessionsDeltas(report.summary, report.previous),
      }
    : null;

  const sources: string[] = [];
  if (google) sources.push("google");
  if (firstParty) sources.push("firstParty");

  // Single set of numbers to cite; GA preferred, never a sum.
  const primary = google ?? firstParty;
  const headline = primary
    ? {
        primarySource: google ? "google" : "firstParty",
        sessions: primary.sessions,
        pageviews: primary.pageviews,
        visitors: primary.visitors,
        avgSessionDurationSeconds: primary.avgSessionDurationSeconds,
        engagementRatePct: primary.engagementRatePct,
        bounceRatePct: primary.bounceRatePct,
      }
    : null;

  return {
    property: meta.key,
    label: meta.label,
    domain: meta.domain,
    sources,
    google,
    firstParty,
    headline,
    lastActivity: meta.lastActivity,
  };
}

async function buildBreakdownProperty(
  meta: PropertyMeta,
  breakdown: Exclude<AnalyticsBreakdown, "overview">,
  period: string,
  includeGoogle: boolean,
  includeSessions: boolean,
): Promise<UnifiedProperty> {
  const [google, report] = await Promise.all([
    includeGoogle && meta.gaPropertyId
      ? safeGet<Record<string, unknown>>(
          GA_ENDPOINTS[breakdown](meta.gaPropertyId, period),
        )
      : Promise.resolve(null),
    includeSessions && meta.hasSessions
      ? sessionsReport(meta.key, period)
      : Promise.resolve(null),
  ]);
  const firstParty = report ? SESSIONS_SECTIONS[breakdown](report) : null;

  const sources: string[] = [];
  if (google) sources.push("google");
  if (firstParty) sources.push("firstParty");

  return {
    property: meta.key,
    label: meta.label,
    domain: meta.domain,
    sources,
    google,
    firstParty,
    lastActivity: meta.lastActivity,
  };
}

// ─── Public entry point ────────────────────────────────────────

export interface WebAnalyticsOptions {
  property?: string;
  period?: AnalyticsPeriod;
  source?: AnalyticsSource;
  breakdown?: AnalyticsBreakdown;
}

export interface WebAnalyticsResult {
  period: AnalyticsPeriod;
  breakdown: AnalyticsBreakdown;
  source: AnalyticsSource;
  propertyCount: number;
  properties: UnifiedProperty[];
  notes: string[];
  fetchedAt: string;
}

export async function getWebAnalytics(
  options: WebAnalyticsOptions = {},
): Promise<WebAnalyticsResult> {
  const period: AnalyticsPeriod = VALID_PERIODS.includes(
    options.period as AnalyticsPeriod,
  )
    ? (options.period as AnalyticsPeriod)
    : "30d";
  const source: AnalyticsSource = VALID_SOURCES.includes(
    options.source as AnalyticsSource,
  )
    ? (options.source as AnalyticsSource)
    : "all";
  const breakdown: AnalyticsBreakdown = VALID_BREAKDOWNS.includes(
    options.breakdown as AnalyticsBreakdown,
  )
    ? (options.breakdown as AnalyticsBreakdown)
    : "overview";

  const includeGoogle = source === "all" || source === "google";
  const includeSessions = source === "all" || source === "firstParty";

  const [gaProperties, sessionsProjects] = await Promise.all([
    includeGoogle ? listGaProperties() : Promise.resolve([]),
    includeSessions ? listSessionsProjects(period) : Promise.resolve([]),
  ]);

  const registry = buildRegistry(gaProperties, sessionsProjects);

  let candidates = [...registry.values()];

  // A `source` filter also restricts which properties appear at all:
  // google-only excludes sessions-only sites, and vice versa.
  if (source === "google")
    candidates = candidates.filter((meta) => meta.gaPropertyId);
  if (source === "firstParty")
    candidates = candidates.filter((meta) => meta.hasSessions);

  if (options.property) {
    candidates = candidates.filter((meta) =>
      matchesFilter(meta, options.property!),
    );
  }

  candidates.sort((a, b) => a.key.localeCompare(b.key));

  const properties = await Promise.all(
    candidates.map((meta) =>
      breakdown === "overview"
        ? buildOverviewProperty(meta, period, includeGoogle, includeSessions)
        : buildBreakdownProperty(
            meta,
            breakdown,
            period,
            includeGoogle,
            includeSessions,
          ),
    ),
  );

  const notes: string[] = [];
  if (!isAnalyticsConfigured()) {
    notes.push(
      "PORTAL_SERVICE_URL is not configured; no analytics sources are reachable.",
    );
  }
  if (options.property && properties.length === 0) {
    notes.push(`No web property matched "${options.property}".`);
  }
  const joined = properties.filter((p) => p.sources.length > 1).length;
  if (joined > 0) {
    notes.push(
      `${joined} propert${joined === 1 ? "y is" : "ies are"} tracked by both Google Analytics and the first-party sessions-service; their metrics are reported side by side (never summed) because the two count sessions differently.`,
    );
  }

  return {
    period,
    breakdown,
    source,
    propertyCount: properties.length,
    properties,
    notes,
    fetchedAt: new Date().toISOString(),
  };
}
