// ─── Chart Rendering (ECharts SSR) ───────────────────────────
// Apache ECharts server-side SVG rendering (no headless browser, no native
// canvas: https://apache.github.io/echarts-handbook/en/how-to/cross-platform/server/)
// rasterized to PNG via sharp. Replaces chartjs-node-canvas and widens the
// catalog from bar/line/pie to scatter, area, stacked, radar, heatmap,
// candlestick, and funnel — all reusing the same {labels, datasets} contract
// so the iterative chartId merge keeps working unchanged.

import { MILLISECONDS_PER_HOUR } from "@rodrigo-barraza/utilities-library";
import * as echarts from "echarts";
import sharp from "sharp";
import type { ChartConfig, ChartDataset } from "../types/chart.ts";
import { PersistentStore } from "../models/EmbedAsset.ts";

// ─── Constants ─────────────────────────────────────────────────

const CHART_WIDTH = 900;
const CHART_HEIGHT = 500;

export const VALID_CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "area",
  "scatter",
  "radar",
  "heatmap",
  "candlestick",
  "funnel",
  "stacked_bar",
  "stacked_area",
  "horizontal_bar",
] as const;
export type ChartType = (typeof VALID_CHART_TYPES)[number];

// Charts whose datasets carry per-point ARRAYS instead of numbers
const ARRAY_DATA_TYPES = new Set(["scatter", "candlestick"]);
// Charts where dataset.data length must equal labels length
const LABEL_ALIGNED_TYPES = new Set([
  "bar",
  "line",
  "area",
  "radar",
  "heatmap",
  "candlestick",
  "stacked_bar",
  "stacked_area",
  "horizontal_bar",
]);

// ─── Persistent Chart Store ────────────────────────────────────

const chartStore = new PersistentStore<ChartConfig>("chart", MILLISECONDS_PER_HOUR);

export function storeChart(chartConfig: ChartConfig): string {
  return chartStore.set(chartConfig);
}

/** Store or replace a chart under a stable ID — used by iterative chart building. */
export function storeChartWithId(id: string, chartConfig: ChartConfig): void {
  chartStore.setWithId(id, chartConfig);
}

export async function getStoredChart(id: string): Promise<ChartConfig | null> {
  return chartStore.getWithFallback(id);
}

// ─── Color Palette (kept from the Chart.js era) ────────────────

const PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#a855f7", // purple
  "#14b8a6", // teal
  "#fb7185", // pink
  "#22c55e", // green
  "#eab308", // yellow
  "#ef4444", // red
  "#06b6d4", // cyan
];

function seriesColor(dataset: ChartDataset, index: number): string {
  const explicit = dataset.backgroundColor ?? dataset.borderColor;
  if (typeof explicit === "string") return explicit;
  return PALETTE[index % PALETTE.length];
}

// ─── Validation ────────────────────────────────────────────────

/**
 * Validate the data shape for a chart type. Returns an error message for
 * the route to 400 with, or null when valid. Kept here so shape rules live
 * beside the renderers that depend on them.
 */
export function validateChartData(
  type: string,
  labels: string[],
  datasets: ChartDataset[],
): string | null {
  if (type === "candlestick") {
    if (datasets.length !== 1) {
      return "'candlestick' supports exactly one dataset (an array of [open, close, low, high] entries)";
    }
  }
  if (ARRAY_DATA_TYPES.has(type)) {
    const expectedLength = type === "candlestick" ? 4 : 2;
    const shapeName =
      type === "candlestick" ? "[open, close, low, high]" : "[x, y]";
    for (const dataset of datasets) {
      for (const point of dataset.data) {
        if (
          !Array.isArray(point) ||
          point.length !== expectedLength ||
          point.some((value) => typeof value !== "number")
        ) {
          return `'${type}' data points must be ${shapeName} number arrays (dataset '${dataset.label ?? "?"}')`;
        }
      }
    }
  } else {
    for (const dataset of datasets) {
      if (dataset.data.some((value) => typeof value !== "number")) {
        return `'${type}' data points must be plain numbers (dataset '${dataset.label ?? "?"}')`;
      }
    }
  }
  if (LABEL_ALIGNED_TYPES.has(type)) {
    for (const dataset of datasets) {
      if (dataset.data.length !== labels.length) {
        return `Dataset '${dataset.label ?? "?"}' has ${dataset.data.length} data points but there are ${labels.length} labels. These must match for '${type}' charts.`;
      }
    }
  }
  return null;
}

// ─── Option Builders ───────────────────────────────────────────

const TITLE_STYLE = {
  left: "center" as const,
  textStyle: { color: "#1e293b", fontSize: 18, fontWeight: 600 as const },
};
const AXIS_STYLE = {
  axisLabel: { color: "#64748b", fontSize: 11 },
  axisLine: { lineStyle: { color: "rgba(100,116,139,0.35)" } },
  splitLine: { lineStyle: { color: "rgba(100,116,139,0.15)" } },
};

