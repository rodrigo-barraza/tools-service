import type { Application, NextFunction, Request, Response } from "express";
import { AUTH_HEADERS } from "@rodrigo-barraza/utilities-library/taxonomy";
import CONFIG from "../config.ts";
import logger from "../logger.ts";
import { secretMatches } from "../utilities/secretMatches.ts";

// ─── Tools Secret Guard ───────────────────────────────────────────
// tools-service is publicly routed, and it runs commands on the owner's
// machines, reads and writes their workspaces, and acts on their accounts
// and devices. Every route that does any of that answers only a caller that
// sends TOOLS_SERVICE_API_SECRET in `x-api-secret`: prism-service, and
// prism-client's server proxy for its signed-in user. Unset, those routes
// refuse everyone (503). Read-only data stays open (other fleet apps read
// it), and so do the embed and render URLs that browsers and Discord load
// straight from here (`buildLocalUrl`), and Spotify's OAuth callback.
//
// GATED_ROUTES is the whole policy. It is mounted ahead of the routers and
// matched by Express itself, case-insensitive and by whole path segment as
// the routers are, so no spelling of a path reaches a gated handler past
// its guard. A new route that executes code or commands, reads or writes
// files or workspaces, changes configuration, or acts on the owner's
// accounts, devices or money belongs in it. The bridge's WebSockets
// (/ws/agent, /ws/workspace) keep their own agent secret
// (AgentConnectionManager).

export interface GatedRoute {
  /** Express path, as the client calls it. */
  path: string;
  /** The path and every path beneath it; otherwise this route alone. */
  family?: boolean;
  /** Only writes are gated: GET and HEAD stay open. */
  writesOnly?: boolean;
  /** What a caller could do with it. */
  reason: string;
}

export const GATED_ROUTES: readonly GatedRoute[] = [
  // ── Commands, code and workspaces ─────────────────────────────
  {
    path: "/agentic",
    family: true,
    reason:
      "files, git, commands, background tasks and their SSE, hooks and transcripts, browser, LSP, debugger, notebooks, scheduled tasks, memories, custom agents",
  },
  {
    path: "/filesystem",
    family: true,
    reason: "directory trees of the workspaces",
  },
  {
    path: "/agents",
    family: true,
    reason:
      "the bridge: its agents, disconnecting one, agent binaries compiled with the agent secret, uploading the installers users download",
  },
  {
    path: "/admin",
    family: true,
    reason:
      "workspace roots (set and probed on disk), request and tool-call logs with callers' arguments and results",
  },
  {
    path: "/mcp",
    family: true,
    reason: "the MCP adapter, which runs every tool",
  },
  { path: "/compute/js", family: true, reason: "JavaScript execution" },
  { path: "/compute/shell", family: true, reason: "shell execution" },
  { path: "/utility/python/execute", reason: "Python execution" },
  { path: "/utility/python/stream", reason: "Python execution" },
  { path: "/utility/python/info", reason: "the Python interpreter" },
  // ── Inputs that may be a local path, read from disk ───────────
  { path: "/compute/image/process", reason: "reads workspace image files" },
  { path: "/compute/image/ascii", reason: "reads workspace image files" },
  { path: "/compute/barcode/scan", reason: "reads workspace image files" },
  { path: "/compute/video/gif", reason: "reads workspace video files" },
  {
    path: "/knowledge/video",
    family: true,
    reason:
      "trim reads workspace video files; download stores any site's media in the owner's MinIO",
  },
  {
    path: "/creative/generate-audio",
    reason: "sampler sources read any absolute path on this host",
  },
  {
    path: "/creative/remix-audio",
    reason: "audio sources read any absolute path on this host",
  },
  // ── The owner's money: Prism calls made with this service's secret ──
  {
    path: "/creative/generate-image",
    reason: "image generation through Prism",
  },
  {
    path: "/creative/describe-image",
    reason: "vision through Prism; reads workspace image files",
  },
  {
    path: "/creative/detect-objects",
    reason: "vision through Prism; reads workspace image files",
  },
  {
    path: "/creative/remove-background",
    reason: "segmentation through Prism; reads workspace image files",
  },
  { path: "/creative/text-to-speech", reason: "speech through Prism" },
  { path: "/creative/sound-effect", reason: "sound effects through Prism" },
  { path: "/creative/speech-to-text", reason: "transcription through Prism" },
  // ── The owner's accounts and devices ──────────────────────────
  {
    path: "/communication",
    family: true,
    reason:
      "SMS, email, push and webhooks from the owner's accounts, and reading their messages",
  },
  {
    path: "/utility/calendar",
    family: true,
    reason: "the owner's Google Calendar",
  },
  {
    path: "/music/spotify/get",
    reason: "the owner's Spotify library and playback state",
  },
  { path: "/music/spotify/control", reason: "the owner's Spotify playback" },
  {
    path: "/music/spotify/auth/login",
    reason:
      "links a Spotify account as the owner's (the callback stays open: Spotify redirects the browser to it with the state only this issues)",
  },
  {
    path: "/music/spotify/auth/status",
    reason: "which Spotify account is linked as the owner's",
  },
  { path: "/torrent", family: true, reason: "the owner's qBittorrent" },
  {
    path: "/lights",
    family: true,
    reason:
      "the owner's lights: their state, scenes and night lock, and control",
  },
  {
    path: "/discord",
    family: true,
    writesOnly: true,
    reason:
      "acts in Discord: reactions, gold, polls, threads, reminders, Lupos's nickname",
  },
  {
    path: "/product",
    family: true,
    writesOnly: true,
    reason: "the availability watchlist",
  },
  {
    path: "/infrastructure",
    family: true,
    reason: "status, devices and container logs of the owner's infrastructure",
  },
  { path: "/analytics", family: true, reason: "the owner's web analytics" },
  {
    path: "/utility/ports",
    family: true,
    reason: "port scans from inside the owner's network",
  },
  {
    path: "/utility/ping",
    family: true,
    reason: "pings from inside the owner's network",
  },
];

