import express from "express";
import { fieldProjectionMiddleware } from "../middleware/FieldProjectionMiddleware.js";

/**
 * Creates a minimal Express app for in-process testing (supertest).
 * Mounts the given router at `path` with only essential middleware —
 * no MongoDB, no collectors, no cron.
 *
 * @param {string} path  - Mount point, e.g. "/market"
 * @param {Router} router - The Express router to test
 * @returns {express.Application}
 */
export function createTestApp(path, router) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(fieldProjectionMiddleware);
  app.use(path, router);
  return app;
}
