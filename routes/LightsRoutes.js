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

// ─── POST /state/delta ──────────────────────────────────────────
// Set light state delta — relative adjustments to current values.

router.post("/state/delta", async (req, res) => {
  try {
    const { selector, hue, saturation, brightness, kelvin, duration } = req.body;
    const result = await LightsDataService.setStateDelta({
      selector,
      hue,
      saturation,
      brightness,
      kelvin,
      duration,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /state/delta error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── PUT /states ────────────────────────────────────────────────
// Set different states on multiple selectors in a single request.

router.put("/states", async (req, res) => {
  try {
    const { states, defaults } = req.body;
    if (!Array.isArray(states) || states.length === 0) {
      return res.status(400).json({ error: "states must be a non-empty array" });
    }
    const result = await LightsDataService.setStates(states, defaults);

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /states error:", error.message);
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

// ─── POST /effects/move ─────────────────────────────────────────
// Move effect — flowing color animation for strip products.

router.post("/effects/move", async (req, res) => {
  try {
    const { selector, direction, period, cycles, powerOn } = req.body;
    const result = await LightsDataService.moveEffect({
      selector,
      direction,
      period,
      cycles,
      powerOn,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /effects/move error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /effects/flame ────────────────────────────────────────
// Flame effect — flickering fire animation for matrix devices.

router.post("/effects/flame", async (req, res) => {
  try {
    const { selector, period, duration, powerOn } = req.body;
    const result = await LightsDataService.flameEffect({
      selector,
      period,
      duration,
      powerOn,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /effects/flame error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /effects/morph ────────────────────────────────────────
// Morph effect — continuous color-blending for matrix devices.

router.post("/effects/morph", async (req, res) => {
  try {
    const { selector, palette, period, duration, powerOn } = req.body;
    const result = await LightsDataService.morphEffect({
      selector,
      palette,
      period,
      duration,
      powerOn,
    });

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /effects/morph error:", error.message);
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

// ─── POST /nightlock ────────────────────────────────────────────
// Unified nightlock dispatcher — handles action param from tool schema.

router.post("/nightlock", async (req, res) => {
  try {
    const { action, locked } = req.body;
    let result;

    switch (action) {
      case "toggle":
        result = await LightsDataService.toggleNightLock();
        break;
      case "set":
        if (locked === undefined) {
          return res.status(400).json({ error: "locked (boolean) is required when action is 'set'" });
        }
        result = await LightsDataService.setNightLock(locked);
        break;
      case "status":
      default:
        result = await LightsDataService.getNightLockStatus();
        break;
    }

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /nightlock error:", error.message);
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

// ─── POST /nightlock/toggle ─────────────────────────────────────
// Toggle night lock on/off.

router.post("/nightlock/toggle", async (_req, res) => {
  try {
    const result = await LightsDataService.toggleNightLock();

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /nightlock/toggle error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /nightlock/set ────────────────────────────────────────
// Explicitly lock or unlock.

router.post("/nightlock/set", async (req, res) => {
  try {
    const { locked } = req.body;
    if (locked === undefined) {
      return res.status(400).json({ error: "locked (boolean) is required" });
    }
    const result = await LightsDataService.setNightLock(locked);

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /nightlock/set error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /health ────────────────────────────────────────────────
// Service health and diagnostics.

router.get("/health", async (_req, res) => {
  try {
    const result = await LightsDataService.getHealth();

    state.lastChecked = new Date();
    res.json(result);
  } catch (error) {
    state.error = error.message;
    console.error("[LightsRoutes] /health error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
