// ─── The Agentic Browser's Egress ─────────────────────────────────
// The browser may browse the LAN, but never link-local space or a cloud
// metadata endpoint — in any spelling the SSRF guard classifies, and on
// the address each request of a session connects to: navigations,
// redirects and a page's own requests all leave through the egress proxy.
// lan.test, meta.test and mapped.test resolve only in this process, so a
// page that loads from lan.test went through the proxy.

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import logger from "../src/logger.ts";
import {
  agenticBrowserAction,
  checkNavigationUrl,
} from "../src/services/AgenticBrowserService.ts";

const TEST_HOSTS: Record<string, Array<{ address: string; family: number }>> = {
  "lan.test": [{ address: "127.0.0.1", family: 4 }],
  "meta.test": [{ address: "169.254.169.254", family: 4 }],
  "mapped.test": [{ address: "::ffff:a9fe:a9fe", family: 6 }],
  "nat64.test": [
    { address: "192.168.1.20", family: 4 },
    { address: "64:ff9b::a9fe:a9fe", family: 6 },
  ],
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
      if (hostname === "nowhere.test") {
        callback(
          Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
            code: "ENOTFOUND",
          }),
          [],
        );
        return;
      }
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

const sessionId = "vitest-egress";
let port = 0;
const lanServer = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://lan.test");
  const target = url.searchParams.get("to");
  if (url.pathname === "/redirect" && target) {
    response.writeHead(302, { location: target });
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><title>LAN page</title><p>On the LAN.</p>");
});

