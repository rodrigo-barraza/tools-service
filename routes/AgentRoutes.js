// ============================================================
// Agent Routes — Workspace Agent Status Endpoints
// ============================================================

import { Router } from "express";
import { getConnectedAgents } from "../services/AgentConnectionManager.js";

const router = Router();

/**
 * GET /agents — List all connected workspace agents.
 */
router.get("/", (_req, res) => {
  const agents = getConnectedAgents();
  res.json({
    count: agents.length,
    agents,
  });
});

/**
 * GET /agents/:id — Get a specific agent's details.
 */
router.get("/:id", (req, res) => {
  const agents = getConnectedAgents();
  const agent = agents.find((a) => a.id === req.params.id);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }
  res.json(agent);
});

export default router;
