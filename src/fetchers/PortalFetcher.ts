// ─── Portal Service Fetcher ─────────────────────────────────
// HTTP client that proxies requests to portal-service for
// infrastructure observability: service health, container
// stats, metrics history, system info, and log snapshots.

import { createApiClient, type ApiClient } from "@rodrigo-barraza/utilities-library/http";
import CONFIG from "../config.ts";
import logger from "../logger.ts";

const REQUEST_TIMEOUT_MS = 15_000;
const LOG_SNAPSHOT_TIMEOUT_MS = 10_000;
const LOG_MAX_TAIL = 2000;
const LOG_DEFAULT_TAIL = 200;

function resolvePortalBaseUrl(): string {
  const baseUrl = CONFIG.PORTAL_SERVICE_URL;
  if (!baseUrl) {
    throw new Error("PORTAL_SERVICE_URL is not configured");
  }
  return baseUrl;
}

// Lazily created so an unconfigured PORTAL_SERVICE_URL throws at call time
// (not import time) and runtime CONFIG changes are picked up. The fetch
// wrapper defers to the current global fetch (honors test spies).
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

async function portalGet(path: string): Promise<unknown> {
  return portalClient().get(path);
}

export async function fetchServiceStatuses(refreshHealthChecks = false): Promise<unknown> {
  const queryString = refreshHealthChecks ? "?refresh=true" : "";
  return portalGet(`/services${queryString}`);
}

export async function fetchContainerStats(deviceId?: string): Promise<unknown> {
  const queryString = deviceId ? `?device=${encodeURIComponent(deviceId)}` : "";
  return portalGet(`/stats/containers${queryString}`);
}

export async function fetchContainerMetrics(options: {
  container?: string;
  device?: string;
  range?: string;
  limit?: number;
} = {}): Promise<unknown> {
  const queryParameters = new URLSearchParams();
  if (options.container) queryParameters.set("container", options.container);
  if (options.device) queryParameters.set("device", options.device);
  if (options.range) queryParameters.set("range", options.range);
  if (options.limit) queryParameters.set("limit", String(options.limit));

  const queryString = queryParameters.toString();
  return portalGet(`/stats/containers/metrics${queryString ? `?${queryString}` : ""}`);
}

export async function fetchContainerHistory(deviceId?: string): Promise<unknown> {
  const queryString = deviceId ? `?device=${encodeURIComponent(deviceId)}` : "";
  return portalGet(`/stats/containers/history${queryString}`);
}

export async function fetchSystemInfo(deviceId?: string): Promise<unknown> {
  const queryString = deviceId ? `?device=${encodeURIComponent(deviceId)}` : "";
  return portalGet(`/stats/system${queryString}`);
}

export async function fetchDevices(): Promise<unknown> {
  return portalGet("/devices");
}

