// ─── Egress Proxy — the guard for programs that fetch by themselves ───
// yt-dlp (with the ffmpeg it drives) and the agentic browser's Chromium
// open their own connections, so fetchPublicUrl (SsrfGuard.ts) cannot stand
// between them and the network. They are pointed at this proxy instead: an
// HTTP proxy inside this process, listening on 127.0.0.1 only, on a port
// the system picks. For every request it carries — a CONNECT tunnel or an
// absolute-URI HTTP request — it
//
//   1. resolves the destination once, here;
//   2. refuses it with 403 and a log line when the policy refuses any of
//      its addresses, unless its exact origin is one the policy trusts;
//   3. connects to an address that passed, by number: the name is never
//      looked up again, so an answer that changes between the check and
//      the connection (DNS rebinding) cannot win;
//   4. pipes the bytes. A redirect is followed by the client, as a new
//      request, so every Location goes through 1–3.
//
// Each policy gets one proxy, started the first time it is asked for and
// kept for the life of the process.
// ─────────────────────────────────────────────────────────────

import http from "node:http";
import net from "node:net";
import { lookup, type LookupAddress } from "node:dns";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import logger from "../../logger.ts";
import { errorMessage } from "../../utilities.ts";

export interface EgressPolicy {
  /** Names the policy in log lines ("video download"). */
  readonly name: string;
  /** The space it refuses, for messages ("private/internal"). */
  readonly refusedSpace: string;
  /** True when no connection may be made to this address. */
  refuses(address: string): boolean;
  /** Exact origins (scheme://host[:port]) let through to any address. */
  trustedOrigins?(): ReadonlySet<string>;
}

/** Every address a name resolves to. */
export type Resolver = (hostname: string) => Promise<string[]>;

/** The system's answer, as every other connection of this process gets it. */
export const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    lookup(
      hostname,
      { all: true },
      (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
        if (error) reject(error);
        else resolve(addresses.map((entry) => entry.address));
      },
    );
  });

const CONNECT_TIMEOUT_MS = 15_000;

/** Headers that belong to one connection, never forwarded. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Why a destination is not let through: 403 refused, 502 unreachable. */
class EgressError extends Error {
  readonly status: 403 | 502;

  constructor(status: 403 | 502, message: string) {
    super(message);
    this.status = status;
  }
}

interface Destination {
  /** The host as the client named it, without brackets. */
  hostname: string;
  port: number;
  /** scheme://host[:port], matched against the policy's trusted origins. */
  origin: string;
}

function destinationOf(url: URL): Destination {
  return {
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
    origin: url.origin,
  };
}

/** An absolute-URI request's target, when it is an http:// URL. */
function forwardedUrl(target: string | undefined): URL | null {
  if (!target || !/^http:\/\//i.test(target)) return null;
  try {
    return new URL(target);
  } catch {
    return null;
  }
}

/** A CONNECT request's authority (host:port) as an https URL. */
function tunnelUrl(authority: string | undefined): URL | null {
  if (!authority || !/^[^/?#@\s]+$/.test(authority)) return null;
  try {
    return new URL(`https://${authority}`);
  } catch {
    return null;
  }
}

/**
 * The addresses a destination may be connected to: every address it
 * resolves to, each passing the policy (or its origin trusted).
 */
async function admit(
  policy: EgressPolicy,
  { hostname, origin }: Destination,
  resolve: Resolver,
): Promise<string[]> {
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new EgressError(
        502,
        `Host did not resolve: ${hostname}${code ? ` (${code})` : ""}`,
      );
    }
  }
  if (addresses.length === 0) {
    throw new EgressError(502, `Host did not resolve: ${hostname}`);
  }
  if (policy.trustedOrigins?.().has(origin)) return addresses;
  const refused = addresses.find((address) => policy.refuses(address));
  if (refused !== undefined) {
    throw new EgressError(
      403,
      refused === hostname
        ? `Blocked ${policy.refusedSpace} address: ${hostname}`
        : `Blocked: ${hostname} resolves to ${policy.refusedSpace} address ${refused}`,
    );
  }
  return addresses;
}

/**
 * Why the proxy would not let a URL's host through, or null — the same
 * check, made before a client is sent there, for a clearer error than a
 * failed tunnel gives. The proxy checks again as it connects.
 */
export async function egressRefusal(
  policy: EgressPolicy,
  url: URL,
  resolve: Resolver = systemResolver,
): Promise<string | null> {
  try {
    await admit(policy, destinationOf(url), resolve);
    return null;
  } catch (error: unknown) {
    if (error instanceof EgressError) return error.message;
    throw error;
  }
}

function connectTo(address: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
      fail(new Error(`no answer in ${CONNECT_TIMEOUT_MS / 1000} s`)),
    );
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.off("error", fail);
      resolve(socket);
    });
  });
}

/** A socket to the first of the addresses that answers: by number, never by name. */
async function connectPinned(
  addresses: string[],
  { hostname, port }: Destination,
): Promise<net.Socket> {
  let failure: unknown;
  for (const address of addresses) {
    try {
      return await connectTo(address, port);
    } catch (error: unknown) {
      failure = error;
    }
  }
  throw new EgressError(
    502,
    `Could not connect to ${hostname}:${port}: ${errorMessage(failure)}`,
  );
}

