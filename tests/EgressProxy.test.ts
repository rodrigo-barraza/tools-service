// ─── The Egress Proxy ─────────────────────────────────────────────
// yt-dlp and the agentic browser fetch by themselves, so they go through
// a proxy that resolves each destination once, refuses it (403, and a log
// line) when its policy refuses any of the addresses, and connects to the
// address that passed. Local servers stand in for the world: 127.0.0.1 is
// public here, 127.0.0.2 — on the same port — private. The proxy's own
// tests resolve names with a resolver they control. yt-dlp's resolve
// public.test through node:dns, which only this process can do: a download
// that works went through the proxy.

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import http from "node:http";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import logger from "../src/logger.ts";
import {
  egressRefusal,
  startEgressProxy,
  type EgressPolicy,
  type EgressProxy,
  type Resolver,
} from "../src/fetchers/web/EgressProxy.ts";
import { addressPolicy } from "../src/fetchers/web/SsrfGuard.ts";
import {
  downloadVideo,
  isVideoErrorResult,
  isVideoFileResult,
  throughEgressProxy,
} from "../src/fetchers/web/GenericVideoFetcher.ts";

// The one name node:dns resolves differently here: for yt-dlp's proxy and
// the URL check before it
const TEST_HOSTS: Record<string, Array<{ address: string; family: number }>> = {
  "public.test": [{ address: "127.0.0.1", family: 4 }],
};
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  return {
    ...actual,
    lookup: ((
      hostname: string,
      options: { all?: boolean },
      callback: (...args: unknown[]) => void,
    ) => {
      const addresses = TEST_HOSTS[hostname];
      if (!addresses)
        return (actual.lookup as (...args: unknown[]) => void)(
          hostname,
          options,
          callback,
        );
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    }) as typeof actual.lookup,
  };
});
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  const lookup = (async (hostname: string, options?: { all?: boolean }) => {
    const addresses = TEST_HOSTS[hostname];
    if (!addresses)
      return (actual.lookup as (...args: unknown[]) => Promise<unknown>)(
        hostname,
        options,
      );
    return options?.all ? addresses : addresses[0];
  }) as typeof actual.lookup;
  return { ...actual, lookup, default: { ...actual, lookup } };
});

const PUBLIC = "127.0.0.1";
const PRIVATE = "127.0.0.2";

interface Seen {
  name: string;
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}
const seen: Seen[] = [];
const seenBy = (name: string) => seen.filter((entry) => entry.name === name);

let port = 0; // both stand-ins listen on it, at their own address
let clip = Buffer.alloc(0);
const servers: http.Server[] = [];

function standIn(name: string): http.RequestListener {
  return (request, response) => {
    seen.push({
      name,
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
    });
    if (request.url === "/to-private") {
      response.writeHead(302, {
        location: `http://private.test:${port}/secret`,
      });
      response.end();
    } else if (request.url === "/to-private.mp4") {
      response.writeHead(302, {
        location: `http://${PRIVATE}:${port}/clip.mp4`,
      });
      response.end();
    } else if (request.url === "/clip.mp4") {
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": clip.length,
      });
      response.end(clip);
    } else {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`${name} ${request.method} ${request.url}`);
    }
  };
}

function listen(
  server: http.Server,
  host: string,
  listenPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, host, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

// ─── The proxy under test ────────────────────────────────────

let trusted = new Set<string>();
const policy: EgressPolicy = {
  name: "test egress",
  refusedSpace: "private/internal",
  refuses: (address) => address !== PUBLIC,
  trustedOrigins: () => trusted,
};

const lookups: string[] = [];
let rebindAnswers = 0;
const resolve: Resolver = async (hostname) => {
  lookups.push(hostname);
  switch (hostname) {
    case "public.test":
      return [PUBLIC];
    case "private.test":
      return [PRIVATE];
    case "mixed.test":
      return [PUBLIC, PRIVATE];
    case "rebind.test":
      // Public when checked; private to anyone who asks again
      return rebindAnswers++ === 0 ? [PUBLIC] : [PRIVATE];
    default:
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: "ENOTFOUND",
      });
  }
};

let proxy: EgressProxy;
let proxyPort = 0;

beforeAll(async () => {
  // The private stand-in takes the public one's port at its own address
  for (let attempt = 0; attempt < 5 && !port; attempt++) {
    const publicServer = http.createServer(standIn("public"));
    const privateServer = http.createServer(standIn("private"));
    const candidate = await listen(publicServer, PUBLIC, 0);
    try {
      await listen(privateServer, PRIVATE, candidate);
      servers.push(publicServer, privateServer);
      port = candidate;
    } catch {
      publicServer.close();
    }
  }
  proxy = await startEgressProxy(policy, { resolve });
  proxyPort = Number(new URL(proxy.url).port);
});

afterAll(async () => {
  await proxy?.close();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
          server.closeAllConnections();
        }),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  seen.length = 0;
  lookups.length = 0;
  trusted = new Set();
});