function buildOption(chartConfig: ChartConfig): echarts.EChartsOption {
  // `options` is intentionally not read: the old Chart.js options bag doesn't
  // map to ECharts. The field is still stored for back-compat but no longer
  // alters rendering.
  const { type, title, labels, datasets } = chartConfig;

  const base: echarts.EChartsOption = {
    backgroundColor: "#ffffff",
    color: PALETTE,
    ...(title && { title: { text: title, ...TITLE_STYLE } }),
    legend:
      type === "pie" || type === "funnel" || datasets.length > 1
        ? {
            bottom: 8,
            textStyle: { color: "#334155", fontSize: 12 },
            icon: "circle",
          }
        : undefined,
  };
  const grid = { left: 60, right: 40, top: title ? 64 : 40, bottom: datasets.length > 1 ? 64 : 48 };

  switch (type as ChartType) {
    case "pie":
    case "funnel": {
      const slices = labels.map((label, index) => ({
        name: label,
        value: (datasets[0]?.data[index] as number) ?? 0,
      }));
      return {
        ...base,
        series: [
          type === "pie"
            ? { type: "pie", radius: "62%", center: ["50%", "52%"], data: slices, label: { color: "#334155" } }
            : { type: "funnel", left: "12%", width: "76%", top: title ? 64 : 40, bottom: 48, data: slices, label: { color: "#334155" } },
        ],
      };
    }

    case "scatter":
      return {
        ...base,
        grid,
        xAxis: { type: "value", ...AXIS_STYLE },
        yAxis: { type: "value", ...AXIS_STYLE },
        series: datasets.map((dataset, index) => ({
          type: "scatter",
          name: dataset.label,
          data: dataset.data as unknown as number[][],
          symbolSize: 10,
          itemStyle: { color: seriesColor(dataset, index), opacity: 0.85 },
        })),
      };

    case "radar":
      return {
        ...base,
        radar: {
          indicator: labels.map((label) => ({ name: label })),
          axisName: { color: "#334155" },
        },
        series: [
          {
            type: "radar",
            data: datasets.map((dataset, index) => ({
              name: dataset.label,
              value: dataset.data as number[],
              areaStyle: { opacity: 0.15 },
              itemStyle: { color: seriesColor(dataset, index) },
            })),
          },
        ],
      };

    case "heatmap": {
      // Rows-as-datasets: x = labels, y = dataset labels, cell = data[x]
      const cells: Array<[number, number, number]> = [];
      let min = Infinity;
      let max = -Infinity;
      datasets.forEach((dataset, rowIndex) => {
        (dataset.data as number[]).forEach((value, columnIndex) => {
          cells.push([columnIndex, rowIndex, value]);
          if (value < min) min = value;
          if (value > max) max = value;
        });
      });
      if (!Number.isFinite(min)) {
        min = 0;
        max = 1;
      }
      return {
        ...base,
        grid: { ...grid, bottom: 88 },
        xAxis: { type: "category", data: labels, ...AXIS_STYLE },
        yAxis: {
          type: "category",
          data: datasets.map((dataset, index) => dataset.label ?? `Row ${index + 1}`),
          ...AXIS_STYLE,
        },
        visualMap: {
          min,
          max: max === min ? min + 1 : max,
          orient: "horizontal",
          left: "center",
          bottom: 8,
          inRange: { color: ["#dbeafe", "#6366f1", "#312e81"] },
          textStyle: { color: "#334155" },
        },
        series: [
          {
            type: "heatmap",
            data: cells,
            label: { show: cells.length <= 80, color: "#0f172a" },
          },
        ],
      };
    }

    case "candlestick":
      return {
        ...base,
        grid,
        xAxis: { type: "category", data: labels, ...AXIS_STYLE },
        yAxis: { type: "value", scale: true, ...AXIS_STYLE },
        series: [
          {
            type: "candlestick",
            name: datasets[0]?.label,
            data: datasets[0]?.data as unknown as number[][],
            itemStyle: {
              color: "#10b981",
              color0: "#f43f5e",
              borderColor: "#059669",
              borderColor0: "#e11d48",
            },
          },
        ],
      };

    // Axis family: bar / line and their variants
    default: {
      const horizontal = type === "horizontal_bar";
      const stacked = type === "stacked_bar" || type === "stacked_area";
      const isLine = type === "line" || type === "area" || type === "stacked_area";
      const filled = type === "area" || type === "stacked_area";

      const categoryAxis = { type: "category" as const, data: labels, ...AXIS_STYLE };
      const valueAxis = { type: "value" as const, ...AXIS_STYLE };

      return {
        ...base,
        grid,
        xAxis: horizontal ? valueAxis : categoryAxis,
        yAxis: horizontal ? categoryAxis : valueAxis,
        series: datasets.map((dataset, index) => {
          const color = seriesColor(dataset, index);
          return isLine
            ? {
                type: "line" as const,
                name: dataset.label,
                data: dataset.data as number[],
                smooth: 0.35,
                symbolSize: 8,
                lineStyle: { width: 2.5, color },
                itemStyle: { color },
                ...(filled && { areaStyle: { opacity: 0.3, color } }),
                ...(stacked && { stack: "total" }),
              }
            : {
                type: "bar" as const,
                name: dataset.label,
                data: dataset.data as number[],
                itemStyle: { color, opacity: 0.85, borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] },
                ...(stacked && { stack: "total" }),
              };
        }),
      };
    }
  }
}

// ─── PNG Renderer ──────────────────────────────────────────────

/**
 * Render a chart config to a PNG buffer (ECharts SSR SVG → sharp).
 */
export async function renderChartPng(chartConfig: ChartConfig) {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  });
  try {
    chart.setOption(buildOption(chartConfig));
    const svg = chart.renderToSVGString();
    return await sharp(Buffer.from(svg)).png().toBuffer();
  } finally {
    chart.dispose();
  }
}
