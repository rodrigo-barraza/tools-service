import { Router } from "express";
import LightsDataService from "../services/LightsDataService.js";

const router = Router();

// ─── Health ─────────────────────────────────────────────────────

const state = { lastChecked: null, error: null };

export function getLightsHealth() {
  return { lastChecked: state.lastChecked, error: state.error };
}

// ─── GET /list ──────────────────────────────────────────────────
// List lights and their current state.
// Query: ?selector=all (default: all)

router.get("/list", async (req, res) => {
  try {
    const selector = req.query.selector || "all";
    const result = await LightsDataService.listLights(selector);

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /list error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /state ────────────────────────────────────────────────
// Set the state of lights (power, color, brightness, duration, kelvin).

router.post("/state", async (req, res) => {
  try {
    const { selector, power, color, brightness, duration, kelvin } = req.body;
    const result = await LightsDataService.setState({
      selector,
      power,
      color,
      brightness,
      duration,
      kelvin,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /state error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /toggle ───────────────────────────────────────────────
// Toggle power on/off.

router.post("/toggle", async (req, res) => {
  try {
    const { selector, duration } = req.body;
    const result = await LightsDataService.togglePower(selector, duration);

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /toggle error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /effects/breathe ──────────────────────────────────────
// Breathe effect — slowly fades between two colors.

router.post("/effects/breathe", async (req, res) => {
  try {
    const { selector, color, fromColor, period, cycles, persist, powerOn, peak } = req.body;
    const result = await LightsDataService.breatheEffect({
      selector,
      color,
      fromColor,
      period,
      cycles,
      persist,
      powerOn,
      peak,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /effects/breathe error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /effects/pulse ────────────────────────────────────────
// Pulse effect — quickly flashes between two colors.

router.post("/effects/pulse", async (req, res) => {
  try {
    const { selector, color, fromColor, period, cycles, persist, powerOn } = req.body;
    const result = await LightsDataService.pulseEffect({
      selector,
      color,
      fromColor,
      period,
      cycles,
      persist,
      powerOn,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /effects/pulse error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /effects/off ──────────────────────────────────────────
// Stop all running effects.

router.post("/effects/off", async (req, res) => {
  try {
    const { selector, powerOff } = req.body;
    const result = await LightsDataService.effectsOff(selector, powerOff);

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /effects/off error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /scenes ────────────────────────────────────────────────
// List all saved LIFX scenes.

router.get("/scenes", async (_req, res) => {
  try {
    const result = await LightsDataService.listScenes();

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /scenes error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /scenes/activate ──────────────────────────────────────
// Activate a saved scene.

router.post("/scenes/activate", async (req, res) => {
  try {
    const { sceneId, duration, ignore } = req.body;
    if (!sceneId) {
      return res.status(400).json({ error: "sceneId is required" });
    }
    const result = await LightsDataService.activateScene(sceneId, duration, ignore);

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /scenes/activate error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /nightlock ─────────────────────────────────────────────
// Get night lock status.

router.get("/nightlock", async (_req, res) => {
  try {
    const result = await LightsDataService.getNightLockStatus();

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /nightlock error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
