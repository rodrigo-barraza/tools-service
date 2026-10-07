// ─── SSRF Guard — deny fetches into private address space ────
// URLs that callers and agents supply (read_web_page, the open scrape,
// feed and headers routes, images in an animation) are untrusted. A
// prompt-injected or hostile URL must not reach loopback services, the
// LAN (NAS, vault-service, MinIO, portal-service), or cloud metadata
// endpoints (169.254.169.254). This guard checks every hop:
//
//   1. Protocol must be http/https.
//   2. A literal address must be public. Loopback, RFC1918, link-local
//      and metadata, CGNAT, unique-local, multicast, reserved and
//      unspecified ranges are refused in every spelling, including
//      IPv4-mapped and -compatible IPv6 (dotted or hex), NAT64 and 6to4.
//   3. A hostname is resolved when the request CONNECTS (its `lookup`),
//      and refused when any of its addresses is private — the address
//      checked is the address connected to, so a host that re-resolves
//      between a check and the fetch (DNS rebinding) gains nothing.
//   4. Redirects are followed here, not by the transport: every Location
//      is a new request through 1–3. A public URL redirecting to an
//      internal one is the classic bypass.
//   5. Only a fetch of a URL a model supplies may also reach this fleet's
//      own services — tools-service, prism-service and MinIO, at the exact
//      origins (scheme, host, port) configured for them — so it can chain
//      the media they serve. Every other origin is held to 1–4, on every
//      hop: a redirect from one of ours to a private address is refused.
//
// Research basis (harness_landscape_survey_2026-07.md, D2):
// deny-by-default egress per Anthropic sandbox-runtime
// (github.com/anthropic-experimental/sandbox-runtime) and Claude
// Code's sandboxing model — this is the "SSRF/private-IP + metadata-
// endpoint guard in a central outbound-fetch wrapper" slice.
// ─────────────────────────────────────────────────────────────

