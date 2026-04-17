import CONFIG from "../config.js";

// ═══════════════════════════════════════════════════════════════
//  Lights Data Service
//
//  HTTP client that proxies tool calls to the Lights API (port 4444).
//  The Lights service handles LIFX auth, rate limiting, and night-lock.
//  Follows the same pattern as DiscordDataService.
// ═══════════════════════════════════════════════════════════════

const TIMEOUT_MS = 10_000;

/**
 * Fetch JSON from the Lights API with timeout.
 * @param {string} method - HTTP method
 * @param {string} path - Path after base URL
 * @param {object|null} body - Request body
 * @returns {Promise<object>}
 */
async function lightsApiFetch(method, path, body = null) {
  const url = `${CONFIG.LIGHTS_API_URL}${path}`;
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody.error || `Lights API returned ${res.status}: ${res.statusText}`,
    );
  }

  return res.json();
}

const LightsDataService = {
  /**
   * List lights and their current state.
   * @param {string} [selector="all"] - LIFX selector
   * @returns {Promise<Array>} Light objects with power, color, brightness, label, group, etc.
   */
  async listLights(selector = "all") {
    const data = await lightsApiFetch("GET", `/lights/${encodeURIComponent(selector)}`);

    // Normalize the response into a clean shape for the agent
    if (!Array.isArray(data)) return data;

    return data.map((light) => ({
      id: light.id,
      label: light.label,
      power: light.power,
      brightness: light.brightness,
      color: light.color
        ? {
          hue: Math.round(light.color.hue),
          saturation: Math.round(light.color.saturation * 100) / 100,
          kelvin: light.color.kelvin,
        }
        : null,
      group: light.group?.name || null,
      location: light.location?.name || null,
      connected: light.connected,
      product: light.product?.name || null,
      effect: light.effect || null,
    }));
  },

  /**
   * Set the state of lights.
   * @param {object} opts
   * @param {string} [opts.selector="all"] - LIFX selector
   * @param {string} [opts.power] - "on" or "off"
   * @param {string} [opts.color] - LIFX color string
   * @param {number} [opts.brightness] - 0.0 to 1.0
   * @param {number} [opts.duration] - Transition seconds
   * @param {number} [opts.kelvin] - Color temperature (2500–9000)
   * @returns {Promise<object>}
   */
  async setState({ selector = "all", power, color, brightness, duration, kelvin }) {
    const body = {};
    if (power !== undefined) body.power = power;
    if (color !== undefined) body.color = color;
    if (brightness !== undefined) body.brightness = brightness;
    if (duration !== undefined) body.duration = duration;
    if (kelvin !== undefined) body.color = `kelvin:${kelvin}`;

    return lightsApiFetch("PUT", `/lights/${encodeURIComponent(selector)}/state`, body);
  },

  /**
   * Toggle power on/off.
   * @param {string} [selector="all"] - LIFX selector
   * @param {number} [duration=1] - Transition seconds
   * @returns {Promise<object>}
   */
  async togglePower(selector = "all", duration = 1) {
    return lightsApiFetch("POST", `/lights/${encodeURIComponent(selector)}/toggle`, { duration });
  },

  /**
   * Breathe effect — slowly fades between two colors.
   * @param {object} opts
   * @param {string} [opts.selector="all"]
   * @param {string} opts.color - Target color
   * @param {string} [opts.fromColor] - Starting color
   * @param {number} [opts.period=1] - Seconds per cycle
   * @param {number} [opts.cycles=1] - Number of repetitions
   * @param {boolean} [opts.persist=false] - Keep final color
   * @param {boolean} [opts.powerOn=true] - Turn on if off
   * @param {number} [opts.peak=0.5] - Peak position (0.0–1.0)
   * @returns {Promise<object>}
   */
  async breatheEffect({ selector = "all", color, fromColor, period, cycles, persist, powerOn, peak }) {
    const body = {};
    if (color !== undefined) body.color = color;
    if (fromColor !== undefined) body.fromColor = fromColor;
    if (period !== undefined) body.period = period;
    if (cycles !== undefined) body.cycles = cycles;
    if (persist !== undefined) body.persist = persist;
    if (powerOn !== undefined) body.powerOn = powerOn;
    if (peak !== undefined) body.peak = peak;

    return lightsApiFetch("POST", `/lights/${encodeURIComponent(selector)}/effects/breathe`, body);
  },

  /**
   * Pulse effect — quickly flashes between two colors.
   * @param {object} opts
   * @param {string} [opts.selector="all"]
   * @param {string} opts.color - Target color
   * @param {string} [opts.fromColor] - Starting color
   * @param {number} [opts.period=1] - Seconds per cycle
   * @param {number} [opts.cycles=1] - Number of repetitions
   * @param {boolean} [opts.persist=false] - Keep final color
   * @param {boolean} [opts.powerOn=true] - Turn on if off
   * @returns {Promise<object>}
   */
  async pulseEffect({ selector = "all", color, fromColor, period, cycles, persist, powerOn }) {
    const body = {};
    if (color !== undefined) body.color = color;
    if (fromColor !== undefined) body.fromColor = fromColor;
    if (period !== undefined) body.period = period;
    if (cycles !== undefined) body.cycles = cycles;
    if (persist !== undefined) body.persist = persist;
    if (powerOn !== undefined) body.powerOn = powerOn;

    return lightsApiFetch("POST", `/lights/${encodeURIComponent(selector)}/effects/pulse`, body);
  },

  /**
   * Stop all running effects.
   * @param {string} [selector="all"]
   * @param {boolean} [powerOff=false] - Also power off
   * @returns {Promise<object>}
   */
  async effectsOff(selector = "all", powerOff = false) {
    const body = {};
    if (powerOff) body.powerOff = true;

    return lightsApiFetch("POST", `/lights/${encodeURIComponent(selector)}/effects/off`, body);
  },

  /**
   * List all saved LIFX scenes.
   * @returns {Promise<Array>} Scene objects with uuid, name, and light states
   */
  async listScenes() {
    const data = await lightsApiFetch("GET", "/scenes");

    if (!Array.isArray(data)) return data;

    // Normalize into a clean shape
    return data.map((scene) => ({
      uuid: scene.uuid,
      name: scene.name,
      lightCount: scene.states?.length || 0,
      updatedAt: scene.updated_at,
    }));
  },

  /**
   * Activate a saved scene.
   * @param {string} sceneId - Scene UUID
   * @param {number} [duration=1] - Transition seconds
   * @param {string[]} [ignore] - Properties to skip
   * @returns {Promise<object>}
   */
  async activateScene(sceneId, duration = 1, ignore = null) {
    const body = {};
    if (duration !== undefined) body.duration = duration;
    if (ignore) body.ignore = ignore;

    return lightsApiFetch("PUT", `/scenes/${sceneId}/activate`, body);
  },

  /**
   * Get night lock status.
   * @returns {Promise<object>} { locked, lockedAt, unlockedAt }
   */
  async getNightLockStatus() {
    return lightsApiFetch("GET", "/nightlock");
  },
};

export default LightsDataService;
