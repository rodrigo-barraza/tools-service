import { TIMEZONE_BASE_URL } from "../../constants.js";

/**
 * World Time API fetcher.
 * https://worldtimeapi.org/ — no auth, fully open.
 * Returns current time in any timezone, with offset, DST info, and abbreviation.
 */

// ─── Get Time in Timezone ──────────────────────────────────────────

/**
 * Get current time in a specific timezone.
 * @param {string} timezone - IANA timezone (e.g. "America/Vancouver", "Asia/Tokyo")
 * @returns {Promise<object>}
 */
export async function getTimeInTimezone(timezone) {
  const url = `${TIMEZONE_BASE_URL}/timezone/${encodeURIComponent(timezone)}`;
  const res = await fetch(url);

  if (res.status === 404) {
    return { found: false, timezone, message: "Timezone not found" };
  }
  if (!res.ok) {
    throw new Error(`World Time API → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    found: true,
    timezone: data.timezone,
    datetime: data.datetime,
    abbreviation: data.abbreviation,
    utcOffset: data.utc_offset,
    utcDatetime: data.utc_datetime,
    dayOfWeek: data.day_of_week,
    dayOfYear: data.day_of_year,
    weekNumber: data.week_number,
    isDst: data.dst,
    dstFrom: data.dst_from || null,
    dstUntil: data.dst_until || null,
    dstOffset: data.dst_offset || 0,
  };
}

// ─── List Timezones ────────────────────────────────────────────────

/**
 * Get all available IANA timezone identifiers.
 * @param {string} [area] - Optional area filter (e.g. "America", "Europe", "Asia")
 * @returns {Promise<string[]>}
 */
export async function listTimezones(area) {
  const path = area ? `/timezone/${encodeURIComponent(area)}` : "/timezone";
  const url = `${TIMEZONE_BASE_URL}${path}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`World Time API → ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ─── Get Time by IP ────────────────────────────────────────────────

/**
 * Get current time based on the server's public IP.
 * @returns {Promise<object>}
 */
export async function getTimeByIP() {
  const url = `${TIMEZONE_BASE_URL}/ip`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`World Time API (IP) → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    timezone: data.timezone,
    datetime: data.datetime,
    abbreviation: data.abbreviation,
    utcOffset: data.utc_offset,
    clientIp: data.client_ip,
    isDst: data.dst,
  };
}