import http from "node:http";
import https from "node:https";
import { lookup as resolveHost, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import zlib from "node:zlib";
import CONFIG from "../../config.ts";

const MAX_REDIRECTS = 5;

// ─── Address Space ───────────────────────────────────────────

function isPrivateIpv4([first, second, third]: number[]): boolean {
  return (
    first === 0 || // 0.0.0.0/8 this network, unspecified
    first === 10 || // 10/8 private
    first === 127 || // 127/8 loopback
    (first === 100 && second >= 64 && second <= 127) || // 100.64/10 CGNAT
    (first === 169 && second === 254) || // 169.254/16 link-local + cloud metadata
    (first === 172 && second >= 16 && second <= 31) || // 172.16/12 private
    (first === 192 && second === 0 && (third === 0 || third === 2)) || // 192.0.0/24 IETF, 192.0.2/24 documentation
    (first === 192 && second === 88 && third === 99) || // 192.88.99/24 6to4 relay
    (first === 192 && second === 168) || // 192.168/16 private
    (first === 198 && (second === 18 || second === 19)) || // 198.18/15 benchmarking
    (first === 198 && second === 51 && third === 100) || // 198.51.100/24 documentation
    (first === 203 && second === 0 && third === 113) || // 203.0.113/24 documentation
    first >= 224 // multicast + reserved + broadcast
  );
}

/** The eight 16-bit words of an IPv6 address in any spelling, or null. */
function ipv6Words(address: string): number[] | null {
  let canonical: string;
  try {
    // The URL parser writes every spelling one way: hex, zero runs as ::
    canonical = new URL(
      `http://[${address.replace(/%.*$/, "")}]/`,
    ).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head, tail] = canonical.split("::");
  const headWords = head ? head.split(":") : [];
  const tailWords = tail ? tail.split(":") : [];
  const zeroRun = canonical.includes("::")
    ? 8 - headWords.length - tailWords.length
    : 0;
  const words = [
    ...headWords,
    ...Array<string>(zeroRun).fill("0"),
    ...tailWords,
  ].map((word) => parseInt(word, 16));
  return words.length === 8 &&
    words.every((word) => word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function embeddedIpv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv6(words: number[]): boolean {
  const [first, second] = words;
  // ::a.b.c.d (compatible) and ::ffff:a.b.c.d (mapped): the IPv4 address decides
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    (words[5] === 0 || words[5] === 0xffff)
  ) {
    return isPrivateIpv4(embeddedIpv4(words[6], words[7]));
  }
  // 64:ff9b::/96 NAT64: so does the IPv4 address it reaches
  if (
    first === 0x64 &&
    second === 0xff9b &&
    words.slice(2, 6).every((word) => word === 0)
  ) {
    return isPrivateIpv4(embeddedIpv4(words[6], words[7]));
  }
  // 2002::/16 6to4: and the one in words 1–2
  if (first === 0x2002) return isPrivateIpv4(embeddedIpv4(words[1], words[2]));
  return (
    first < 0x0100 || // ::/8 reserved (unspecified, loopback, translated, …)
    (first === 0x0100 && words.slice(1, 4).every((word) => word === 0)) || // 100::/64 discard
    (first === 0x2001 && (second === 0 || second === 0x0db8)) || // 2001::/32 Teredo, 2001:db8::/32 documentation
    (first === 0x64 && second === 0xff9b && words[2] === 1) || // 64:ff9b:1::/48 local NAT64
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/** True when the IP lands in a private/reserved/internal range. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address.split(".").map(Number));
  if (isIP(address.replace(/%.*$/, "")) === 6) {
    const words = ipv6Words(address);
    return words ? isPrivateIpv6(words) : true;
  }
  // Not an IP literal — caller resolves via DNS first
  return true;
}

/** A URL or host the guard refuses: never retried, never a network fault. */
export class UnsafeUrlError extends Error {
  readonly code = "ESSRFBLOCKED";
}

/**
 * The check every address goes through. Production uses isPrivateAddress;
 * a test may stand a local server in for a public host.
 */
export const addressPolicy = {
  isBlocked(address: string): boolean {
    return isPrivateAddress(address);
  },
};

/** Refuse a host that is a private address literal (names are checked as they resolve). */
export function assertPublicHost(host: string): void {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare.replace(/%.*$/, "")) && addressPolicy.isBlocked(bare)) {
    throw new UnsafeUrlError(`Blocked private/internal address: ${bare}`);
  }
}

/**
 * The `lookup` of every guarded connection (http.request, tls.connect):
 * resolves as the system does and fails when any address of the host is
 * private, so what is checked is exactly what is connected to.
 */
export const publicAddressLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  resolveHost(
    hostname,
    { family: options.family, hints: options.hints, all: true },
    (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, []);
        return;
      }
      const blocked = addresses.find((entry) =>
        addressPolicy.isBlocked(entry.address),
      );
      if (blocked) {
        callback(
          new UnsafeUrlError(
            `Blocked: ${hostname} resolves to private/internal address ${blocked.address}`,
          ),
          [],
        );
        return;
      }
      if (addresses.length === 0) {
        const unresolved: NodeJS.ErrnoException = new Error(
          `Host did not resolve: ${hostname}`,
        );
        unresolved.code = "ENOTFOUND";
        callback(unresolved, []);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
  );
};

// ─── URL Checks ──────────────────────────────────────────────

export interface GuardOptions {
  /**
   * Exact origins (scheme://host:port) that may resolve to private
   * addresses; every other origin must be public.
   */
  trustedOrigins?: ReadonlySet<string>;
}

/**
 * This fleet's own services, as configured now: the origins whose media a
 * model may chain (tools-service, prism-service and MinIO, internal and
 * public addresses alike).
 */
export function ownServiceOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const configured of [
    CONFIG.TOOLS_SERVICE_URL,
    CONFIG.TOOLS_SERVICE_PUBLIC_URL,
    CONFIG.PRISM_SERVICE_URL,
    CONFIG.PRISM_SERVICE_PUBLIC_URL,
    CONFIG.MINIO_ENDPOINT,
    CONFIG.MINIO_PUBLIC_URL,
  ]) {
    if (!configured) continue;
    try {
      const { protocol, origin } = new URL(configured);
      if (protocol === "http:" || protocol === "https:") origins.add(origin);
    } catch {
      // Not a URL: names no origin
    }
  }
  return origins;
}

/**
 * The URL, when it is http(s) and either trusted or not a private literal;
 * throws otherwise. `trusted` says whether its origin is one of `options`'.
 */
