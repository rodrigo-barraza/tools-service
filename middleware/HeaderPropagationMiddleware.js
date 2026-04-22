/**
 * HeaderPropagationMiddleware — attaches identity headers to the request object.
 *
 * Reads x-project, x-username, and x-workspace-id from incoming headers and
 * attaches them to `req` so route handlers and services can access them without
 * re-parsing headers on every call.
 *
 * Mirrors Prism's AuthMiddleware pattern.
 */
export function headerPropagationMiddleware(req, res, next) {
  // Project: from query param, body, or x-project header
  req.project = req.query?.project || req.body?.project || req.headers["x-project"] || "default";

  // Username: from x-username header
  req.username = req.headers["x-username"] || "anonymous";

  // Workspace ID: optional — null means the default workspace
  req.workspaceId = req.headers["x-workspace-id"] || null;

  next();
}
