// ─── Spotify Web API Fetcher ──────────────────────────────────────
//
// Two auth tiers:
//  • Client-credentials — catalog search & metadata (search_spotify,
//    catalog actions of get_spotify). Works with just app credentials.
//  • User OAuth (authorization-code) — playback control and personal
//    library (control_spotify, user actions of get_spotify). Requires
//    a one-time browser authorization at /music/spotify/auth/login;
//    the refresh token is persisted in Mongo and renewed silently.

import { randomBytes } from "node:crypto";
import { TokenManager } from "@rodrigo-barraza/utilities-library/node";
import { getDatabase } from "@rodrigo-barraza/utilities-library/service/mongo";
import CONFIG from "../../config.ts";
import { errorMessage } from "../../utilities.ts";
import rateLimiter from "../../services/RateLimiterService.ts";
import logger from "../../logger.ts";

const ACCOUNTS_URL = "https://accounts.spotify.com";
const API_URL = "https://api.spotify.com/v1";
const AUTH_COLLECTION = "spotify_auth";
const AUTH_DOC_ID = "default";
const DEFAULT_MARKET = "CA";

const OAUTH_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-top-read",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

function basicAuthHeader(): string {
  const credentials = Buffer.from(
    `${CONFIG.SPOTIFY_CLIENT_ID}:${CONFIG.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
  return `Basic ${credentials}`;
}

function credentialsConfigured(): boolean {
  return Boolean(CONFIG.SPOTIFY_CLIENT_ID && CONFIG.SPOTIFY_CLIENT_SECRET);
}

export function spotifyRedirectUri(): string {
  if (CONFIG.SPOTIFY_REDIRECT_URI) return CONFIG.SPOTIFY_REDIRECT_URI;
  const base = CONFIG.TOOLS_SERVICE_PUBLIC_URL || CONFIG.TOOLS_SERVICE_URL;
  return `${base}/music/spotify/auth/callback`;
}

// ─── App Token (client credentials) ───────────────────────────────

const appTokenManager = new TokenManager(async () => {
  const response = await fetch(`${ACCOUNTS_URL}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new Error(`Spotify OAuth failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    token: data.access_token,
    // Refresh a minute before Spotify's expiry (typically 3600s)
    expiresInMilliseconds: Math.max((data.expires_in ?? 3600) - 60, 60) * 1000,
  };
});

// ─── User Token (authorization code + persisted refresh token) ────

interface SpotifyAuthDocument {
  _id: string;
  refreshToken: string;
  scope: string | null;
  account: { id: string; displayName: string | null; product: string | null } | null;
  updatedAt: Date;
}

async function readAuthDocument(): Promise<SpotifyAuthDocument | null> {
  try {
    const collection = getDatabase().collection<SpotifyAuthDocument>(AUTH_COLLECTION);
    return await collection.findOne({ _id: AUTH_DOC_ID });
  } catch {
    return null; // DB not connected — treat as unauthorized
  }
}

async function writeAuthDocument(
  document: Omit<SpotifyAuthDocument, "_id" | "updatedAt">,
): Promise<void> {
  const collection = getDatabase().collection<SpotifyAuthDocument>(AUTH_COLLECTION);
  await collection.updateOne(
    { _id: AUTH_DOC_ID },
    { $set: { ...document, updatedAt: new Date() } },
    { upsert: true },
  );
}

class SpotifyNotAuthorizedError extends Error {}

const userTokenManager = new TokenManager(async () => {
  const stored = await readAuthDocument();
  if (!stored?.refreshToken) {
    throw new SpotifyNotAuthorizedError(
      `Spotify account not connected. Authorize once at ${spotifyRedirectUri().replace("/callback", "/login")}`,
    );
  }
  const response = await fetch(`${ACCOUNTS_URL}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }).toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token refresh failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  // Spotify occasionally rotates the refresh token — persist the new one
  if (data.refresh_token && data.refresh_token !== stored.refreshToken) {
    await writeAuthDocument({ ...stored, refreshToken: data.refresh_token }).catch((error) =>
      logger.warn(`[Spotify] failed to persist rotated refresh token: ${errorMessage(error)}`),
    );
  }
  return {
    token: data.access_token,
    // Refresh a minute before Spotify's expiry (typically 3600s)
    expiresInMilliseconds: Math.max((data.expires_in ?? 3600) - 60, 60) * 1000,
  };
});