function checkedUrl(
  rawUrl: string,
  { trustedOrigins }: GuardOptions,
): { url: URL; trusted: boolean } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Blocked non-http(s) protocol: ${url.protocol}`);
  }
  const trusted = trustedOrigins?.has(url.origin) ?? false;
  if (!trusted) assertPublicHost(url.hostname);
  return { url, trusted };
}

export interface UrlValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate that a URL is a public http(s) address — protocol check,
 * then every DNS resolution of the hostname must be public space. A
 * fetch through fetchPublicUrl checks again as it connects.
 */
export async function validatePublicWebUrl(
  rawUrl: string,
  options: GuardOptions = {},
): Promise<UrlValidationResult> {
  let url: URL;
  let trusted: boolean;
  try {
    ({ url, trusted } = checkedUrl(rawUrl, options));
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (trusted || isIP(hostname)) return { ok: true };

  try {
    const resolutions = await lookup(hostname, { all: true });
    if (resolutions.length === 0) {
      return { ok: false, error: `Host did not resolve: ${hostname}` };
    }
    const blocked = resolutions.find((entry) =>
      addressPolicy.isBlocked(entry.address),
    );
    if (blocked) {
      return {
        ok: false,
        error: `Blocked: ${hostname} resolves to private/internal address ${blocked.address}`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: `DNS resolution failed: ${hostname}` };
  }
}

// ─── Guarded Fetch ───────────────────────────────────────────

export interface PublicFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  signal?: AbortSignal | null;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const DECODERS: Record<string, () => NodeJS.ReadWriteStream> = {
  gzip: () => zlib.createGunzip(),
  "x-gzip": () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

/** A WHATWG Response over the message, its body decoded as fetch would. */
function toResponse(message: http.IncomingMessage, method: string): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value]) {
      headers.append(name, item);
    }
  }
  const status = message.statusCode ?? 502;
  const init = { status, statusText: message.statusMessage ?? "", headers };
  if (method === "HEAD" || NULL_BODY_STATUSES.has(status)) {
    message.resume();
    return new Response(null, init);
  }
  const decoder =
    DECODERS[
      String(message.headers["content-encoding"] ?? "")
        .trim()
        .toLowerCase()
    ];
  const body = decoder
    ? (pipeline(message, decoder(), () => {}) as unknown as Readable)
    : message;
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, init);
}

/** One request, connected only to a public address unless its origin is trusted. */
function requestOnce(
  url: URL,
  trusted: boolean,
  method: string,
  init: PublicFetchInit,
  body: string | Uint8Array | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    "accept-encoding": "gzip, deflate, br",
    "user-agent": "node",
  };
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method,
        headers,
        lookup: trusted ? undefined : publicAddressLookup,
        // A fresh connection per request: no pooled socket skips the lookup
        agent: false,
        signal: init.signal ?? undefined,
      },
      (message) => {
        try {
          resolve(toResponse(message, method));
        } catch (error: unknown) {
          message.destroy();
          reject(error);
        }
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

/**
 * fetch() restricted to public address space (and `options`' trusted
 * origins): each hop connects only to an address that passed the guard,
 * and redirects are followed here so every Location is checked the same
 * way.
 */
export async function fetchPublicUrl(
  rawUrl: string,
  init: PublicFetchInit = {},
  options: GuardOptions = {},
): Promise<Response> {
  let { url, trusted } = checkedUrl(rawUrl, options);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await requestOnce(url, trusted, method, init, body);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      // Drain/cancel the redirect body before following
      await response.body?.cancel().catch(() => {});
      ({ url, trusted } = checkedUrl(
        new URL(location, url).toString(),
        options,
      ));
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    Object.defineProperties(response, {
      url: { value: url.toString() },
      redirected: { value: hop > 0 },
    });
    return response;
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}): ${rawUrl}`);
}

/**
 * fetchPublicUrl for a URL a model supplies: public addresses, or this
 * fleet's own services at their configured origins (ownServiceOrigins), so
 * the media one tool hosts can feed the next.
 */
export function fetchPublicOrOwnUrl(
  rawUrl: string,
  init: PublicFetchInit = {},
): Promise<Response> {
  return fetchPublicUrl(rawUrl, init, { trustedOrigins: ownServiceOrigins() });
}
