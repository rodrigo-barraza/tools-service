import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

// ─── Trace Context Forwarding ─────────────────────────────────────
// prism-service sends W3C trace context (`traceparent`, `tracestate`) on
// the tool calls it makes inside an OpenTelemetry span. tools-service
// records no spans of its own; it forwards that context, unchanged, on
// every outgoing `fetch` made while serving the request — as W3C Trace
// Context allows a service that does not participate — so the calls a
// tool makes stay in the caller's trace. A request without a valid
// traceparent (and anything outside a request: collectors, cron) gets
// nothing added.

interface TraceContextStore {
  traceparent: string;
  tracestate?: string;
}

const traceContextStorage = new AsyncLocalStorage<TraceContextStore>();

/** version-traceid-parentid-flags, lowercase hex (W3C Trace Context level 1). */
const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
/** What W3C asks a forwarder to propagate at least; a longer one is dropped. */
const MAX_TRACESTATE_LENGTH = 512;

/** The header if it is a valid traceparent, else null. */
export function parseTraceparent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) return null;
  const [header, version, traceId, parentId] = match;
  if (version === "ff" || /^0+$/.test(traceId) || /^0+$/.test(parentId)) return null;
  return header;
}

/** Run the request inside its caller's trace context, when it sent one. */
export function traceContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const traceparent = parseTraceparent(req.headers.traceparent);
  if (!traceparent) return next();
  const tracestate = req.headers.tracestate;
  const store: TraceContextStore = {
    traceparent,
    ...(typeof tracestate === "string" &&
      tracestate.length <= MAX_TRACESTATE_LENGTH && { tracestate }),
  };
  traceContextStorage.run(store, () => next());
}

/** The trace-context headers to forward from here, or none. */
export function forwardedTraceHeaders(): Record<string, string> {
  const store = traceContextStorage.getStore();
  if (!store) return {};
  return {
    traceparent: store.traceparent,
    ...(store.tracestate && { tracestate: store.tracestate }),
  };
}

let forwardingInstalled = false;

/**
 * Wrap the global `fetch` once so every request made while serving a
 * traced request carries its trace context. A header the caller already
 * set wins.
 */
export function installTraceContextForwarding(): void {
  if (forwardingInstalled) return;
  forwardingInstalled = true;
  const untracedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const forwarded = forwardedTraceHeaders();
    if (!forwarded.traceparent) return untracedFetch(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("traceparent")) {
      for (const [name, value] of Object.entries(forwarded)) headers.set(name, value);
    }
    return untracedFetch(input, { ...init, headers });
  };
}
