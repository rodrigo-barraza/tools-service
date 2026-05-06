const PLASMA_URL =
  "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json";
const MAG_URL =
  "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json";

import { MS_PER_DAY } from "@rodrigo-barraza/utilities-library";

function parseRows(rows, fields) {
  // First row is header, skip it
  const data = rows.slice(1);
  const cutoff = Date.now() - MS_PER_DAY;

  return data
    .map((row) => {
      const time = new Date(row[0] + "Z").getTime();
      if (isNaN(time) || time < cutoff) return null;
      const obj = { time: row[0] };
      fields.forEach((f, i) => {
        const val = parseFloat(row[i + 1]);
        obj[f] = isNaN(val) ? null : val;
      });
      return obj;
    })
    .filter(Boolean);
}

function downsample(arr, intervalMinutes) {
  if (arr.length === 0) return arr;
  const result = [];
  let lastBucket = null;

  for (const point of arr) {
    const t = new Date(point.time + "Z").getTime();
    const bucket = Math.floor(t / (intervalMinutes * 60_000));
    if (bucket !== lastBucket) {
      result.push(point);
      lastBucket = bucket;
    }
  }
  return result;
}

/**
 * Fetch solar wind plasma + magnetic field data from NOAA SWPC.
 * Returns the last 24h downsampled to 5-minute intervals.
 */
export async function fetchSolarWind() {
  const [plasmaRes, magRes] = await Promise.all([
    fetch(PLASMA_URL),
    fetch(MAG_URL),
  ]);

  if (!plasmaRes.ok)
    throw new Error(`SWPC Plasma ${plasmaRes.status}: ${plasmaRes.statusText}`);
  if (!magRes.ok)
    throw new Error(`SWPC Mag ${magRes.status}: ${magRes.statusText}`);

  const plasmaJson = await plasmaRes.json();
  const magJson = await magRes.json();

  const plasmaFields = ["density", "speed", "temperature"];
  const magFields = ["bx", "by", "bz", "lonGsm", "latGsm", "bt"];

  const plasma = downsample(parseRows(plasmaJson, plasmaFields), 5);
  const magnetic = downsample(parseRows(magJson, magFields), 5);

  const latestPlasma = plasma[plasma.length - 1] || {};
  const latestMag = magnetic[magnetic.length - 1] || {};

  return {
    plasma,
    magnetic,
    latest: {
      time: latestPlasma.time || latestMag.time || null,
      speed: latestPlasma.speed ?? null,
      density: latestPlasma.density ?? null,
      temperature: latestPlasma.temperature ?? null,
      bz: latestMag.bz ?? null,
      bt: latestMag.bt ?? null,
      bx: latestMag.bx ?? null,
      by: latestMag.by ?? null,
    },
    counts: {
      plasma: plasma.length,
      magnetic: magnetic.length,
    },
  };
}