/** A message's end-to-end headers, as raw pairs: hop-by-hop ones and Host dropped. */
function endToEnd(
  rawHeaders: string[],
  connection: string | string[] | undefined,
): string[] {
  const named = new Set(
    String(connection ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase()),
  );
  const kept: string[] = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    if (HOP_BY_HOP.has(name) || named.has(name) || name === "host") continue;
    kept.push(rawHeaders[index], rawHeaders[index + 1]);
  }
  return kept;
}

/** The status and message for a destination that was not let through. */
function failureOf(
  policy: EgressPolicy,
  target: string,
  error: unknown,
): { status: number; message: string } {
  if (!(error instanceof EgressError)) {
    return { status: 502, message: errorMessage(error) };
  }
  if (error.status === 403) {
    logger.warn(
      `[EgressProxy] ${policy.name}: refused ${target} — ${error.message}`,
    );
  }
  return { status: error.status, message: error.message };
}

function answer(
  response: http.ServerResponse,
  status: number,
  message: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    connection: "close",
  });
  response.end(`${message}\n`);
}

function answerTunnel(client: Duplex, status: number, message: string): void {
  if (client.destroyed) return;
  const body = `${message}\n`;
  client.end(
    `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ""}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body,
  );
}

/** An absolute-URI HTTP request: checked, then sent to the pinned address. */
function forward(
  policy: EgressPolicy,
  resolve: Resolver,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): void {
  const url = forwardedUrl(request.url);
  if (!url) {
    answer(
      response,
      400,
      "This is a proxy: send an absolute http:// URI, or CONNECT for anything else.",
    );
    return;
  }
  const destination = destinationOf(url);
  let upstream: http.ClientRequest | undefined;
  response.on("close", () => upstream?.destroy());

  admit(policy, destination, resolve)
    .then((addresses) => connectPinned(addresses, destination))
    .then((socket) => {
      if (response.destroyed) {
        socket.destroy();
        return;
      }
      upstream = http.request({
        createConnection: () => socket,
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: [
          "Host",
          url.host,
          ...endToEnd(request.rawHeaders, request.headers.connection),
        ],
      });
      upstream.on("response", (reply) => {
        response.writeHead(
          reply.statusCode ?? 502,
          reply.statusMessage,
          endToEnd(reply.rawHeaders, reply.headers.connection),
        );
        reply.on("error", () => response.destroy());
        reply.pipe(response);
      });
      upstream.on("error", (error) =>
        answer(response, 502, `Upstream failed: ${errorMessage(error)}`),
      );
      request.pipe(upstream);
    })
    .catch((error: unknown) => {
      // The origin only: a query string may carry a token
      const { status, message } = failureOf(policy, url.origin, error);
      answer(response, status, message);
    });
}

/** A CONNECT tunnel: checked, then piped to the pinned address. */
function tunnel(
  policy: EgressPolicy,
  resolve: Resolver,
  request: http.IncomingMessage,
  client: Duplex,
  head: Buffer,
): void {
  client.on("error", () => client.destroy());
  const url = tunnelUrl(request.url);
  if (!url) {
    answerTunnel(client, 400, "CONNECT takes host:port.");
    return;
  }
  const destination = destinationOf(url);

  admit(policy, destination, resolve)
    .then((addresses) => connectPinned(addresses, destination))
    .then((upstream) => {
      if (client.destroyed) {
        upstream.destroy();
        return;
      }
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    })
    .catch((error: unknown) => {
      const { status, message } = failureOf(
        policy,
        `CONNECT ${request.url}`,
        error,
      );
      answerTunnel(client, status, message);
    });
}

export interface EgressProxy {
  /** http://127.0.0.1:<port> */
  readonly url: string;
  close(): Promise<void>;
}

/** A new proxy for the policy, on 127.0.0.1 and a port the system picks. */
export async function startEgressProxy(
  policy: EgressPolicy,
  { resolve = systemResolver }: { resolve?: Resolver } = {},
): Promise<EgressProxy> {
  const tunnels = new Set<Duplex>();
  const server = http.createServer((request, response) =>
    forward(policy, resolve, request, response),
  );
  server.on("connect", (request, client: Duplex, head: Buffer) => {
    tunnels.add(client);
    client.on("close", () => tunnels.delete(client));
    tunnel(policy, resolve, request, client, head);
  });
  // Clients tunnel WebSockets through CONNECT; an upgrade here is not one of ours
  server.on("upgrade", (_request, client: Duplex) =>
    answerTunnel(client, 501, "Upgrades go through CONNECT."),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
        for (const client of tunnels) client.destroy();
      }),
  };
}

const proxies = new Map<EgressPolicy, Promise<EgressProxy>>();

/** The URL of the policy's proxy, started the first time it is asked for. */
export async function egressProxyUrl(policy: EgressPolicy): Promise<string> {
  let proxy = proxies.get(policy);
  if (!proxy) {
    proxy = startEgressProxy(policy);
    proxies.set(policy, proxy);
    proxy.catch(() => proxies.delete(policy));
  }
  return (await proxy).url;
}