export async function fetchContainerLogs(
  containerName: string,
  options: { device?: string; tail?: number; level?: string; search?: string; since?: string } = {},
): Promise<{
  container: string;
  lines: Array<{ line: string; stream: string }>;
  lineCount: number;
  truncated: boolean;
  meta?: { totalLines: number; emittedLines: number; filteredOutLines: number; level: string | null; search: string | null; since: string | null };
}> {
  const tailCount = Math.min(Math.max(options.tail || LOG_DEFAULT_TAIL, 1), LOG_MAX_TAIL);

  const queryParameters = new URLSearchParams({
    tail: String(tailCount),
    follow: "0",
  });
  if (options.device) queryParameters.set("device", options.device);
  if (options.level) queryParameters.set("level", options.level);
  if (options.search) queryParameters.set("search", options.search);
  if (options.since) queryParameters.set("since", options.since);

  try {
    // requestRaw: no throw on !ok, body left unconsumed for SSE streaming.
    const response = await portalClient().requestRaw(
      `/logs/${encodeURIComponent(containerName)}?${queryParameters.toString()}`,
      {
        headers: { Accept: "text/event-stream" },
        timeoutMilliseconds: LOG_SNAPSHOT_TIMEOUT_MS,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Portal logs API ${response.status}: ${errorBody || response.statusText}`);
    }

    const collectedLines: Array<{ line: string; stream: string }> = [];
    let filterMeta: { totalLines: number; emittedLines: number; filteredOutLines: number; level: string | null; search: string | null; since: string | null } | undefined;
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("No readable stream from portal logs endpoint");
    }

    const decoder = new TextDecoder();
    let accumulatedBuffer = "";

    const readTimeout = setTimeout(() => {
      reader.cancel().catch(() => {});
    }, LOG_SNAPSHOT_TIMEOUT_MS);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulatedBuffer += decoder.decode(value, { stream: true });
        const blocks = accumulatedBuffer.split("\n\n");
        accumulatedBuffer = blocks.pop() || "";

        for (const block of blocks) {
          const lines = block.split("\n");
          let eventType = "";
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataLines.push(line.slice(6));
            }
          }

          if (eventType === "meta") {
            try {
              filterMeta = JSON.parse(dataLines.join(""));
            } catch {
              // Ignore malformed meta events
            }
          } else if (eventType === "" && dataLines.length > 0) {
            for (const dataLine of dataLines) {
              try {
                const parsed = JSON.parse(dataLine);
                collectedLines.push({
                  line: parsed.line ?? dataLine,
                  stream: parsed.stream ?? "stdout",
                });
              } catch {
                // Portal must emit the JSON {line, stream} shape — drop malformed
                // data lines rather than coercing raw strings to stdout.
              }
            }
          } else if (eventType === "end" || eventType === "error") {
            reader.cancel().catch(() => {});
            clearTimeout(readTimeout);
            return {
              container: containerName,
              lines: collectedLines,
              lineCount: collectedLines.length,
              truncated: false,
              meta: filterMeta,
            };
          }
        }
      }
    } finally {
      clearTimeout(readTimeout);
    }

    return {
      container: containerName,
      lines: collectedLines,
      lineCount: collectedLines.length,
      truncated: collectedLines.length >= tailCount,
      meta: filterMeta,
    };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      logger.warn(`[PortalFetcher] Log snapshot timed out for ${containerName}`);
      throw new Error(`Log snapshot timed out for container: ${containerName}`, {
        cause: error,
      });
    }
    throw error;
  }
}

const ALL_CONTAINERS_TIMEOUT_MS = 20_000;
const ALL_CONTAINERS_MAX_CONCURRENCY = 10;

export async function fetchAllContainerLogs(
  options: { device?: string; tail?: number; level?: string; search?: string; since?: string } = {},
): Promise<{
  containers: string[];
  lines: Array<{ container: string; line: string; stream: string }>;
  lineCount: number;
  perContainer: Record<string, number>;
}> {
  const statsData = await fetchContainerStats(options.device) as Record<string, unknown>;
  const containerList = (statsData.containers || []) as Array<Record<string, unknown>>;

  const runningContainerNames = containerList
    .filter((container) => (container.state as string)?.toLowerCase() === "running")
    .map((container) => container.name as string)
    .filter(Boolean)
    .slice(0, ALL_CONTAINERS_MAX_CONCURRENCY);

  if (runningContainerNames.length === 0) {
    return { containers: [], lines: [], lineCount: 0, perContainer: {} };
  }

  const perContainerTail = Math.min(options.tail || LOG_DEFAULT_TAIL, LOG_MAX_TAIL);
  const overallController = new AbortController();
  const overallTimeout = setTimeout(() => overallController.abort(), ALL_CONTAINERS_TIMEOUT_MS);

  try {
    const logFetchResults = await Promise.allSettled(
      runningContainerNames.map((containerName) =>
        fetchContainerLogs(containerName, {
          ...options,
          tail: perContainerTail,
        }),
      ),
    );

    const aggregatedLines: Array<{ container: string; line: string; stream: string; timestamp: string }> = [];
    const perContainerCounts: Record<string, number> = {};
    const successfulContainerNames: string[] = [];

    for (let index = 0; index < logFetchResults.length; index++) {
      const result = logFetchResults[index];
      const containerName = runningContainerNames[index];

      if (result.status === "fulfilled") {
        successfulContainerNames.push(containerName);
        perContainerCounts[containerName] = result.value.lines.length;

        for (const logEntry of result.value.lines) {
          const extractedTimestamp = extractTimestamp(logEntry.line);
          aggregatedLines.push({
            container: containerName,
            line: logEntry.line,
            stream: logEntry.stream,
            timestamp: extractedTimestamp,
          });
        }
      } else {
        logger.warn(`[PortalFetcher] Skipped logs for ${containerName}: ${result.reason}`);
        perContainerCounts[containerName] = 0;
      }
    }

    aggregatedLines.sort((first, second) => first.timestamp.localeCompare(second.timestamp));

    return {
      containers: successfulContainerNames,
      lines: aggregatedLines.map(({ container, line, stream }) => ({ container, line, stream })),
      lineCount: aggregatedLines.length,
      perContainer: perContainerCounts,
    };
  } finally {
    clearTimeout(overallTimeout);
  }
}

function extractTimestamp(logLine: string): string {
  const isoTimestampMatch = logLine.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  if (isoTimestampMatch) return isoTimestampMatch[0];

  const bracketTimestampMatch = logLine.match(/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  if (bracketTimestampMatch) return bracketTimestampMatch[1];

  return "";
}

export function isPortalConfigured(): boolean {
  return Boolean(CONFIG.PORTAL_SERVICE_URL);
}
