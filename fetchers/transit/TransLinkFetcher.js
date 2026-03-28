import CONFIG from "../../config.js";
import { TRANSLINK_BASE_URL } from "../../constants.js";

/**
 * TransLink RTTI API fetcher.
 * https://developer.translink.ca/ — requires free API key.
 * Returns real-time bus arrivals, stop info, and route data for Metro Vancouver.
 */

// ─── Helpers ───────────────────────────────────────────────────────

async function get(path) {
  if (!CONFIG.TRANSLINK_API_KEY) {
    throw new Error("TransLink API key not configured");
  }

  const separator = path.includes("?") ? "&" : "?";
  const url = `${TRANSLINK_BASE_URL}${path}${separator}apikey=${CONFIG.TRANSLINK_API_KEY}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`TransLink API ${path} → ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ─── Get Next Bus at Stop ──────────────────────────────────────────

/**
 * Get real-time arrival estimates for a bus stop.
 * @param {number} stopNo - 5-digit TransLink stop number
 * @param {string} [routeNo] - Optional route filter (e.g. "99")
 * @returns {Promise<object>}
 */
export async function getNextBus(stopNo, routeNo) {
  let path = `/stops/${stopNo}/estimates`;
  if (routeNo) {
    path += `?routeNo=${encodeURIComponent(routeNo)}`;
  }

  const data = await get(path);
  const estimates = Array.isArray(data) ? data : [];

  return {
    stopNo,
    count: estimates.length,
    routes: estimates.map((r) => ({
      routeNo: r.RouteNo,
      routeName: r.RouteName,
      direction: r.Direction,
      schedules: (r.Schedules || []).map((s) => ({
        expectedLeaveTime: s.ExpectedLeaveTime,
        expectedCountdown: s.ExpectedCountdown,
        scheduleStatus: s.ScheduleStatus, // "*" = on time, "-" = late, "+" = early
        cancelledTrip: s.CancelledTrip || false,
        cancelledStop: s.CancelledStop || "",
        addedTrip: s.AddedTrip || false,
        addedStop: s.AddedStop || "",
        destination: s.Destination,
      })),
    })),
  };
}

// ─── Get Stop Info ─────────────────────────────────────────────────

/**
 * Get stop details by stop number.
 * @param {number} stopNo
 * @returns {Promise<object>}
 */
export async function getStopInfo(stopNo) {
  const data = await get(`/stops/${stopNo}`);

  return {
    stopNo: data.StopNo,
    name: data.Name,
    bayNo: data.BayNo || null,
    city: data.City,
    onStreet: data.OnStreet,
    atStreet: data.AtStreet,
    latitude: data.Latitude,
    longitude: data.Longitude,
    wheelchairAccess: data.WheelchairAccess === 1,
    distance: data.Distance || null,
    routes: data.Routes
      ? String(data.Routes)
          .split(",")
          .map((r) => r.trim())
      : [],
  };
}

// ─── Find Stops Near Location ──────────────────────────────────────

/**
 * Find transit stops near a lat/lng coordinate.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radius=500] - Radius in meters (max 2000)
 * @returns {Promise<object>}
 */
export async function findStopsNearby(lat, lng, radius = 500) {
  const path = `/stops?lat=${lat}&long=${lng}&radius=${Math.min(radius, 2000)}`;
  const data = await get(path);
  const stops = Array.isArray(data) ? data : [];

  return {
    count: stops.length,
    stops: stops.slice(0, 20).map((s) => ({
      stopNo: s.StopNo,
      name: s.Name,
      city: s.City,
      onStreet: s.OnStreet,
      atStreet: s.AtStreet,
      latitude: s.Latitude,
      longitude: s.Longitude,
      distance: s.Distance,
      routes: s.Routes
        ? String(s.Routes)
            .split(",")
            .map((r) => r.trim())
        : [],
    })),
  };
}

// ─── Get Route Info ────────────────────────────────────────────────

/**
 * Get details about a specific transit route.
 * @param {string} routeNo - Route number (e.g. "99", "SkyTrain" etc.)
 * @returns {Promise<object>}
 */
export async function getRouteInfo(routeNo) {
  const data = await get(`/routes/${encodeURIComponent(routeNo)}`);

  return {
    routeNo: data.RouteNo,
    name: data.Name,
    operatingCompany: data.OperatingCompany,
    patterns: (data.Patterns || []).map((p) => ({
      patternNo: p.PatternNo,
      destination: p.Destination,
      direction: p.Direction,
      routeMap: p.RouteMap?.Href || null,
    })),
  };
}
