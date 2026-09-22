import { describe, it, expect, afterEach } from "vitest";
import { PassThrough } from "node:stream";

import { createDapClient, type DapClient } from "../dap/DapClient.ts";

// ── Scripted fake adapter ────────────────────────────────────
// The client is transport-agnostic: drive it over PassThrough streams with a
// hand-rolled fake adapter — no debugger process involved.

function frame(message: Record<string, unknown>): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf-8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf-8"),
    payload,
  ]);
}

interface FakeAdapter {
  input: PassThrough; // adapter → client
  output: PassThrough; // client → adapter
  requests: Array<{ seq: number; command: string; arguments?: unknown }>;
  send(message: Record<string, unknown>): void;
}

function createFakeAdapter(
  onRequest?: (
    request: { seq: number; command: string; arguments?: unknown },
    send: (message: Record<string, unknown>) => void,
  ) => void,
): FakeAdapter {
  const input = new PassThrough();
  const output = new PassThrough();
  const requests: FakeAdapter["requests"] = [];
  const send = (message: Record<string, unknown>) => input.write(frame(message));

  let buffer = Buffer.alloc(0);
  output.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const length = parseInt(
        buffer.subarray(0, headerEnd).toString().match(/Content-Length: (\d+)/)![1],
        10,
      );
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const request = JSON.parse(buffer.subarray(start, start + length).toString());
      buffer = buffer.subarray(start + length);
      requests.push(request);
      onRequest?.(request, send);
    }
  });

  return { input, output, requests, send };
}

let client: DapClient | null = null;

afterEach(() => {
  client?.dispose();
  client = null;
});

describe("DapClient protocol handling", () => {
  it("correlates responses to requests by seq", async () => {
    const adapter = createFakeAdapter((request, send) => {
      send({
        seq: 100 + request.seq,
        type: "response",
        request_seq: request.seq,
        success: true,
        command: request.command,
        body: { echoed: request.command },
      });
    });
    client = createDapClient(adapter.input, adapter.output);

    const [first, second] = await Promise.all([
      client.sendRequest("initialize", { adapterID: "fake" }),
      client.sendRequest("threads"),
    ]);

    expect(first.success).toBe(true);
    expect(first.body).toEqual({ echoed: "initialize" });
    expect(second.body).toEqual({ echoed: "threads" });
    expect(adapter.requests.map((request) => request.command)).toEqual([
      "initialize",
      "threads",
    ]);
  });

  it("parses frames split across chunk boundaries and coalesced in one chunk", async () => {
    const adapter = createFakeAdapter();
    client = createDapClient(adapter.input, adapter.output);

    const eventPromise = client.waitForEvent(["stopped"]);

    // One message split into two chunks + a second message in the same chunk
    const stopped = frame({
      seq: 1,
      type: "event",
      event: "stopped",
      body: { reason: "breakpoint", threadId: 7 },
    });
    const output = frame({
      seq: 2,
      type: "event",
      event: "output",
      body: { output: "hi\n" },
    });
    adapter.input.write(stopped.subarray(0, 20));
    adapter.input.write(Buffer.concat([stopped.subarray(20), output]));

    const stopEvent = await eventPromise;
    expect(stopEvent.event).toBe("stopped");
    expect(stopEvent.body.threadId).toBe(7);
  });

  it("buffers events that arrive before anyone waits (no race)", async () => {
    const adapter = createFakeAdapter();
    client = createDapClient(adapter.input, adapter.output);

    adapter.send({
      seq: 1,
      type: "event",
      event: "terminated",
      body: {},
    });
    // Give the stream a tick to deliver
    await new Promise((resolveTick) => setImmediate(resolveTick));

    const result = await client.waitForEvent(["stopped", "terminated"], 1_000);
    expect(result.event).toBe("terminated");
  });

  it("delivers events to onEvent handlers", async () => {
    const adapter = createFakeAdapter();
    client = createDapClient(adapter.input, adapter.output);

    const outputs: string[] = [];
    client.onEvent("output", (body) => outputs.push(body.output as string));

    adapter.send({ seq: 1, type: "event", event: "output", body: { output: "a" } });
    adapter.send({ seq: 2, type: "event", event: "output", body: { output: "b" } });
    await new Promise((resolveTick) => setImmediate(resolveTick));

    expect(outputs).toEqual(["a", "b"]);
  });

  it("rejects requests on timeout", async () => {
    const adapter = createFakeAdapter(); // never responds
    client = createDapClient(adapter.input, adapter.output);

    await expect(client.sendRequest("launch", {}, 50)).rejects.toThrow(
      /timed out/,
    );
  });

  it("rejects waitForEvent on timeout", async () => {
    const adapter = createFakeAdapter();
    client = createDapClient(adapter.input, adapter.output);

    await expect(client.waitForEvent(["stopped"], 50)).rejects.toThrow(
      /Timed out/,
    );
  });

  it("simulates a full launch handshake against the scripted adapter", async () => {
    // Script: initialize → success; launch → deferred until configurationDone;
    // setBreakpoints → verified; configurationDone → success then 'stopped'.
    let launchSeq: number | null = null;
    const adapter = createFakeAdapter((request, send) => {
      switch (request.command) {
        case "initialize":
          send({
            seq: 1000,
            type: "response",
            request_seq: request.seq,
            success: true,
            command: "initialize",
          });
          send({ seq: 1001, type: "event", event: "initialized", body: {} });
          return;
        case "launch":
          launchSeq = request.seq; // respond after configurationDone
          return;
        case "setBreakpoints":
          send({
            seq: 1002,
            type: "response",
            request_seq: request.seq,
            success: true,
            command: "setBreakpoints",
            body: { breakpoints: [{ verified: true, line: 3 }] },
          });
          return;
        case "configurationDone":
          send({
            seq: 1003,
            type: "response",
            request_seq: request.seq,
            success: true,
            command: "configurationDone",
          });
          send({
            seq: 1004,
            type: "response",
            request_seq: launchSeq!,
            success: true,
            command: "launch",
          });
          send({
            seq: 1005,
            type: "event",
            event: "stopped",
            body: { reason: "breakpoint", threadId: 1 },
          });
          return;
      }
    });
    client = createDapClient(adapter.input, adapter.output);

    await client.sendRequest("initialize", { adapterID: "fake" });
    const launchPromise = client.sendRequest("launch", { program: "/x.py" });
    await client.waitForEvent(["initialized"]);
    const breakpointsResponse = await client.sendRequest("setBreakpoints", {
      source: { path: "/x.py" },
      breakpoints: [{ line: 3 }],
    });
    expect(
      (breakpointsResponse.body?.breakpoints as Array<{ verified: boolean }> | undefined)?.[0]
        ?.verified,
    ).toBe(true);
    await client.sendRequest("configurationDone");
    await launchPromise;

    const stopEvent = await client.waitForEvent(["stopped", "terminated"]);
    expect(stopEvent.event).toBe("stopped");
    expect(stopEvent.body.reason).toBe("breakpoint");
  });
});
