import WebSocket from "ws";
import CONFIG from "../../config.js";
import {
  AIS_STREAM_WS_URL,
  AIS_STREAM_MAX_BUFFER_SIZE,
  AIS_STREAM_RECONNECT_DELAY_MS,
  AIS_STREAM_BBOX_RADIUS_DEG,
  AIS_STREAM_MESSAGE_TYPES,
} from "../../constants.js";

/**
 * AIS Stream WebSocket Fetcher.
 * https://aisstream.io/documentation
 *
 * Maintains a persistent WebSocket connection to aisstream.io,
 * streaming real-time AIS (Automatic Identification System)
 * maritime vessel data. Buffers recent messages for REST consumption.
 *
 * Requires: API key (free — register via GitHub at aisstream.io).
 * Rate limits: 1 subscription update/second, persistent WS connection.
 * Max 50 MMSI values per filter.
 */

// ─── State ─────────────────────────────────────────────────────────

/** @type {WebSocket|null} */
let socket = null;

/** @type {boolean} */
let intentionalClose = false;

/** Ring buffer of recent AIS messages */
const vesselBuffer = [];

/** Map of MMSI → latest known data (position + static merged) */
const vesselMap = new Map();

/** Connection stats */
const stats = {
  connected: false,
  lastMessageAt: null,
  messagesReceived: 0,
  reconnectCount: 0,
  lastError: null,
};

// ─── Connection Management ─────────────────────────────────────────

/**
 * Start the AIS Stream WebSocket connection.
 * Automatically subscribes to a bounding box around the configured location.
 *
 * @param {object} [options]
 * @param {number[][]} [options.boundingBoxes] - Override default bbox
 * @param {string[]} [options.mmsiFilter] - Filter by MMSI (max 50)
 * @param {string[]} [options.messageTypes] - Filter message types
 */
export function startAisStream(options = {}) {
  if (!CONFIG.AIS_STREAM_API_KEY) {
    console.warn("[AisStream] ⚠️ AIS_STREAM_API_KEY not configured, skipping");
    return;
  }

  intentionalClose = false;
  connect(options);
}

/**
 * Stop the AIS Stream WebSocket connection.
 */
export function stopAisStream() {
  intentionalClose = true;
  if (socket) {
    socket.close();
    socket = null;
  }
  stats.connected = false;
}

function connect(options = {}) {
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }

  socket = new WebSocket(AIS_STREAM_WS_URL);

  socket.onopen = () => {
    stats.connected = true;
    stats.lastError = null;
    console.log("[AisStream] ✅ WebSocket connected");

    // Build subscription message — must be sent within 3 seconds
    const subscription = buildSubscription(options);
    socket.send(JSON.stringify(subscription));
    console.log(
      `[AisStream]    Subscribed to ${subscription.BoundingBoxes.length} bounding box(es)`,
    );
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      // Check for error messages
      if (msg.error) {
        stats.lastError = msg.error;
        console.error(`[AisStream] ❌ Error: ${msg.error}`);
        return;
      }

      stats.messagesReceived++;
      stats.lastMessageAt = new Date().toISOString();

      // Process and buffer the message
      const processed = processMessage(msg);
      if (processed) {
        // Add to ring buffer
        vesselBuffer.push(processed);
        if (vesselBuffer.length > AIS_STREAM_MAX_BUFFER_SIZE) {
          vesselBuffer.shift();
        }

        // Update vessel map (latest known state per MMSI)
        const mmsi = processed.mmsi;
        if (mmsi) {
          const existing = vesselMap.get(mmsi) || {};
          vesselMap.set(mmsi, { ...existing, ...processed });
        }
      }
    } catch (err) {
      console.warn(`[AisStream] ⚠️ Parse error: ${err.message}`);
    }
  };

  socket.onerror = (err) => {
    stats.lastError = err.message || "WebSocket error";
    console.error(`[AisStream] ❌ WebSocket error: ${stats.lastError}`);
  };

  socket.onclose = () => {
    stats.connected = false;
    console.log("[AisStream] 🔌 WebSocket closed");

    if (!intentionalClose) {
      stats.reconnectCount++;
      console.log(
        `[AisStream]    Reconnecting in ${AIS_STREAM_RECONNECT_DELAY_MS / 1000}s (attempt #${stats.reconnectCount})`,
      );
      setTimeout(() => connect(options), AIS_STREAM_RECONNECT_DELAY_MS);
    }
  };
}

// ─── Subscription Builder ──────────────────────────────────────────

function buildSubscription(options) {
  const sub = {
    APIKey: CONFIG.AIS_STREAM_API_KEY,
    BoundingBoxes: options.boundingBoxes || buildDefaultBbox(),
  };

  if (options.mmsiFilter?.length) {
    sub.FiltersShipMMSI = options.mmsiFilter.slice(0, 50); // API max 50
  }

  if (options.messageTypes?.length) {
    sub.FilterMessageTypes = options.messageTypes;
  } else {
    // Default: position reports + ship static data + safety broadcasts
    sub.FilterMessageTypes = [...AIS_STREAM_MESSAGE_TYPES];
  }

  return sub;
}

