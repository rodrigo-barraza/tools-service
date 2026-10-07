// ─── SSRF Guard on the Open Routes ────────────────────────────────
// The open routes that fetch a caller's URL — page metadata, HTTP
// headers, TLS certificates, feeds, web content, an animation's images
// and soundtrack — reach only public addresses. A private, loopback or
// metadata address is refused before connecting, or as its name resolves,
// and so is a redirect to one. Local servers stand in for the world: under
// the real policy they are private; with 127.0.0.1 declared public they
// show that a public URL passes and that its redirect to 127.0.0.2 does
// not.

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
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import request from "supertest";
import utilityRoutes from "../src/routes/UtilityRoutes.ts";
import knowledgeRoutes from "../src/routes/KnowledgeRoutes.ts";
import {
  addressPolicy,
  fetchPublicUrl,
} from "../src/fetchers/web/SsrfGuard.ts";
import {
  encodeAnimationVideo,
  renderAnimationFrames,
} from "../src/services/VectorAnimationRenderService.ts";
import { getSharedBrowser } from "../src/services/AgenticBrowserService.ts";
import { createTestApp } from "./testApp.ts";

// Two names this test resolves itself; every other name resolves as usual.
const TEST_HOSTS: Record<string, Array<{ address: string; family: number }>> = {
  "dual.test": [
    { address: "127.0.0.1", family: 4 },
    { address: "::1", family: 6 },
  ],
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

const PAGE =
  '<!doctype html><html><head><title>Fallback</title><meta property="og:title" content="Public page">' +
  '<meta name="description" content="Served locally"></head><body><p>Hello from the stand-in.</p></body></html>';
const FEED =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>Local feed</title><link>http://example.com</link>' +
  "<description>d</description><item><title>First</title><link>http://example.com/1</link></item>" +
  "<item><title>Second</title><link>http://example.com/2</link></item></channel></rss>";
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const hits = new Map<string, number>();
const hitsOf = (key: string) => hits.get(key) ?? 0;

const servers: http.Server[] = [];
let publicPort = 0; // 127.0.0.1
let privatePort = 0; // 127.0.0.2

function listen(handler: http.RequestListener, host: string): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, host, () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

beforeAll(async () => {
  privatePort = await listen((req, res) => {
    hits.set(`private ${req.url}`, hitsOf(`private ${req.url}`) + 1);
    res.end("an internal service");
  }, "127.0.0.2");
  publicPort = await listen((req, res) => {
    hits.set(`public ${req.url}`, hitsOf(`public ${req.url}`) + 1);
    const redirect = (location: string) => {
      res.statusCode = 302;
      res.setHeader("location", location);
      res.end();
    };
    switch (req.url) {
      case "/page":
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(PAGE);
        return;
      case "/page.gz":
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("content-encoding", "gzip");
        res.end(zlib.gzipSync(PAGE));
        return;
      case "/feed":
        res.setHeader("content-type", "application/rss+xml");
        res.end(FEED);
        return;
      case "/redirect-public":
        return redirect("/page");
      case "/redirect-private":
        return redirect(`http://127.0.0.2:${privatePort}/secret`);
      case "/redirect-metadata":
        return redirect("http://169.254.169.254/latest/meta-data/");
      default:
        res.statusCode = 404;
        res.end();
    }
  }, "127.0.0.1");
});

afterEach(() => {
  vi.restoreAllMocks();
  hits.clear();
});

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

/** 127.0.0.1 stands in for a public host; every other address stays blocked. */
function treatOneLoopbackAddressAsPublic() {
  vi.spyOn(addressPolicy, "isBlocked").mockImplementation(
    (address) => address !== "127.0.0.1",
  );
}

const utility = createTestApp("/utility", utilityRoutes);
const knowledge = createTestApp("/knowledge", knowledgeRoutes);

/** What each guarded route does with `url`. */
const ROUTES: Array<[string, (url: string) => Promise<request.Response>]> = [
  [
    "scrape/metadata",
    (url) => request(utility).get("/utility/scrape/metadata").query({ url }),
  ],
  ["headers", (url) => request(utility).get("/utility/headers").query({ url })],
  [
    "rss/feed",
    (url) => request(knowledge).get("/knowledge/rss/feed").query({ url }),
  ],
  [
    "web/content",
    (url) => request(knowledge).get("/knowledge/web/content").query({ url }),
  ],
];

function expectRefused(response: request.Response, label: string) {
  expect(response.status, label).toBeGreaterThanOrEqual(400);
  expect(response.text, label).toContain("Blocked");
}

describe("open routes refuse private, loopback and metadata addresses", () => {
  it("refuses literal addresses in every spelling, without connecting", async () => {
    for (const [name, call] of ROUTES) {
      for (const url of [
        `http://127.0.0.1:${publicPort}/page`,
        `http://[::ffff:7f00:1]:${publicPort}/page`,
        `http://[::1]:${publicPort}/page`,
        `http://0x7f.1:${publicPort}/page`,
        "http://169.254.169.254/latest/meta-data/",
        "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
        `http://192.168.1.1/admin`,
      ]) {
        expectRefused(await call(url), `${name} ${url}`);
      }
    }
    expect(hitsOf("public /page")).toBe(0);
  });

  it("refuses a name that resolves to loopback, as it connects", async () => {
    for (const [name, call] of ROUTES) {
      for (const host of ["localhost", "public.test"]) {
        expectRefused(
          await call(`http://${host}:${publicPort}/page`),
          `${name} ${host}`,
        );
      }
    }
    expect(hitsOf("public /page")).toBe(0);
  });

  it("refuses a TLS check of a private host", async () => {
    for (const host of ["127.0.0.1", "localhost", "169.254.169.254"]) {
      const response = await request(utility)
        .get(`/utility/ssl/${host}`)
        .query({ port: publicPort });
      expectRefused(response, host);
    }
  });
});

describe("open routes with a public URL", () => {
  it("fetch it, and decode it as fetch would", async () => {
    treatOneLoopbackAddressAsPublic();
    for (const path of ["/page", "/page.gz", "/redirect-public"]) {
      const response = await request(utility)
        .get("/utility/scrape/metadata")
        .query({ url: `http://127.0.0.1:${publicPort}${path}` });
      expect(response.status, path).toBe(200);
      expect(response.body).toMatchObject({
        title: "Public page",
        description: "Served locally",
      });
    }

    const headers = await request(utility)
      .get("/utility/headers")
      .query({ url: `http://127.0.0.1:${publicPort}/page` });
    expect(headers.status).toBe(200);
    expect(headers.body.contentType).toBe("text/html; charset=utf-8");

    const feed = await request(knowledge)
      .get("/knowledge/rss/feed")
      .query({ url: `http://127.0.0.1:${publicPort}/feed` });
    expect(feed.status).toBe(200);
    expect(
      feed.body.items.map((item: { title: string }) => item.title),
    ).toEqual(["First", "Second"]);

    const content = await request(knowledge)
      .get("/knowledge/web/content")
      .query({ url: `http://127.0.0.1:${publicPort}/page` });
    expect(content.status).toBe(200);
    expect(content.body.text).toContain("Hello from the stand-in.");
  });

  it("refuse its redirect to a private or metadata address", async () => {
    treatOneLoopbackAddressAsPublic();
    for (const [name, call] of ROUTES) {
      for (const path of ["/redirect-private", "/redirect-metadata"]) {
        expectRefused(
          await call(`http://127.0.0.1:${publicPort}${path}`),
          `${name} ${path}`,
        );
      }
    }
    expect(hitsOf("public /redirect-private")).toBeGreaterThan(0);
    expect(hitsOf("private /secret")).toBe(0);
  });

  it("connect to a name only through its checked address", async () => {
    treatOneLoopbackAddressAsPublic();
    const response = await fetchPublicUrl(
      `http://public.test:${publicPort}/page`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PAGE);
    expect(hitsOf("public /page")).toBe(1);
  });

  it("refuse a host when any of its addresses is private", async () => {
    // dual.test is 127.0.0.1 and ::1; ::1 is private even here
    treatOneLoopbackAddressAsPublic();
    await expect(
      fetchPublicUrl(`http://dual.test:${publicPort}/page`),
    ).rejects.toThrow(
      /Blocked: dual\.test resolves to private\/internal address ::1/,
    );
    expect(hitsOf("public /page")).toBe(0);
  });

  it("say where the redirects ended", async () => {
    treatOneLoopbackAddressAsPublic();
    const response = await fetchPublicUrl(
      `http://127.0.0.1:${publicPort}/redirect-public`,
    );
    expect(response.url).toBe(`http://127.0.0.1:${publicPort}/page`);
    expect(response.redirected).toBe(true);
    expect(await response.text()).toBe(PAGE);
  });
});

describe("the animation renderer", () => {
  afterAll(async () => {
    await (await getSharedBrowser()).close();
  });

  const probeHtml = () =>
    `<!doctype html><html><body><script>
      window.__vaReady = fetch("http://127.0.0.1:${publicPort}/probe").then(() => true, () => true);
      window.__vaRenderAt = () => "data:image/png;base64,${PIXEL}";
      window.__vaRenderDebugAt = window.__vaRenderAt;
    </script></body></html>`;

  it("loads no private address, and a public one only through the guard", async () => {
    const frames = await renderAnimationFrames(probeHtml(), [0]);
    expect(frames).toHaveLength(1);
    expect(hitsOf("public /probe")).toBe(0);

    treatOneLoopbackAddressAsPublic();
    await renderAnimationFrames(probeHtml(), [0]);
    expect(hitsOf("public /probe")).toBe(1);
  }, 60_000);

  it("fetches no soundtrack from a private address", async () => {
    await expect(
      encodeAnimationVideo(
        [Buffer.from(PIXEL, "base64")],
        1,
        "mp4",
        `http://127.0.0.1:${publicPort}/audio`,
      ),
    ).rejects.toThrow(/Blocked/);
    expect(hitsOf("public /audio")).toBe(0);
  });
});
