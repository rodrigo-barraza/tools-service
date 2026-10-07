// ─── Agent WebSocket Auth ─────────────────────────────────────────
// /ws/agent (workspace bridges) and /ws/workspace (the VS Code relay)
// answer only the agent secret — in x-api-secret, or in ?secret= from the
// standalone agent and the tray app — compared in constant time. With no
// secret configured, or the settings unreadable, every upgrade gets 503
// (clients retry); a missing or wrong secret gets 401 (clients stop).

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import express from "express";
import logger from "../src/logger.ts";
import {
  AGENT_SECRET_MIN_LENGTH,
  initAgentWebSocket,
} from "../src/services/AgentConnectionManager.ts";

const SECRET = "agent-secret-for-tests-0123456789";
const PATHS = ["/ws/agent", "/ws/workspace"];

const servers: http.Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function serve(
  resolveSecret: () => Promise<string | undefined>,
): Promise<string> {
  const server = http.createServer(express());
  initAgentWebSocket(server, { resolveSecret });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  servers.push(server);
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The upgrade's outcome: "open", or the HTTP status that refused it. */
function attempt(
  url: string,
  headers: Record<string, string> = {},
): Promise<number | "open"> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => {
      socket.close();
      resolve("open");
    });
    socket.once("unexpected-response", (request, response) => {
      resolve(response.statusCode ?? 0);
      request.destroy();
    });
    socket.once("error", (error) => reject(error));
  });
}

describe("agent WebSocket auth", () => {
  it("refuses every upgrade while no secret is configured", async () => {
    const base = await serve(async () => undefined);
    for (const path of PATHS) {
      expect(await attempt(`${base}${path}`)).toBe(503);
      expect(await attempt(`${base}${path}`, { "x-api-secret": "" })).toBe(503);
      expect(await attempt(`${base}${path}?secret=undefined`)).toBe(503);
    }
  });

  it("refuses every upgrade while the settings cannot be read", async () => {
    const base = await serve(async () => {
      throw new Error("settings unreadable");
    });
    expect(await attempt(`${base}/ws/agent`, { "x-api-secret": SECRET })).toBe(
      503,
    );
  });

  it("refuses a missing or wrong secret with 401", async () => {
    const base = await serve(async () => SECRET);
    for (const path of PATHS) {
      expect(await attempt(`${base}${path}`)).toBe(401);
      expect(await attempt(`${base}${path}`, { "x-api-secret": "wrong" })).toBe(
        401,
      );
      expect(
        await attempt(`${base}${path}`, {
          "x-api-secret": SECRET.slice(0, -1),
        }),
      ).toBe(401);
      expect(await attempt(`${base}${path}?secret=wrong`)).toBe(401);
      // The header wins over the query parameter.
      expect(
        await attempt(`${base}${path}?secret=${SECRET}`, {
          "x-api-secret": "wrong",
        }),
      ).toBe(401);
    }
  });

  it("upgrades with the secret, in the header or in ?secret=", async () => {
    const base = await serve(async () => SECRET);
    for (const path of PATHS) {
      expect(await attempt(`${base}${path}`, { "x-api-secret": SECRET })).toBe(
        "open",
      );
      expect(
        await attempt(`${base}${path}?secret=${encodeURIComponent(SECRET)}`),
      ).toBe("open");
    }
  });

  it("refuses paths that are not its own", async () => {
    const base = await serve(async () => SECRET);
    expect(await attempt(`${base}/ws/other`, { "x-api-secret": SECRET })).toBe(
      404,
    );
  });

  it("warns once about a short secret, and never about a long one", async () => {
    const warn = vi.spyOn(logger, "warn");
    const short = "abc123";
    const base = await serve(async () => short);
    expect(await attempt(`${base}/ws/agent`, { "x-api-secret": short })).toBe(
      "open",
    );
    expect(await attempt(`${base}/ws/agent`, { "x-api-secret": short })).toBe(
      "open",
    );
    const warnings = warn.mock.calls.filter(([message]) =>
      String(message).includes("rotate it"),
    );
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain("6 characters");

    warn.mockClear();
    const long = "x".repeat(AGENT_SECRET_MIN_LENGTH);
    const longBase = await serve(async () => long);
    expect(
      await attempt(`${longBase}/ws/agent`, { "x-api-secret": long }),
    ).toBe("open");
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).includes("rotate it"),
      ),
    ).toEqual([]);
  });
});
