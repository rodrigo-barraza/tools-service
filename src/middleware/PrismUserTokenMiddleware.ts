import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

// ─── Prism User Token ─────────────────────────────────────────────
// During a signed-in user's turn, prism-service's calls here carry a
// short-lived user token in x-prism-user-token beside the service secret.
// A call back into prism-service made while serving such a request
// (scheduled tasks, memories, custom agents, images and speech) then speaks
// as that user — `Authorization: Bearer <token>` instead of the service
// secret (prismServiceAuthHeaders) — so the turn keeps its identity.
//
// The token lives only in this request-scoped store. It is taken off the
// request as it arrives, so no logger, handler or proxy downstream ever
// sees it, and it travels only to prism-service, and back into this
// service when the MCP adapter runs a tool for the same turn.

export const PRISM_USER_TOKEN_HEADER = "x-prism-user-token";

const userTokenStorage = new AsyncLocalStorage<string | null>();

/** The user token of the request being served, when prism-service sent one. */
export function currentPrismUserToken(): string | null {
  return userTokenStorage.getStore() ?? null;
}

/** Serve the rest of the request with its user token, and remove it from the request. */
export function prismUserTokenMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const sent = req.headers[PRISM_USER_TOKEN_HEADER];
  const token = typeof sent === "string" && sent.trim() ? sent.trim() : null;
  delete req.headers[PRISM_USER_TOKEN_HEADER];
  for (let index = req.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (req.rawHeaders[index].toLowerCase() === PRISM_USER_TOKEN_HEADER) {
      req.rawHeaders.splice(index, 2);
    }
  }
  userTokenStorage.run(token, () => next());
}

/** The token for this service's own routes (the MCP adapter's self-calls). */
export function prismUserTokenHeaders(): Record<string, string> {
  const token = currentPrismUserToken();
  return token ? { [PRISM_USER_TOKEN_HEADER]: token } : {};
}