// ─── OAuth Flow (login / callback / status) ────────────────────────

const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

export function buildAuthorizeUrl(): { url: string } | { error: string } {
  if (!credentialsConfigured()) {
    return { error: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not configured" };
  }
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  for (const [key, createdAt] of pendingStates) {
    if (Date.now() - createdAt > STATE_TTL_MS) pendingStates.delete(key);
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CONFIG.SPOTIFY_CLIENT_ID as string,
    scope: OAUTH_SCOPES,
    redirect_uri: spotifyRedirectUri(),
    state,
  });
  return { url: `${ACCOUNTS_URL}/authorize?${params}` };
}

export async function handleAuthCallback(
  code: string,
  state: string,
): Promise<{ account: string | null } | { error: string }> {
  if (!pendingStates.has(state)) {
    return { error: "Invalid or expired OAuth state — restart at /music/spotify/auth/login" };
  }
  pendingStates.delete(state);
  try {
    const response = await fetch(`${ACCOUNTS_URL}/api/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: spotifyRedirectUri(),
      }).toString(),
    });
    if (!response.ok) {
      const text = await response.text();
      return { error: `Spotify code exchange failed (${response.status}): ${text.slice(0, 200)}` };
    }
    const data = await response.json();
    if (!data.refresh_token) {
      return { error: "Spotify did not return a refresh token" };
    }

    // Identify the account so status/health can show who is connected
    let account: SpotifyAuthDocument["account"] = null;
    const profileResponse = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      account = {
        id: profile.id,
        displayName: profile.display_name ?? null,
        product: profile.product ?? null,
      };
    }

    await writeAuthDocument({
      refreshToken: data.refresh_token,
      scope: data.scope ?? null,
      account,
    });
    // Drop any previously cached token; the next user-tier request will
    // refresh against the newly persisted refresh token.
    userTokenManager.invalidate();
    logger.info(`[Spotify] account connected: ${account?.displayName ?? account?.id ?? "unknown"}`);
    return { account: account?.displayName ?? account?.id ?? null };
  } catch (error: unknown) {
    return { error: `Spotify authorization failed: ${errorMessage(error)}` };
  }
}

export async function getAuthStatus() {
  const stored = await readAuthDocument();
  return {
    configured: credentialsConfigured(),
    authorized: Boolean(stored?.refreshToken),
    account: stored?.account ?? null,
    scope: stored?.scope ?? null,
    authorizedAt: stored?.updatedAt ?? null,
    loginUrl: spotifyRedirectUri().replace("/callback", "/login"),
  };
}

// ─── Shared Request Helper ─────────────────────────────────────────

type TokenTier = "app" | "user";

async function spotifyRequest(
  path: string,
  {
    tier = "app",
    method = "GET",
    query,
    body,
  }: {
    tier?: TokenTier;
    method?: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
  } = {},
): Promise<{ status: number; data: any }> {
  await rateLimiter.wait("SPOTIFY");
  const token = tier === "user" ? await userTokenManager.getToken() : await appTokenManager.getToken();
  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return { status: response.status, data: null };
  }
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: response.status, data };
}

function apiError(status: number, data: any): string {
  const message = data?.error?.message || data?.error_description || data?.raw || "unknown error";
  return `Spotify API ${status}: ${message}`;
}

// ─── ID / URI Normalization (pure — unit tested) ──────────────────

const SPOTIFY_ID_TYPES = new Set([
  "track", "artist", "album", "playlist", "show", "episode", "audiobook",
]);

/**
 * Accept a bare ID, a spotify:<type>:<id> URI, or an open.spotify.com
 * URL and normalize to { type, id }. Bare IDs use `fallbackType`.
 */
export function parseSpotifyId(
  input: string,
  fallbackType?: string,
): { type: string | null; id: string } | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;

  const uriMatch = trimmed.match(/^spotify:([a-z]+):([A-Za-z0-9]+)$/);
  if (uriMatch) {
    const [, type, id] = uriMatch;
    return SPOTIFY_ID_TYPES.has(type!) ? { type: type!, id: id! } : null;
  }

  if (trimmed.includes("open.spotify.com")) {
    const urlMatch = trimmed.match(
      /open\.spotify\.com\/(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/,
    );
    if (!urlMatch) return null;
    const [, type, id] = urlMatch;
    return SPOTIFY_ID_TYPES.has(type!) ? { type: type!, id: id! } : null;
  }

  if (/^[A-Za-z0-9]{15,30}$/.test(trimmed)) {
    return { type: fallbackType ?? null, id: trimmed };
  }
  return null;
}

export function toSpotifyUri(input: string, fallbackType: string): string | null {
  const parsed = parseSpotifyId(input, fallbackType);
  if (!parsed) return null;
  return `spotify:${parsed.type ?? fallbackType}:${parsed.id}`;
}

// ─── Result Mappers (pure — unit tested) ──────────────────────────

export function mapTrack(track: any) {
  if (!track) return null;
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: (track.artists ?? []).map((artist: any) => artist.name),
    album: track.album?.name ?? null,
    releaseDate: track.album?.release_date ?? null,
    durationMs: track.duration_ms ?? null,
    explicit: track.explicit ?? false,
    popularity: track.popularity ?? null,
    previewUrl: track.preview_url ?? null,
    url: track.external_urls?.spotify ?? null,
    imageUrl: track.album?.images?.[0]?.url ?? null,
  };
}

export function mapArtist(artist: any) {
  if (!artist) return null;
  return {
    id: artist.id,
    uri: artist.uri,
    name: artist.name,
    genres: artist.genres ?? [],
    followers: artist.followers?.total ?? null,
    popularity: artist.popularity ?? null,
    url: artist.external_urls?.spotify ?? null,
    imageUrl: artist.images?.[0]?.url ?? null,
  };
}

export function mapAlbum(album: any) {
  if (!album) return null;
  return {
    id: album.id,
    uri: album.uri,
    name: album.name,
    albumType: album.album_type ?? null,
    artists: (album.artists ?? []).map((artist: any) => artist.name),
    releaseDate: album.release_date ?? null,
    totalTracks: album.total_tracks ?? null,
    url: album.external_urls?.spotify ?? null,
    imageUrl: album.images?.[0]?.url ?? null,
  };
}

export function mapPlaylist(playlist: any) {
  if (!playlist) return null;
  return {
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    description: playlist.description || null,
    owner: playlist.owner?.display_name ?? playlist.owner?.id ?? null,
    totalTracks: playlist.tracks?.total ?? null,
    public: playlist.public ?? null,
    url: playlist.external_urls?.spotify ?? null,
    imageUrl: playlist.images?.[0]?.url ?? null,
  };
}

export function mapShow(show: any) {
  if (!show) return null;
  return {
    id: show.id,
    uri: show.uri,
    name: show.name,
    publisher: show.publisher ?? null,
    description: show.description?.slice(0, 300) ?? null,
    totalEpisodes: show.total_episodes ?? null,
    url: show.external_urls?.spotify ?? null,
    imageUrl: show.images?.[0]?.url ?? null,
  };
}

export function mapEpisode(episode: any) {
  if (!episode) return null;
  return {
    id: episode.id,
    uri: episode.uri,
    name: episode.name,
    show: episode.show?.name ?? null,
    releaseDate: episode.release_date ?? null,
    durationMs: episode.duration_ms ?? null,
    description: episode.description?.slice(0, 300) ?? null,
    url: episode.external_urls?.spotify ?? null,
    imageUrl: episode.images?.[0]?.url ?? null,
  };
}

function mapDevice(device: any) {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    isActive: device.is_active ?? false,
    volumePercent: device.volume_percent ?? null,
  };
}

function mapNowPlaying(data: any) {
  if (!data?.item) return { playing: false, track: null };
  const isEpisode = data.currently_playing_type === "episode";
  return {
    playing: data.is_playing ?? false,
    progressMs: data.progress_ms ?? null,
    shuffle: data.shuffle_state ?? null,
    repeat: data.repeat_state ?? null,
    device: data.device ? mapDevice(data.device) : null,
    track: isEpisode ? mapEpisode(data.item) : mapTrack(data.item),
  };
}

// ─── Catalog Search ────────────────────────────────────────────────

const SEARCH_TYPES = new Set([
  "track", "artist", "album", "playlist", "show", "episode", "audiobook",
]);

export interface SpotifySearchOptions {
  type?: string;
  limit?: number;
  market?: string;
}

export async function searchSpotify(
  query: string,
  { type = "track", limit = 10, market = DEFAULT_MARKET }: SpotifySearchOptions = {},
): Promise<object | { error: string }> {
  if (!credentialsConfigured()) {
    return { error: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not configured" };
  }
  const trimmed = query.trim();
  if (!trimmed) return { error: "Query is required" };
  if (!SEARCH_TYPES.has(type)) {
    return { error: `Unknown type '${type}'. Use one of: ${[...SEARCH_TYPES].join(", ")}` };
  }
  try {
    const { status, data } = await spotifyRequest("/search", {
      query: {
        "q": trimmed,
        type,
        market,
        limit: String(Math.min(Math.max(limit, 1), 50)),
      },
    });
    if (status !== 200) return { error: apiError(status, data) };

    const buckets: Record<string, { key: string; map: (item: any) => any }> = {
      track: { key: "tracks", map: mapTrack },
      artist: { key: "artists", map: mapArtist },
      album: { key: "albums", map: mapAlbum },
      playlist: { key: "playlists", map: mapPlaylist },
      show: { key: "shows", map: mapShow },
      episode: { key: "episodes", map: mapEpisode },
      audiobook: { key: "audiobooks", map: mapShow },
    };
    const bucket = buckets[type]!;
    const page = data?.[bucket.key];
    return {
      query: trimmed,
      type,
      market,
      total: page?.total ?? 0,
      results: (page?.items ?? []).filter(Boolean).map(bucket.map).filter(Boolean),
    };
  } catch (error: unknown) {
    return { error: `Spotify search failed: ${errorMessage(error)}` };
  }
}

// ─── Catalog & Library Reads (get_spotify) ────────────────────────

export interface SpotifyGetOptions {
  id?: string;
  limit?: number;
  market?: string;
  timeRange?: string;
}

const CATALOG_ACTIONS = new Set([
  "track", "album", "artist", "artist_top_tracks", "artist_albums",
  "playlist", "new_releases",
]);
const USER_ACTIONS = new Set([
  "now_playing", "devices", "queue", "recently_played",
  "my_playlists", "saved_tracks", "top_tracks", "top_artists",
]);

export async function getSpotify(
  action: string,
  { id, limit = 20, market = DEFAULT_MARKET, timeRange = "medium_term" }: SpotifyGetOptions = {},
): Promise<object | { error: string }> {
  if (!credentialsConfigured()) {
    return { error: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not configured" };
  }
  if (!CATALOG_ACTIONS.has(action) && !USER_ACTIONS.has(action)) {
    return {
      error: `Unknown action '${action}'. Use one of: ${[...CATALOG_ACTIONS, ...USER_ACTIONS].join(", ")}`,
    };
  }

  const needsId = ["track", "album", "artist", "artist_top_tracks", "artist_albums", "playlist"];
  let parsedId: string | null = null;
  if (needsId.includes(action)) {
    if (!id) return { error: `Action '${action}' requires 'id' (Spotify ID, URI, or URL)` };
    const parsed = parseSpotifyId(id, action.startsWith("artist") ? "artist" : action);
    if (!parsed) return { error: `Could not parse Spotify id '${id}'` };
    parsedId = parsed.id;
  }

  const boundedLimit = String(Math.min(Math.max(limit, 1), 50));
  const tier: TokenTier = USER_ACTIONS.has(action) ? "user" : "app";

  try {
    let path = "";
    let query: Record<string, string | undefined> = {};
    switch (action) {
      case "track": path = `/tracks/${parsedId}`; query = { market }; break;
      case "album": path = `/albums/${parsedId}`; query = { market }; break;
      case "artist": path = `/artists/${parsedId}`; break;
      case "artist_top_tracks": path = `/artists/${parsedId}/top-tracks`; query = { market }; break;
      case "artist_albums":
        path = `/artists/${parsedId}/albums`;
        query = { market, limit: boundedLimit, include_groups: "album,single,compilation" };
        break;
      case "playlist": path = `/playlists/${parsedId}`; query = { market }; break;
      case "new_releases": path = "/browse/new-releases"; query = { country: market, limit: boundedLimit }; break;
      case "now_playing": path = "/me/player"; query = { additional_types: "track,episode" }; break;
      case "devices": path = "/me/player/devices"; break;
      case "queue": path = "/me/player/queue"; break;
      case "recently_played": path = "/me/player/recently-played"; query = { limit: boundedLimit }; break;
      case "my_playlists": path = "/me/playlists"; query = { limit: boundedLimit }; break;
      case "saved_tracks": path = "/me/tracks"; query = { limit: boundedLimit }; break;
      case "top_tracks": path = "/me/top/tracks"; query = { limit: boundedLimit, time_range: timeRange }; break;
      case "top_artists": path = "/me/top/artists"; query = { limit: boundedLimit, time_range: timeRange }; break;
    }

    const { status, data } = await spotifyRequest(path, { tier, query });
    if (status === 200 && data === null && action === "now_playing") {
      return { playing: false, track: null, note: "Nothing playing and no active device" };
    }
    if (status !== 200) return { error: apiError(status, data) };

    switch (action) {
      case "track": return { track: mapTrack(data) };
      case "album":
        return {
          album: mapAlbum(data),
          tracks: (data.tracks?.items ?? []).map(mapTrack).filter(Boolean),
        };
      case "artist": return { artist: mapArtist(data) };
      case "artist_top_tracks": return { tracks: (data.tracks ?? []).map(mapTrack).filter(Boolean) };
      case "artist_albums": return { albums: (data.items ?? []).map(mapAlbum).filter(Boolean) };
      case "playlist":
        return {
          playlist: mapPlaylist(data),
          tracks: (data.tracks?.items ?? [])
            .map((entry: any) => mapTrack(entry?.track))
            .filter(Boolean)
            .slice(0, Number(boundedLimit)),
        };
      case "new_releases": return { albums: (data.albums?.items ?? []).map(mapAlbum).filter(Boolean) };
      case "now_playing": return mapNowPlaying(data);
      case "devices": return { devices: (data.devices ?? []).map(mapDevice) };
      case "queue":
        return {
          nowPlaying: mapTrack(data.currently_playing),
          queue: (data.queue ?? []).map(mapTrack).filter(Boolean),
        };
      case "recently_played":
        return {
          tracks: (data.items ?? [])
            .map((entry: any) => ({ ...mapTrack(entry?.track), playedAt: entry?.played_at ?? null }))
            .filter((track: any) => track?.id),
        };
      case "my_playlists": return { playlists: (data.items ?? []).map(mapPlaylist).filter(Boolean) };
      case "saved_tracks":
        return {
          tracks: (data.items ?? [])
            .map((entry: any) => ({ ...mapTrack(entry?.track), savedAt: entry?.added_at ?? null }))
            .filter((track: any) => track?.id),
        };
      case "top_tracks": return { timeRange, tracks: (data.items ?? []).map(mapTrack).filter(Boolean) };
      case "top_artists": return { timeRange, artists: (data.items ?? []).map(mapArtist).filter(Boolean) };
    }
    return { error: `Unhandled action '${action}'` };
  } catch (error: unknown) {
    if (error instanceof SpotifyNotAuthorizedError) return { error: error.message };
    return { error: `Spotify request failed: ${errorMessage(error)}` };
  }
}

// ─── Playback Control (control_spotify) ───────────────────────────

export interface SpotifyControlOptions {
  query?: string;
  uri?: string;
  id?: string;
  deviceId?: string;
  percent?: number;
  mode?: string;
  enabled?: boolean;
  positionMs?: number;
}

const CONTROL_ACTIONS = new Set([
  "play", "pause", "next", "previous", "queue", "shuffle", "repeat",
  "volume", "transfer", "seek", "save_track", "unsave_track",
]);

/** Resolve the target device: explicit > active > first available. */
async function resolveDeviceId(explicit?: string): Promise<string | { error: string }> {
  if (explicit) return explicit;
  const { status, data } = await spotifyRequest("/me/player/devices", { tier: "user" });
  if (status !== 200) return { error: apiError(status, data) };
  const devices: any[] = data?.devices ?? [];
  if (!devices.length) {
    return { error: "No Spotify devices online — open Spotify on a phone, computer, or speaker first" };
  }
  const active = devices.find((device) => device.is_active);
  return (active ?? devices[0]).id as string;
}

export async function controlSpotify(
  action: string,
  options: SpotifyControlOptions = {},
): Promise<object | { error: string }> {
  if (!credentialsConfigured()) {
    return { error: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not configured" };
  }
  if (!CONTROL_ACTIONS.has(action)) {
    return { error: `Unknown action '${action}'. Use one of: ${[...CONTROL_ACTIONS].join(", ")}` };
  }

  try {
    switch (action) {
      case "play": {
        let contextUri: string | undefined;
        let trackUris: string[] | undefined;
        let played: any = null;

        if (options.uri) {
          const parsed = parseSpotifyId(options.uri, "track");
          if (!parsed) return { error: `Could not parse Spotify uri/id/url '${options.uri}'` };
          const type = parsed.type ?? "track";
          if (type === "track" || type === "episode") {
            trackUris = [`spotify:${type}:${parsed.id}`];
          } else {
            contextUri = `spotify:${type}:${parsed.id}`;
          }
        } else if (options.query) {
          const found = await searchSpotify(options.query, { limit: 1 });
          if ("error" in found) return found;
          const first = (found as any).results?.[0];
          if (!first) return { error: `No Spotify track found for '${options.query}'` };
          trackUris = [first.uri];
          played = first;
        }
        // Neither uri nor query → resume current playback

        const deviceId = await resolveDeviceId(options.deviceId);
        if (typeof deviceId !== "string") return deviceId;

        const body: Record<string, unknown> = {};
        if (contextUri) body["context_uri"] = contextUri;
        if (trackUris) body["uris"] = trackUris;
        if (options.positionMs !== undefined) body["position_ms"] = options.positionMs;

        const { status, data } = await spotifyRequest("/me/player/play", {
          tier: "user",
          method: "PUT",
          query: { device_id: deviceId },
          body: Object.keys(body).length ? body : undefined,
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "play", ok: true, ...(played ? { track: played } : {}) };
      }

      case "pause":
      case "next":
      case "previous": {
        const paths: Record<string, { path: string; method: string }> = {
          pause: { path: "/me/player/pause", method: "PUT" },
          next: { path: "/me/player/next", method: "POST" },
          previous: { path: "/me/player/previous", method: "POST" },
        };
        const target = paths[action]!;
        const { status, data } = await spotifyRequest(target.path, {
          tier: "user",
          method: target.method,
          query: options.deviceId ? { device_id: options.deviceId } : undefined,
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action, ok: true };
      }

      case "queue": {
        let uri: string | null = null;
        let queued: any = null;
        if (options.uri) {
          uri = toSpotifyUri(options.uri, "track");
          if (!uri) return { error: `Could not parse Spotify uri/id/url '${options.uri}'` };
        } else if (options.query) {
          const found = await searchSpotify(options.query, { limit: 1 });
          if ("error" in found) return found;
          const first = (found as any).results?.[0];
          if (!first) return { error: `No Spotify track found for '${options.query}'` };
          uri = first.uri;
          queued = first;
        } else {
          return { error: "Action 'queue' requires 'uri' or 'query'" };
        }
        const { status, data } = await spotifyRequest("/me/player/queue", {
          tier: "user",
          method: "POST",
          query: { uri: uri as string, ...(options.deviceId ? { device_id: options.deviceId } : {}) },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "queue", ok: true, ...(queued ? { track: queued } : {}) };
      }

      case "shuffle": {
        const { status, data } = await spotifyRequest("/me/player/shuffle", {
          tier: "user",
          method: "PUT",
          query: { state: String(options.enabled ?? true) },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "shuffle", ok: true, enabled: options.enabled ?? true };
      }

      case "repeat": {
        const mode = options.mode ?? "context";
        if (!["off", "track", "context"].includes(mode)) {
          return { error: `Repeat mode must be off, track, or context (got '${mode}')` };
        }
        const { status, data } = await spotifyRequest("/me/player/repeat", {
          tier: "user",
          method: "PUT",
          query: { state: mode },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "repeat", ok: true, mode };
      }

      case "volume": {
        if (options.percent === undefined) {
          return { error: "Action 'volume' requires 'percent' (0-100)" };
        }
        const percent = Math.min(Math.max(Math.round(options.percent), 0), 100);
        const { status, data } = await spotifyRequest("/me/player/volume", {
          tier: "user",
          method: "PUT",
          query: { volume_percent: String(percent) },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "volume", ok: true, percent };
      }

      case "seek": {
        if (options.positionMs === undefined) {
          return { error: "Action 'seek' requires 'positionMs'" };
        }
        const { status, data } = await spotifyRequest("/me/player/seek", {
          tier: "user",
          method: "PUT",
          query: { position_ms: String(Math.max(0, Math.round(options.positionMs))) },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "seek", ok: true, positionMs: options.positionMs };
      }

      case "transfer": {
        if (!options.deviceId) return { error: "Action 'transfer' requires 'deviceId'" };
        const { status, data } = await spotifyRequest("/me/player", {
          tier: "user",
          method: "PUT",
          body: { device_ids: [options.deviceId], play: true },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action: "transfer", ok: true, deviceId: options.deviceId };
      }

      case "save_track":
      case "unsave_track": {
        if (!options.id) return { error: `Action '${action}' requires 'id'` };
        const parsed = parseSpotifyId(options.id, "track");
        if (!parsed) return { error: `Could not parse Spotify id '${options.id}'` };
        const { status, data } = await spotifyRequest("/me/tracks", {
          tier: "user",
          method: action === "save_track" ? "PUT" : "DELETE",
          query: { ids: parsed.id },
        });
        if (status >= 400) return { error: apiError(status, data) };
        return { action, ok: true, id: parsed.id };
      }
    }
    return { error: `Unhandled action '${action}'` };
  } catch (error: unknown) {
    if (error instanceof SpotifyNotAuthorizedError) return { error: error.message };
    return { error: `Spotify control failed: ${errorMessage(error)}` };
  }
}