beforeAll(async () => {
  await new Promise<void>((resolve) =>
    lanServer.listen(0, "127.0.0.1", resolve),
  );
  port = (lanServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await agenticBrowserAction({ action: "close", sessionId });
  await new Promise<void>((resolve) => {
    lanServer.close(() => resolve());
    lanServer.closeAllConnections();
  });
});

afterEach(() => vi.restoreAllMocks());

/** Every spelling of link-local and metadata space a navigation may name. */
const REFUSED_URLS = [
  "http://169.254.169.254/latest/meta-data/",
  "http://169.254.0.1:8080/",
  "http://0xa9fea9fe/", // hex
  "http://2852039166/", // one number
  "http://0251.0376.0251.0376/", // octal
  "http://169.254.43518/", // a.b.c with a 16-bit tail
  "http://100.100.100.200/latest/meta-data/",
  "http://[::ffff:169.254.169.254]/",
  "http://[::ffff:a9fe:a9fe]/",
  "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
  "http://[::169.254.169.254]/", // IPv4-compatible
  "http://[64:ff9b::169.254.169.254]/", // NAT64
  "http://[64:ff9b::a9fe:a9fe]/",
  "http://[2002:a9fe:a9fe::1]/", // 6to4
  "http://[fe80::1]/",
  "https://[FE80::abcd]:8443/",
  "http://[febf::1]/",
  "http://[fd00:ec2::254]/latest/meta-data/",
];

describe("checkNavigationUrl", () => {
  it.each(REFUSED_URLS)("refuses %s", async (url) => {
    expect(await checkNavigationUrl(url)).toMatch(
      /^Blocked link-local\/metadata address: /,
    );
  });

  it.each([
    ["http://meta.test/latest/meta-data/", "169.254.169.254"],
    ["https://mapped.test/", "::ffff:a9fe:a9fe"],
    // Any address of the name decides
    ["http://nat64.test/", "64:ff9b::a9fe:a9fe"],
  ])("refuses %s, a name resolving to %s", async (url, address) => {
    const hostname = new URL(url).hostname;
    expect(await checkNavigationUrl(url)).toBe(
      `Blocked: ${hostname} resolves to link-local/metadata address ${address}`,
    );
  });

  it.each([
    "http://192.168.1.10/",
    "http://10.0.0.5:8080/admin",
    "http://127.0.0.1:3000/",
    "http://[::1]/",
    "http://[fd12:3456::1]/", // unique-local
    "http://169.255.0.1/",
    "http://lan.test/",
    "data:text/html,<p>hi</p>",
    "about:blank",
  ])("lets %s through", async (url) => {
    expect(await checkNavigationUrl(url)).toBeNull();
  });

  it("names a host that does not resolve", async () => {
    expect(await checkNavigationUrl("https://nowhere.test/")).toBe(
      "Host did not resolve: nowhere.test (ENOTFOUND)",
    );
  });

  it("still refuses what is not http(s), data or about", async () => {
    expect(await checkNavigationUrl("file:///etc/passwd")).toMatch(
      /^Unsupported URL scheme "file:\/\/"/,
    );
  });
});

describe("every request of a session", () => {
  const navigate = (url: string) =>
    agenticBrowserAction({ action: "navigate", sessionId, url }) as Promise<
      Record<string, unknown>
    >;
  const refusals = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls
      .map(([line]) => String(line))
      .filter((line) =>
        line.startsWith("[EgressProxy] agentic browser: refused "),
      );

  it("browses the LAN by a name only the proxy resolves", async () => {
    const result = await navigate(`http://lan.test:${port}/`);
    expect(result).toMatchObject({ title: "LAN page", status: 200 });
  }, 60_000);

  it.each([
    [
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.169.254 — Blocked link-local/metadata address: 169.254.169.254",
    ],
    [
      "http://[::ffff:a9fe:a9fe]/",
      "http://[::ffff:a9fe:a9fe] — Blocked link-local/metadata address: ::ffff:a9fe:a9fe",
    ],
    [
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[64:ff9b::a9fe:a9fe] — Blocked link-local/metadata address: 64:ff9b::a9fe:a9fe",
    ],
    [
      "http://[fe80::1]/",
      "http://[fe80::1] — Blocked link-local/metadata address: fe80::1",
    ],
    [
      "http://meta.test/latest/meta-data/",
      "http://meta.test — Blocked: meta.test resolves to link-local/metadata address 169.254.169.254",
    ],
    [
      "http://mapped.test/",
      "http://mapped.test — Blocked: mapped.test resolves to link-local/metadata address ::ffff:a9fe:a9fe",
    ],
    [
      "https://169.254.169.254/latest/meta-data/",
      "CONNECT 169.254.169.254:443 — Blocked link-local/metadata address: 169.254.169.254",
    ],
  ])(
    "refuses a redirect to %s where it connects",
    async (target, refusal) => {
      const warn = vi.spyOn(logger, "warn");
      const result = await navigate(
        `http://lan.test:${port}/redirect?to=${encodeURIComponent(target)}`,
      );
      if (target.startsWith("https:")) {
        // Chromium shows no proxy's answer to a tunnel, only that it failed
        expect(result.error).toContain("ERR_TUNNEL_CONNECTION_FAILED");
        expect(result.error).toContain("egress proxy");
      } else {
        expect(result.status).toBe(403);
      }
      expect(refusals(warn)).toContain(
        `[EgressProxy] agentic browser: refused ${refusal}`,
      );
    },
    60_000,
  );

  it("refuses a page's own requests to link-local space", async () => {
    await navigate(`http://lan.test:${port}/`);
    const warn = vi.spyOn(logger, "warn");
    await agenticBrowserAction({
      action: "evaluate",
      sessionId,
      expression: `Promise.allSettled([
        fetch("http://169.254.169.254/latest/meta-data/", { mode: "no-cors" }),
        fetch("http://[::ffff:a9fe:a9fe]/", { mode: "no-cors" }),
        fetch("http://meta.test/", { mode: "no-cors" }),
        new Promise((done) => {
          const socket = new WebSocket("ws://169.254.169.254/");
          socket.onerror = socket.onclose = () => done(null);
        }),
      ]).then(() => "settled")`,
    });
    await vi.waitFor(
      () =>
        expect(refusals(warn)).toEqual(
          expect.arrayContaining([
            "[EgressProxy] agentic browser: refused http://169.254.169.254 — Blocked link-local/metadata address: 169.254.169.254",
            "[EgressProxy] agentic browser: refused http://[::ffff:a9fe:a9fe] — Blocked link-local/metadata address: ::ffff:a9fe:a9fe",
            "[EgressProxy] agentic browser: refused http://meta.test — Blocked: meta.test resolves to link-local/metadata address 169.254.169.254",
            "[EgressProxy] agentic browser: refused CONNECT 169.254.169.254:80 — Blocked link-local/metadata address: 169.254.169.254",
          ]),
        ),
      { timeout: 10_000 },
    );
  }, 60_000);
});
