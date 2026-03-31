// ============================================================
// Chart Service — Embeddable Chart.js Charts
// ============================================================
// Generates self-contained HTML pages with Chart.js (via CDN)
// for bar, line, and pie charts. Uses an in-memory store with
// TTL identical to the map embed pattern.
// ============================================================

import crypto from "node:crypto";

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

// ─── HTML Builder ──────────────────────────────────────────────

/**
 * Build a self-contained HTML page for a Chart.js chart.
 * @param {object} chartConfig - { type, title, labels, datasets, options }
 * @returns {string} Complete HTML document
 */
export function buildChartEmbedHtml(chartConfig) {
  const { type, title, labels, datasets, options = {} } = chartConfig;

  const coloredDatasets = assignColors(datasets, type);

  const chartJsConfig = {
    type,
    data: {
      labels,
      datasets: coloredDatasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: "easeOutQuart",
      },
      plugins: {
        title: {
          display: !!title,
          text: title || "",
          color: "#e2e8f0",
          font: { size: 18, weight: "600", family: "'Inter', system-ui, sans-serif" },
          padding: { top: 12, bottom: 20 },
        },
        legend: {
          display: type === "pie" || (datasets.length > 1),
          labels: {
            color: "#cbd5e1",
            font: { size: 12, family: "'Inter', system-ui, sans-serif" },
            usePointStyle: true,
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.9)",
          titleColor: "#f1f5f9",
          bodyColor: "#cbd5e1",
          borderColor: "rgba(99, 102, 241, 0.3)",
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
          titleFont: { size: 13, weight: "600" },
          bodyFont: { size: 12 },
        },
      },
      ...(type !== "pie" && {
        scales: {
          x: {
            ticks: { color: "#94a3b8", font: { size: 11 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            border: { color: "rgba(148, 163, 184, 0.15)" },
          },
          y: {
            ticks: { color: "#94a3b8", font: { size: 11 } },
            grid: { color: "rgba(148, 163, 184, 0.08)" },
            border: { color: "rgba(148, 163, 184, 0.15)" },
            beginAtZero: options.beginAtZero !== false,
          },
        },
      }),
      ...options,
    },
  };

  const configJson = JSON.stringify(chartJsConfig);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{
    width:100%;height:100%;
    background:#0f172a;
    font-family:'Inter',system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;
  }
  .chart-wrap{
    position:relative;
    width:calc(100% - 32px);
    height:calc(100% - 32px);
    max-width:900px;
    max-height:600px;
    padding:16px;
    background:rgba(30,41,59,0.6);
    border:1px solid rgba(99,102,241,0.15);
    border-radius:16px;
    backdrop-filter:blur(12px);
    box-shadow:0 8px 32px rgba(0,0,0,0.3);
  }
  canvas{width:100%!important;height:100%!important}
</style>
</head>
<body>
<div class="chart-wrap">
  <canvas id="chart"></canvas>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
  const ctx=document.getElementById('chart').getContext('2d');
  new Chart(ctx,${configJson});
</script>
</body></html>`;
}
