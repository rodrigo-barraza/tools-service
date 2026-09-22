// ─── qBittorrent WebUI API Service ─────────────────────────
// HTTP client wrapping the qBittorrent Web API v2 for torrent
// search, download, and management via installed search plugins.
// ─────────────────────────────────────────────────────────────

import CONFIG from "../config.ts";
import logger from "../logger.ts";
import { errorMessage } from "../utilities.ts";
import { sleep } from "@rodrigo-barraza/utilities-library";

const LOG_PREFIX = "🧲 QBittorrent";

/** Session cookie (SID) cached across requests */
let sessionCookie: string | null = null;
let sessionExpiry = 0;

/** Auth failure cooldown — prevents rapid retries that trigger qBittorrent's IP ban */
let authFailedUntil = 0;
const AUTH_COOLDOWN_MS = 60_000; // 60s cooldown after auth failure

/** Session TTL — re-authenticate after 50 minutes (qBT default session is 60m) */
const SESSION_TTL_MS = 50 * 60 * 1000;

// ─── Internals ──────────────────────────────────────────────

function getBaseUrl(): string {
  return CONFIG.QBITTORRENT_URL?.replace(/\/+$/, "") || "";
}

/**
 * Authenticate with qBittorrent WebUI API.
 * Returns the SID session cookie for subsequent requests.
 *
 * Includes cooldown logic to prevent rapid retry loops that
 * trigger qBittorrent's brute-force IP ban mechanism.
 */