const READ_METHODS = new Set(["GET", "HEAD"]);

/** Whether `provided` is the tools-service secret. An unset secret matches nothing. */
export function toolsSecretMatches(provided: unknown): boolean {
  return secretMatches(provided, CONFIG.TOOLS_SERVICE_API_SECRET);
}

/** Let the request through only with the tools-service secret. */
export function requireToolsSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!CONFIG.TOOLS_SERVICE_API_SECRET) {
    res.status(503).json({
      error:
        "This route is closed: TOOLS_SERVICE_API_SECRET is not configured.",
      code: "SECRET_NOT_CONFIGURED",
    });
    return;
  }
  if (toolsSecretMatches(req.headers[AUTH_HEADERS.apiSecret])) {
    next();
    return;
  }
  res.status(401).json({
    error: `This route needs the tools-service secret in ${AUTH_HEADERS.apiSecret}.`,
    code: "UNAUTHENTICATED",
  });
}

function requireToolsSecretForWrites(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  requireToolsSecret(req, res, next);
}

/** Mount the guard for every gated route. Call it before the routers. */
export function mountToolsSecretGuard(app: Application): void {
  if (!CONFIG.TOOLS_SERVICE_API_SECRET) {
    logger.error(
      "TOOLS_SERVICE_API_SECRET is not set: every gated route answers 503 until it is.",
    );
  }
  for (const route of GATED_ROUTES) {
    const guard = route.writesOnly
      ? requireToolsSecretForWrites
      : requireToolsSecret;
    if (route.family) app.use(route.path, guard);
    else app.all(route.path, guard);
  }
}

/** The secret for this service's own calls to its gated routes (the MCP adapter's). */
export function toolsSecretHeaders(): Record<string, string> {
  const secret = CONFIG.TOOLS_SERVICE_API_SECRET;
  return secret ? { [AUTH_HEADERS.apiSecret]: secret } : {};
}