/** A request through the proxy, in absolute-URI form. */
function viaProxy(
  target: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolveReply, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path: target,
        headers: { host: new URL(target).host, ...headers },
        agent: false,
      },
      (reply) => {
        let body = "";
        reply.setEncoding("utf8");
        reply.on("data", (chunk: string) => (body += chunk));
        reply.on("end", () =>
          resolveReply({
            status: reply.statusCode ?? 0,
            headers: reply.headers,
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** CONNECT through the proxy, then a GET over the tunnel — or the refusal. */
function throughTunnel(
  authority: string,
  path = "/tunnel",
): Promise<{ status: number; body: string }> {
  return new Promise((resolveReply, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: proxyPort,
      method: "CONNECT",
      path: authority,
      agent: false,
    });
    request.on("connect", (reply, socket, head: Buffer) => {
      let raw = head.toString("utf8");
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (raw += chunk));
      socket.on("end", () =>
        resolveReply({ status: reply.statusCode ?? 0, body: raw }),
      );
      socket.on("error", reject);
      if (reply.statusCode === 200) {
        socket.write(
          `GET ${path} HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`,
        );
      }
    });
    request.on("error", reject);
    request.end();
  });
}

describe("the egress proxy", () => {
  it("carries an absolute-URI request to a public host, under the name it was given", async () => {
    const reply = await viaProxy(`http://public.test:${port}/page?q=1`, {
      "proxy-connection": "keep-alive",
      "x-trace": "abc",
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toBe("public GET /page?q=1");
    const [request] = seenBy("public");
    expect(request.headers.host).toBe(`public.test:${port}`);
    expect(request.headers["x-trace"]).toBe("abc");
    expect(request.headers["proxy-connection"]).toBeUndefined();
  });

  it("carries a CONNECT tunnel to a public host", async () => {
    const reply = await throughTunnel(`public.test:${port}`);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("public GET /tunnel");
  });

  it("refuses a private destination by name or number, over HTTP or CONNECT, with 403 and a log line", async () => {
    const warn = vi.spyOn(logger, "warn");
    for (const target of [
      `http://private.test:${port}/secret`,
      `http://${PRIVATE}:${port}/secret`,
      // Any refused address refuses the name
      `http://mixed.test:${port}/secret`,
    ]) {
      expect((await viaProxy(target)).status, target).toBe(403);
    }
    for (const authority of [
      `private.test:${port}`,
      `${PRIVATE}:${port}`,
      `mixed.test:${port}`,
    ]) {
      expect((await throughTunnel(authority)).status, authority).toBe(403);
    }
    expect((await viaProxy(`http://private.test:${port}/`)).body).toBe(
      `Blocked: private.test resolves to private/internal address ${PRIVATE}\n`,
    );
    expect((await throughTunnel(`${PRIVATE}:${port}`)).body).toContain(
      `Blocked private/internal address: ${PRIVATE}`,
    );
    expect(seenBy("private")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      `[EgressProxy] test egress: refused http://private.test:${port} — Blocked: private.test resolves to private/internal address ${PRIVATE}`,
    );
    expect(warn).toHaveBeenCalledWith(
      `[EgressProxy] test egress: refused CONNECT mixed.test:${port} — Blocked: mixed.test resolves to private/internal address ${PRIVATE}`,
    );
  });

  it("hands a redirect back to the client, and refuses its private Location", async () => {
    const redirect = await viaProxy(`http://public.test:${port}/to-private`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(
      `http://private.test:${port}/secret`,
    );
    const followed = await viaProxy(redirect.headers.location as string);
    expect(followed.status).toBe(403);
    expect(seenBy("private")).toEqual([]);
  });

  it("connects to the address it checked: an answer that changes between check and connect cannot win", async () => {
    rebindAnswers = 0;
    const reply = await viaProxy(`http://rebind.test:${port}/pinned`);
    expect(reply.body).toBe("public GET /pinned");
    expect(lookups).toEqual(["rebind.test"]);

    rebindAnswers = 0;
    const tunnelled = await throughTunnel(`rebind.test:${port}`, "/pinned");
    expect(tunnelled.body).toContain("public GET /pinned");
    expect(seenBy("private")).toEqual([]);
  });

  it("lets a trusted origin through to a refused address, at that exact origin only", async () => {
    trusted = new Set([`http://private.test:${port}`]);
    expect((await viaProxy(`http://private.test:${port}/own`)).body).toBe(
      "private GET /own",
    );
    // The same host through CONNECT is another origin (https)
    expect((await throughTunnel(`private.test:${port}`)).status).toBe(403);
  });

  it("answers 502 for a name that does not resolve", async () => {
    const reply = await viaProxy("http://nowhere.test/");
    expect(reply.status).toBe(502);
    expect(reply.body).toBe("Host did not resolve: nowhere.test (ENOTFOUND)\n");
  });

  it("is a proxy, on 127.0.0.1 only", async () => {
    expect(new URL(proxy.url).hostname).toBe("127.0.0.1");
    const direct = await new Promise<number>((resolveStatus, reject) => {
      http
        .get(
          { host: "127.0.0.1", port: proxyPort, path: "/", agent: false },
          (reply) => {
            reply.resume();
            resolveStatus(reply.statusCode ?? 0);
          },
        )
        .on("error", reject);
    });
    expect(direct).toBe(400);
    const elsewhere = await new Promise<string>((resolveCode) => {
      const socket = net.connect({ host: PRIVATE, port: proxyPort });
      socket.on("connect", () => {
        socket.destroy();
        resolveCode("connected");
      });
      socket.on("error", (error: NodeJS.ErrnoException) =>
        resolveCode(error.code ?? "error"),
      );
    });
    expect(elsewhere).toBe("ECONNREFUSED");
  });

  it("says why it would refuse a URL before a client is sent there", async () => {
    expect(
      await egressRefusal(
        policy,
        new URL(`http://public.test:${port}/`),
        resolve,
      ),
    ).toBeNull();
    expect(
      await egressRefusal(policy, new URL("https://private.test/"), resolve),
    ).toBe(
      `Blocked: private.test resolves to private/internal address ${PRIVATE}`,
    );
    expect(
      await egressRefusal(policy, new URL(`http://${PRIVATE}/`), resolve),
    ).toBe(`Blocked private/internal address: ${PRIVATE}`);
  });
});

describe("yt-dlp's arguments and environment", () => {
  it("send every connection through the proxy, with no host exempt", () => {
    const saved = { no: process.env.no_proxy, NO: process.env.NO_PROXY };
    process.env.no_proxy = "public.test";
    process.env.NO_PROXY = "public.test";
    try {
      const proxyUrl = "http://127.0.0.1:9";
      const { args, env } = throughEgressProxy(
        ["https://video.example/watch", "--no-check-certificates"],
        proxyUrl,
      );
      expect(args).toEqual([
        "https://video.example/watch",
        "--no-check-certificates",
        "--proxy",
        proxyUrl,
      ]);
      expect(env.no_proxy).toBeUndefined();
      expect(env.NO_PROXY).toBeUndefined();
      for (const name of [
        "http_proxy",
        "HTTP_PROXY",
        "https_proxy",
        "HTTPS_PROXY",
        "all_proxy",
        "ALL_PROXY",
      ]) {
        expect(env[name], name).toBe(proxyUrl);
      }
    } finally {
      if (saved.no === undefined) delete process.env.no_proxy;
      else process.env.no_proxy = saved.no;
      if (saved.NO === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = saved.NO;
    }
  });
});

const hasYtDlp = spawnSync("yt-dlp", ["--version"]).status === 0;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasYtDlp || !hasFfmpeg)("yt-dlp through the proxy", () => {
  let clipDirectory = "";

  beforeAll(() => {
    clipDirectory = mkdtempSync(join(tmpdir(), "egress-clip-"));
    const clipPath = join(clipDirectory, "clip.mp4");
    const made = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=32x32:d=1:r=10",
      "-c:v",
      "mpeg4",
      "-y",
      clipPath,
    ]);
    expect(made.status).toBe(0);
    clip = readFileSync(clipPath);
  });

  afterAll(() => rmSync(clipDirectory, { recursive: true, force: true }));

  // The stand-in at 127.0.0.1 is public; everything else stays private
  beforeEach(() => {
    vi.spyOn(addressPolicy, "isBlocked").mockImplementation(
      (address) => address !== PUBLIC,
    );
  });

  it("downloads from a host only the proxy can resolve", async () => {
    const result = await downloadVideo(`http://public.test:${port}/clip.mp4`);
    expect(isVideoErrorResult(result) ? result.error : "").toBe("");
    if (!isVideoFileResult(result)) throw new Error("no file");
    try {
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.format).toBe("mp4");
      // The metadata came through the proxy too: no fallback
      expect(result.metadata).toMatchObject({
        title: "clip",
        platform: "generic",
      });
    } finally {
      rmSync(result.temporaryDirectory, { recursive: true, force: true });
    }
    expect(seenBy("public").map((entry) => entry.url)).toContain("/clip.mp4");
  }, 120_000);

  it("is refused a redirect to a private address", async () => {
    const warn = vi.spyOn(logger, "warn");
    const result = await downloadVideo(
      `http://public.test:${port}/to-private.mp4`,
    );
    expect(isVideoErrorResult(result)).toBe(true);
    expect(isVideoErrorResult(result) && result.error).toContain("403");
    expect(seenBy("private")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      `[EgressProxy] video download: refused http://${PRIVATE}:${port} — Blocked private/internal address: ${PRIVATE}`,
    );
  }, 120_000);
});