function buildDefaultBbox() {
  const lat = CONFIG.LATITUDE || 0;
  const lng = CONFIG.LONGITUDE || 0;
  const r = AIS_STREAM_BBOX_RADIUS_DEG;

  return [
    [
      [lat - r, lng - r],
      [lat + r, lng + r],
    ],
  ];
}

// ─── Message Processing ────────────────────────────────────────────

function processMessage(raw) {
  const { MessageType, MetaData, Message } = raw;
  if (!MessageType || !MetaData) return null;

  const base = {
    messageType: MessageType,
    mmsi: MetaData.MMSI,
    shipName: MetaData.ShipName?.trim() || null,
    latitude: MetaData.latitude,
    longitude: MetaData.longitude,
    timestamp: MetaData.time_utc,
    receivedAt: new Date().toISOString(),
  };

  // Merge type-specific data
  const payload = Message?.[MessageType];
  if (!payload) return base;

  switch (MessageType) {
    case "PositionReport":
    case "StandardClassBPositionReport":
    case "ExtendedClassBPositionReport":
      return {
        ...base,
        cog: payload.Cog, // Course over ground (degrees)
        sog: payload.Sog, // Speed over ground (knots)
        trueHeading: payload.TrueHeading,
        navigationalStatus: payload.NavigationalStatus,
        rateOfTurn: payload.RateOfTurn,
      };

    case "ShipStaticData":
      return {
        ...base,
        imoNumber: payload.ImoNumber,
        callSign: payload.CallSign?.trim(),
        shipType: payload.Type,
        destination: payload.Destination?.trim(),
        draught: payload.MaximumStaticDraught,
        eta: payload.Eta
          ? {
              month: payload.Eta.Month,
              day: payload.Eta.Day,
              hour: payload.Eta.Hour,
              minute: payload.Eta.Minute,
            }
          : null,
        dimensions: payload.Dimension
          ? {
              a: payload.Dimension.A,
              b: payload.Dimension.B,
              c: payload.Dimension.C,
              d: payload.Dimension.D,
              lengthM: payload.Dimension.A + payload.Dimension.B,
              widthM: payload.Dimension.C + payload.Dimension.D,
            }
          : null,
      };

    case "SafetyBroadcastMessage":
      return {
        ...base,
        safetyText: payload.Text?.trim(),
      };

    case "StandardSearchAndRescueAircraftReport":
      return {
        ...base,
        altitude: payload.Altitude,
        cog: payload.Cog,
        sog: payload.Sog,
      };

    case "BaseStationReport":
      return {
        ...base,
        fixType: payload.FixType,
      };

    default:
      return base;
  }
}

// ─── Public Accessors ──────────────────────────────────────────────

/**
 * Get the latest known positions for all tracked vessels.
 * @param {number} [limit=100] - Max vessels to return
 * @returns {object[]} Array of vessel data objects
 */
export function getTrackedVessels(limit = 100) {
  const vessels = Array.from(vesselMap.values())
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
    .slice(0, limit);

  return vessels;
}

/**
 * Get a specific vessel by MMSI.
 * @param {string|number} mmsi
 * @returns {object|null}
 */
export function getVesselByMmsi(mmsi) {
  return vesselMap.get(Number(mmsi)) || null;
}

/**
 * Get recent AIS messages from the ring buffer.
 * @param {number} [limit=50] - Max messages to return
 * @param {string} [messageType] - Optional filter by message type
 * @returns {object[]}
 */
export function getRecentMessages(limit = 50, messageType = null) {
  let messages = [...vesselBuffer];
  if (messageType) {
    messages = messages.filter((m) => m.messageType === messageType);
  }
  return messages.slice(-limit);
}

/**
 * Get vessels within a bounding box from the current buffer.
 * @param {number} minLat
 * @param {number} maxLat
 * @param {number} minLng
 * @param {number} maxLng
 * @param {number} [limit=100]
 * @returns {object[]}
 */
export function getVesselsInArea(minLat, maxLat, minLng, maxLng, limit = 100) {
  return Array.from(vesselMap.values())
    .filter(
      (v) =>
        v.latitude >= minLat &&
        v.latitude <= maxLat &&
        v.longitude >= minLng &&
        v.longitude <= maxLng,
    )
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
    .slice(0, limit);
}

/**
 * Search vessels by name (case-insensitive partial match).
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {object[]}
 */
export function searchVessels(query, limit = 20) {
  const q = query.toLowerCase();
  return Array.from(vesselMap.values())
    .filter((v) => v.shipName?.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
    .slice(0, limit);
}

/**
 * Get connection stats and health info.
 * @returns {object}
 */
export function getAisStreamHealth() {
  return {
    ...stats,
    bufferSize: vesselBuffer.length,
    uniqueVessels: vesselMap.size,
    maxBufferSize: AIS_STREAM_MAX_BUFFER_SIZE,
  };
}