async function authenticate(): Promise<string> {
  const now = Date.now();

  // Return cached session if still valid
  if (sessionCookie && now < sessionExpiry) return sessionCookie;

  // Enforce cooldown after auth failures to prevent IP bans
  if (now < authFailedUntil) {
    const remainSec = Math.ceil((authFailedUntil - now) / 1000);
    throw new Error(
      `qBittorrent auth cooldown active (${remainSec}s remaining) — ` +
        `previous authentication failed. Check QBITTORRENT_USERNAME/PASSWORD in vault.`,
    );
  }

  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error("QBITTORRENT_URL not configured");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: CONFIG.QBITTORRENT_USERNAME || "admin",
        password: CONFIG.QBITTORRENT_PASSWORD || "",
      }),
    });
  } catch (error: unknown) {
    throw new Error(
      `qBittorrent unreachable at ${baseUrl}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  // Read body for all paths — qBittorrent sends descriptive text on errors
  const text = await response.text();

  // Detect IP ban (qBittorrent returns 403 with specific body text)
  if (response.status === 403 && text.includes("banned")) {
    authFailedUntil = now + AUTH_COOLDOWN_MS * 5; // 5 min cooldown when banned
    logger.error(
      `${LOG_PREFIX} — IP banned by qBittorrent. Backing off for 5 minutes.`,
    );
    throw new Error(
      `qBittorrent IP banned: ${text.trim()}. ` +
        `Restart qBittorrent or clear the ban list to unblock.`,
    );
  }

  if (!response.ok) {
    authFailedUntil = now + AUTH_COOLDOWN_MS;
    logger.error(
      `${LOG_PREFIX} — Auth failed (${response.status}). Cooldown for 60s.`,
    );
    throw new Error(
      `qBittorrent auth failed: ${response.status} ${response.statusText}. ` +
        `Check QBITTORRENT_USERNAME/PASSWORD configuration.`,
    );
  }

  // 200 "Ok." (legacy) or 204 (v5+) = success. Anything else = rejected.
  if (text.trim() !== "" && text.trim() !== "Ok.") {
    authFailedUntil = now + AUTH_COOLDOWN_MS;
    throw new Error(`qBittorrent auth rejected: ${text}`);
  }

  // Extract SID from Set-Cookie header
  // Legacy: SID=xxx — v5+: QBT_SID_<port>=xxx
  const setCookie = response.headers.get("set-cookie") || "";
  const sidMatch = setCookie.match(/((?:QBT_)?SID(?:_\d+)?=[^;]+)/);
  if (!sidMatch) {
    throw new Error("qBittorrent did not return SID cookie");
  }

  // Store the full cookie pair (e.g. "QBT_SID_8080=xxx" or "SID=xxx")
  sessionCookie = sidMatch[1];
  sessionExpiry = now + SESSION_TTL_MS;
  authFailedUntil = 0; // Clear cooldown on success
  logger.info(`${LOG_PREFIX} — Authenticated (session valid for 50m)`);
  return sessionCookie;
}

interface QbtFetchOptions {
  method?: string;
  body?: Record<string, string> | URLSearchParams;
  params?: Record<string, string>;
}

/**
 * Make an authenticated request to the qBittorrent API.
 * Automatically re-authenticates once on 403 (session expired),
 * but backs off on IP bans rather than hammering the endpoint.
 */
async function qbtFetch(
  path: string,
  { method = "GET", body, params }: QbtFetchOptions = {},
): Promise<unknown> {
  const sid = await authenticate();
  const baseUrl = getBaseUrl();

  let url = `${baseUrl}${path}`;
  if (params) {
    const queryString = new URLSearchParams(params).toString();
    if (queryString) url += `?${queryString}`;
  }

  const headers: Record<string, string> = { Cookie: sid };

  const options: RequestInit = { method, headers };

  if (body && method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body =
      body instanceof URLSearchParams ? body : new URLSearchParams(body);
  }

  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error: unknown) {
    throw new Error(
      `qBittorrent unreachable at ${baseUrl}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  // Session expired — check for ban first, then re-auth once
  if (response.status === 403) {
    const banText = await response.text();
    if (banText.includes("banned")) {
      authFailedUntil = Date.now() + AUTH_COOLDOWN_MS * 5;
      logger.error(`${LOG_PREFIX} — IP banned during API call. Backing off.`);
      throw new Error(`qBittorrent IP banned: ${banText.trim()}`);
    }

    // Genuine session expiry — re-authenticate
    sessionCookie = null;
    sessionExpiry = 0;
    const newSid = await authenticate();
    headers.Cookie = newSid;
    const retry = await fetch(url, { ...options, headers });
    if (!retry.ok) {
      throw new Error(
        `qBittorrent API error: ${retry.status} ${retry.statusText}`,
      );
    }
    const contentType = retry.headers.get("content-type") || "";
    return contentType.includes("json") ? retry.json() : retry.text();
  }

  if (!response.ok) {
    throw new Error(
      `qBittorrent API error: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("json") ? response.json() : response.text();
}

/**
 * Clear cached auth state and cooldown timers.
 * Used by admin endpoints to reset after fixing credentials.
 */
export function clearAuthState(): void {
  sessionCookie = null;
  sessionExpiry = 0;
  authFailedUntil = 0;
  logger.info(`${LOG_PREFIX} — Auth state cleared`);
}

// ─── qBittorrent API Response Types ─────────────────────────

interface QbtSearchStartResult {
  id: number;
}

interface QbtSearchStatus {
  id: number;
  status: string;
}

interface QbtSearchResultItem {
  fileName: string;
  fileSize: number;
  nbSeeders: number;
  nbLeechers: number;
  fileUrl: string;
  siteUrl: string;
  descrLink: string;
  pubDate?: number;
}

interface QbtSearchResults {
  total: number;
  results: QbtSearchResultItem[];
}

interface QbtPlugin {
  name: string;
  fullName: string;
  url: string;
  enabled: boolean;
  version: string;
  supportedCategories: Array<{ name: string }>;
}

interface QbtTorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number;
  state: string;
  "num_seeds": number;
  "num_leechs": number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  category: string;
  tags: string;
  added_on: number;
  save_path: string;
  ratio: number;
  amount_left: number;
  downloaded: number;
  uploaded: number;
}

interface AddTorrentOptions {
  savePath?: string;
  category?: string;
  tags?: string;
  paused?: boolean;
  sequentialDownload?: boolean;
  firstLastPiece?: boolean;
}

interface ListTorrentsOptions {
  filter?: string;
  category?: string;
  tag?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

interface SearchOptions {
  plugins?: string;
  category?: string;
  limit?: number;
  timeoutMs?: number;
}

// ─── Response Normalizers ───────────────────────────────────

function formatTorrentStatusList(torrents: unknown) {
  const torrentList = Array.isArray(torrents) ? torrents : [];
  return torrentList.map((torrent: QbtTorrentInfo) => ({
    hash: torrent.hash,
    name: torrent.name,
    size: torrent.size,
    progress: Math.round(torrent.progress * 100),
    state: torrent.state,
    seeds: torrent["num_seeds"],
    leech: torrent["num_leechs"],
    downloadSpeed: torrent.dlspeed,
    uploadSpeed: torrent.upspeed,
    eta: torrent.eta,
    category: torrent.category,
    tags: torrent.tags,
    addedOn: new Date(torrent.added_on * 1000).toISOString(),
    savePath: torrent.save_path,
    ratio: torrent.ratio,
    amountLeft: torrent.amount_left,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
  }));
}

function formatPluginList(plugins: unknown) {
  const pluginList = Array.isArray(plugins) ? plugins : [];
  return pluginList.map((plugin: QbtPlugin) => ({
    name: plugin.name,
    fullName: plugin.fullName,
    url: plugin.url,
    enabled: plugin.enabled,
    version: plugin.version,
    supportedCategories:
      plugin.supportedCategories?.map((item) => item.name) || [],
  }));
}

// ─── Search API ─────────────────────────────────────────────

/**
 * Start a torrent search across installed plugins.
 */
export async function startSearch(
  pattern: string,
  plugins = "enabled",
  category = "all",
): Promise<QbtSearchStartResult> {
  const result = (await qbtFetch("/api/v2/search/start", {
    method: "POST",
    body: { pattern, plugins, category },
  })) as QbtSearchStartResult;
  logger.info(
    `${LOG_PREFIX} — Search started: "${pattern}" → job ${result?.id}`,
  );
  return result;
}

/**
 * Get the status of a search job.
 */
export async function getSearchStatus(id: number): Promise<QbtSearchStatus[]> {
  return qbtFetch("/api/v2/search/status", {
    method: "POST",
    body: { id: String(id) },
  }) as Promise<QbtSearchStatus[]>;
}

/**
 * Get search results.
 */
export async function getSearchResults(
  id: number,
  limit = 50,
  offset = 0,
): Promise<QbtSearchResults> {
  return qbtFetch("/api/v2/search/results", {
    method: "POST",
    body: { id: String(id), limit: String(limit), offset: String(offset) },
  }) as Promise<QbtSearchResults>;
}

/**
 * Stop a running search.
 */
export async function stopSearch(id: number): Promise<void> {
  await qbtFetch("/api/v2/search/stop", {
    method: "POST",
    body: { id: String(id) },
  });
}

/**
 * Delete a search job and free resources.
 */
export async function deleteSearch(id: number): Promise<void> {
  await qbtFetch("/api/v2/search/delete", {
    method: "POST",
    body: { id: String(id) },
  });
}

/**
 * Run a complete search lifecycle: start → poll → get results → cleanup.
 * This is the primary method used by the route handler.
 */
export async function search(
  pattern: string,
  {
    plugins = "enabled",
    category = "all",
    limit = 50,
    timeoutMs = 30000,
  }: SearchOptions = {},
) {
  const { id } = await startSearch(pattern, plugins, category);
  const deadline = Date.now() + timeoutMs;

  // Poll until complete or timeout
  let status = "Running";
  while (status === "Running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const statusResponse = await getSearchStatus(id);
    // statusRes is an array of search statuses
    const job = Array.isArray(statusResponse)
      ? statusResponse.find((s) => s.id === id)
      : statusResponse;
    status = job?.status || "Stopped";
  }

  // Fetch results
  const results = await getSearchResults(id, limit, 0);

  // Cleanup
  try {
    await deleteSearch(id);
  } catch {
    // Ignore cleanup errors
  }

  return {
    query: pattern,
    category,
    plugins,
    totalResults: results?.total || 0,
    results: (results?.results || []).map((r) => ({
      name: r.fileName,
      size: r.fileSize,
      seeds: r.nbSeeders,
      leech: r.nbLeechers,
      link: r.fileUrl,
      siteUrl: r.siteUrl,
      descriptionUrl: r.descrLink,
      publishDate: r.pubDate ? new Date(r.pubDate * 1000).toISOString() : null,
    })),
  };
}

// ─── Plugin Management ──────────────────────────────────────

export async function getPlugins() {
  const plugins = (await qbtFetch("/api/v2/search/plugins")) as QbtPlugin[];
  return formatPluginList(plugins);
}

export async function installPlugin(sources: string) {
  await qbtFetch("/api/v2/search/installPlugin", {
    method: "POST",
    body: { sources },
  });
  logger.info(`${LOG_PREFIX} — Plugin installed from: ${sources}`);
  return getPlugins();
}

export async function enablePlugin(names: string, enable = true) {
  await qbtFetch("/api/v2/search/enablePlugin", {
    method: "POST",
    body: { names, enable: String(enable) },
  });
  return getPlugins();
}

export async function updatePlugins() {
  await qbtFetch("/api/v2/search/updatePlugins", { method: "POST" });
  return getPlugins();
}

export async function addTorrent(
  urls: string,
  options: AddTorrentOptions = {},
) {
  const body: Record<string, string> = { urls: urls.replace(/\|/g, "\n") };
  if (options.savePath) body.savepath = options.savePath;
  if (options.category) body.category = options.category;
  if (options.tags) body.tags = options.tags;
  if (options.paused !== undefined) body.paused = String(options.paused);
  if (options.sequentialDownload) body.sequentialDownload = "true";
  if (options.firstLastPiece) body.firstLastPiecePrio = "true";

  await qbtFetch("/api/v2/torrents/add", {
    method: "POST",
    body,
  });
  logger.info(`${LOG_PREFIX} — Torrent added: ${urls.slice(0, 80)}...`);

  // Brief delay for magnet metadata resolution before re-fetching
  await sleep(500);
  return listTorrents();
}

export async function listTorrents(options: ListTorrentsOptions = {}) {
  const params: Record<string, string> = {};
  if (options.filter) params.filter = options.filter;
  if (options.category) params.category = options.category;
  if (options.tag) params.tag = options.tag;
  if (options.sort) params.sort = options.sort;
  if (options.limit) params.limit = String(options.limit);
  if (options.offset) params.offset = String(options.offset);

  const torrents = (await qbtFetch("/api/v2/torrents/info", {
    params,
  })) as QbtTorrentInfo[];
  return formatTorrentStatusList(torrents);
}

export async function pauseTorrents(hashes = "all") {
  await qbtFetch("/api/v2/torrents/pause", {
    method: "POST",
    body: { hashes },
  });
  return listTorrents();
}

export async function resumeTorrents(hashes = "all") {
  await qbtFetch("/api/v2/torrents/resume", {
    method: "POST",
    body: { hashes },
  });
  return listTorrents();
}

export async function deleteTorrents(hashes: string, deleteFiles = false) {
  await qbtFetch("/api/v2/torrents/delete", {
    method: "POST",
    body: { hashes, deleteFiles: String(deleteFiles) },
  });
  return listTorrents();
}

/**
 * Get global transfer info (speeds, session stats).
 */
export async function getTransferInfo(): Promise<unknown> {
  return qbtFetch("/api/v2/transfer/info");
}

// ─── Health Check ───────────────────────────────────────────

/**
 * Check if qBittorrent is reachable and authenticated.
 */
export async function isHealthy(): Promise<{
  healthy: boolean;
  version?: string;
}> {
  try {
    if (!getBaseUrl()) return { healthy: false };
    await authenticate();
    const version = (await qbtFetch("/api/v2/app/version")) as string;
    return { healthy: true, version };
  } catch {
    return { healthy: false };
  }
}
