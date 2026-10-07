import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type express from "express";
import { initAgentWebSocket } from "../src/services/AgentConnectionManager.ts";

/**
 * A real tools-service HTTP server (the given app + the /ws/agent upgrade)
 * and a scripted workspace bridge that speaks the JSON-RPC protocol over a
 * real socket: tests decide what each method answers, read what it was
 * asked, and push notifications as the bridge's TaskEngine would.
 */

export async function startServer(app: express.Express): Promise<{ server: http.Server; baseUrl: string; wsUrl: string }> {
  const server = http.createServer(app);
  initAgentWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws/agent` };
}

export type RpcAnswer = (params: Record<string, unknown>, id: string) => unknown | Promise<unknown>;

export interface FakeBridge {
  agentId: string;
  name: string;
  /** Every RPC it received, in order */
  requests: Array<{ id: string; method: string; params: Record<string, unknown> }>;
  /** How it answers a method; unset methods answer `null` (task.list: []) */
  answers: Map<string, RpcAnswer>;
  notify: (method: string, params: Record<string, unknown>) => void;
  close: () => Promise<void>;
  socket: WebSocket;
}

export async function connectBridge(
  wsUrl: string,
  {
    agentId = randomUUID(),
    name = "fake-bridge",
    roots,
    auxRoots = [],
    capabilities = ["file", "git", "command", "project", "tasks", "hooks", "transcripts"],
    answers = new Map<string, RpcAnswer>(),
  }: {
    agentId?: string;
    name?: string;
    roots: string[];
    auxRoots?: string[];
    capabilities?: string[];
    answers?: Map<string, RpcAnswer>;
  },
): Promise<FakeBridge> {
  const socket = new WebSocket(wsUrl);
  const requests: FakeBridge["requests"] = [];
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  const registered = new Promise<void>((resolve) => {
    socket.on("message", async (raw) => {
      const message = JSON.parse(raw.toString()) as { id?: string; method?: string; params?: Record<string, unknown> };
      if (message.method === "agent.registered") return resolve();
      if (!message.id || !message.method) return;
      const params = message.params ?? {};
      requests.push({ id: message.id, method: message.method, params });
      const answer = answers.get(message.method);
      if (answer === undefined && message.method !== "task.list" && message.method !== "task.events") return;
      try {
        const result = answer
          ? await answer(params, message.id)
          : message.method === "task.list"
            ? []
            : { notifications: [], error: `Unknown task: ${String(params.taskId)}` };
        if (result === NO_ANSWER) return;
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      } catch (error) {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: (error as Error).message } }));
      }
    });
  });

  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "agent.register",
      params: { agentId, name, roots, auxRoots, capabilities, machineInfo: { hostname: "test" } },
    }),
  );
  await registered;

  return {
    agentId,
    name,
    requests,
    answers,
    socket,
    notify: (method, params) => socket.send(JSON.stringify({ jsonrpc: "2.0", method, params })),
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.once("close", () => resolve());
        socket.close();
      }),
  };
}

/** An answer that never comes (RPC timeouts). */
export const NO_ANSWER = Symbol("no-answer");

/** Read an SSE stream until it ends (or `limitMs`), parsing every `data:` frame. */
export async function readEvents(url: string, limitMs = 10_000): Promise<{ status: number; frames: Array<{ method: string; params: Record<string, unknown> }>; ended: boolean; comments: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  const frames: Array<{ method: string; params: Record<string, unknown> }> = [];
  let comments = 0;
  let ended = false;
  let status = 0;
  try {
    const response = await fetch(url, { signal: controller.signal });
    status = response.status;
    if (!response.ok || !response.body) return { status, frames, ended: true, comments };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      buffered += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffered.indexOf("\n\n")) !== -1) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        if (frame.startsWith(":")) comments += 1;
        else if (frame.startsWith("data: ")) frames.push(JSON.parse(frame.slice(6)));
      }
    }
  } catch {
    // Aborted at the limit: `ended` stays false
  } finally {
    clearTimeout(timer);
  }
  return { status, frames, ended, comments };
}

export const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
