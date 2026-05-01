// ============================================================
// WaybackFetcher — Internet Archive Wayback Machine API
// ============================================================
// Free API, no key required.
// Docs: https://archive.org/help/wayback_api.php
// ============================================================

const AVAILABILITY_URL = "https://archive.org/wayback/available";
const CDX_URL = "https://web.archive.org/cdx/search/cdx";

/**
 * Check if a URL has been archived and get the closest snapshot.
 * @param {string} url URL to check
 * @param {string} timestamp Optional YYYYMMDD timestamp to find closest snapshot to
 */
export async function getSnapshot(url, timestamp) {
  const params = new URLSearchParams({ url });
  if (timestamp) params.set("timestamp", timestamp);

  const res = await fetch(`${AVAILABILITY_URL}?${params}`);
  if (!res.ok) throw new Error(`Wayback API error ${res.status}`);

  const data = await res.json();
  const snap = data.archived_snapshots?.closest;

  if (!snap) {
    return {
      url,
      archived: false,
      snapshot: null,
    };
  }

  return {
    url,
    archived: true,
    snapshot: {
      url: snap.url,
      timestamp: snap.timestamp,
      date: formatWaybackTimestamp(snap.timestamp),
      status: snap.status,
      available: snap.available,
    },
  };
}

/**
 * Get snapshot history for a URL — list of archived captures.
 * @param {string} url URL to look up
 * @param {number} limit Max snapshots to return (default: 20)
 * @param {string} from Start date (YYYYMMDD)
 * @param {string} to End date (YYYYMMDD)
 */
export async function getSnapshotHistory(url, { limit = 20, from, to } = {}) {
  const params = new URLSearchParams({
    url,
    output: "json",
    limit: String(Math.min(limit, 100)),
    fl: "timestamp,statuscode,digest,length,mimetype",
    collapse: "digest", // Deduplicate identical captures
  });
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const res = await fetch(`${CDX_URL}?${params}`);
  if (!res.ok) throw new Error(`Wayback CDX API error ${res.status}`);

  const data = await res.json();
  if (!data || data.length < 2) {
    return { url, count: 0, snapshots: [] };
  }

  // First row is headers
  const headers = data[0];
  const rows = data.slice(1);

  const snapshots = rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return {
      timestamp: obj.timestamp,
      date: formatWaybackTimestamp(obj.timestamp),
      archiveUrl: `https://web.archive.org/web/${obj.timestamp}/${url}`,
      statusCode: parseInt(obj.statuscode) || null,
      mimeType: obj.mimetype,
      sizeBytes: parseInt(obj.length) || null,
    };
  });

  return {
    url,
    count: snapshots.length,
    totalCaptures: rows.length,
    oldestCapture: snapshots[0]?.date || null,
    newestCapture: snapshots[snapshots.length - 1]?.date || null,
    snapshots,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function formatWaybackTimestamp(ts) {
  if (!ts || ts.length < 8) return null;
  const y = ts.slice(0, 4);
  const m = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10) || "00";
  const min = ts.slice(10, 12) || "00";
  const s = ts.slice(12, 14) || "00";
  return `${y}-${m}-${d}T${h}:${min}:${s}Z`;
}
