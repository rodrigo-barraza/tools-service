// ============================================================
// Chart Service — Server-Side PNG Chart Rendering
// ============================================================
// Uses chartjs-node-canvas to render Chart.js charts as PNG
// buffers server-side. Returns image/png so markdown ![](url)
// embeds work correctly.
// ============================================================

import crypto from "node:crypto";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";

// ─── Renderer Singleton ────────────────────────────────────────

const CHART_WIDTH = 900;
const CHART_HEIGHT = 500;

const renderer = new ChartJSNodeCanvas({
  width: CHART_WIDTH,
  height: CHART_HEIGHT,
  backgroundColour: "#0f172a",
});

// ─── In-Memory Store ───────────────────────────────────────────

const CHART_STORE = new Map();
const CHART_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Store chart config and return a short ID.
 * @param {object} chartConfig - { type, title, labels, datasets, options }
 * @returns {string} Short UUID key
 */
export function storeChart(chartConfig) {
  const id = crypto.randomUUID().slice(0, 12);
  CHART_STORE.set(id, { config: chartConfig, createdAt: Date.now() });

  // Lazy cleanup when store gets large
  if (CHART_STORE.size > 200) {
    const now = Date.now();
    for (const [k, v] of CHART_STORE) {
      if (now - v.createdAt > CHART_TTL_MS) CHART_STORE.delete(k);
    }
  }
  return id;
}

/**
 * Retrieve a stored chart config by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getStoredChart(id) {
  const entry = CHART_STORE.get(id);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CHART_TTL_MS) {
    CHART_STORE.delete(id);
    return null;
  }
  return entry.config;
}

// ─── Color Palette ─────────────────────────────────────────────

const PALETTE = [
  "rgba(99, 102, 241, 0.85)",   // indigo
  "rgba(16, 185, 129, 0.85)",   // emerald
  "rgba(244, 63, 94, 0.85)",    // rose
  "rgba(245, 158, 11, 0.85)",   // amber
  "rgba(59, 130, 246, 0.85)",   // blue
  "rgba(168, 85, 247, 0.85)",   // purple
  "rgba(20, 184, 166, 0.85)",   // teal
  "rgba(251, 113, 133, 0.85)",  // pink
  "rgba(34, 197, 94, 0.85)",    // green
  "rgba(234, 179, 8, 0.85)",    // yellow
  "rgba(239, 68, 68, 0.85)",    // red
  "rgba(6, 182, 212, 0.85)",    // cyan
];

const PALETTE_BORDER = PALETTE.map((c) => c.replace("0.85", "1"));

/**
 * Assign colors to datasets that don't have explicit colors.
 */
function assignColors(datasets, chartType) {
  return datasets.map((ds, i) => {
    if (chartType === "pie") {
      // Pie charts need per-slice colors on the single dataset
      const count = ds.data?.length || 0;
      return {
        ...ds,
        backgroundColor:
          ds.backgroundColor || Array.from({ length: count }, (_, j) => PALETTE[j % PALETTE.length]),
        borderColor:
          ds.borderColor || Array.from({ length: count }, (_, j) => PALETTE_BORDER[j % PALETTE_BORDER.length]),
        borderWidth: ds.borderWidth ?? 2,
      };
    }

    // Bar & Line — one color per dataset
    const bg = PALETTE[i % PALETTE.length];
    const border = PALETTE_BORDER[i % PALETTE_BORDER.length];

    return {
      ...ds,
      backgroundColor: ds.backgroundColor || bg,
      borderColor: ds.borderColor || border,
      borderWidth: ds.borderWidth ?? 2,
      ...(chartType === "line"
        ? {
            tension: ds.tension ?? 0.35,
            fill: ds.fill ?? false,
            pointRadius: ds.pointRadius ?? 4,
            pointHoverRadius: ds.pointHoverRadius ?? 6,
          }
        : {
            borderRadius: ds.borderRadius ?? 6,
          }),
    };
  });
}

// ─── PNG Renderer ──────────────────────────────────────────────

/**
 * Render a chart config to a PNG buffer.
 * @param {object} chartConfig - { type, title, labels, datasets, options }
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderChartPng(chartConfig) {
  const { type, title, labels, datasets, options = {} } = chartConfig;

  const coloredDatasets = assignColors(datasets, type);

  const config = {
    type,
    data: {
      labels,
      datasets: coloredDatasets,
    },
    options: {
      responsive: false,
      animation: false, // no animation for server-side render
      plugins: {
        title: {
          display: !!title,
          text: title || "",
          color: "#e2e8f0",
          font: { size: 18, weight: "600", family: "sans-serif" },
          padding: { top: 16, bottom: 24 },
        },
        legend: {
          display: type === "pie" || (datasets.length > 1),
          labels: {
            color: "#cbd5e1",
            font: { size: 12, family: "sans-serif" },
            usePointStyle: true,
            padding: 16,
          },
        },
      },
      ...(type !== "pie" && {
        scales: {
          x: {
            ticks: { color: "#94a3b8", font: { size: 11 } },
            grid: { color: "rgba(148, 163, 184, 0.12)" },
            border: { color: "rgba(148, 163, 184, 0.2)" },
          },
          y: {
            ticks: { color: "#94a3b8", font: { size: 11 } },
            grid: { color: "rgba(148, 163, 184, 0.12)" },
            border: { color: "rgba(148, 163, 184, 0.2)" },
            beginAtZero: options.beginAtZero !== false,
          },
        },
      }),
      ...options,
    },
  };

  return renderer.renderToBuffer(config);
}
