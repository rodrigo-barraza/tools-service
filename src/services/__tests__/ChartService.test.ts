import { describe, it, expect } from "vitest";
import {
  renderChartPng,
  storeChart,
  getStoredChart,
} from "../ChartService.ts";
import type { ChartConfig } from "../../types/chart.ts";

// ═══════════════════════════════════════════════════════════════
//  renderChartPng — PNG Generation
// ═══════════════════════════════════════════════════════════════

describe("renderChartPng", () => {
  it("renders a bar chart to a PNG buffer", async () => {
    const chartConfig: ChartConfig = {
      type: "bar",
      title: "Monthly Revenue",
      labels: ["Jan", "Feb", "Mar", "Apr"],
      datasets: [
        {
          label: "Revenue",
          data: [1200, 1900, 3000, 2500],
        },
      ],
    };

    const pngBuffer = await renderChartPng(chartConfig);
    expect(pngBuffer).toBeInstanceOf(Buffer);
    expect(pngBuffer.length).toBeGreaterThan(1000);
    // Verify PNG magic bytes
    expect(pngBuffer[0]).toBe(0x89);
    expect(pngBuffer[1]).toBe(0x50); // P
    expect(pngBuffer[2]).toBe(0x4e); // N
    expect(pngBuffer[3]).toBe(0x47); // G
  });

  it("renders a line chart with multiple datasets", async () => {
    const chartConfig: ChartConfig = {
      type: "line",
      title: "Temperature Comparison",
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      datasets: [
        { label: "City A", data: [20, 22, 19, 25, 23] },
        { label: "City B", data: [15, 17, 14, 20, 18] },
      ],
    };

    const pngBuffer = await renderChartPng(chartConfig);
    expect(pngBuffer).toBeInstanceOf(Buffer);
    expect(pngBuffer.length).toBeGreaterThan(1000);
  });

  it("renders a pie chart", async () => {
    const chartConfig: ChartConfig = {
      type: "pie",
      title: "Market Share",
      labels: ["Chrome", "Firefox", "Safari", "Edge"],
      datasets: [
        {
          label: "Share",
          data: [65, 12, 18, 5],
        },
      ],
    };

    const pngBuffer = await renderChartPng(chartConfig);
    expect(pngBuffer).toBeInstanceOf(Buffer);
    expect(pngBuffer.length).toBeGreaterThan(1000);
  });

  it("renders a chart without title", async () => {
    const chartConfig: ChartConfig = {
      type: "bar",
      labels: ["A", "B", "C"],
      datasets: [{ label: "Values", data: [10, 20, 30] }],
    };

    const pngBuffer = await renderChartPng(chartConfig);
    expect(pngBuffer).toBeInstanceOf(Buffer);
    expect(pngBuffer.length).toBeGreaterThan(500);
  });

  it("respects custom colors on datasets", async () => {
    const chartConfig: ChartConfig = {
      type: "bar",
      labels: ["X", "Y"],
      datasets: [
        {
          label: "Custom",
          data: [5, 10],
          backgroundColor: "rgba(255, 0, 0, 0.5)",
          borderColor: "rgba(255, 0, 0, 1)",
        },
      ],
    };

    const pngBuffer = await renderChartPng(chartConfig);
    expect(pngBuffer).toBeInstanceOf(Buffer);
    expect(pngBuffer.length).toBeGreaterThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Chart Store — Ephemeral Persistence
// ═══════════════════════════════════════════════════════════════

describe("storeChart / getStoredChart", () => {
  it("stores a chart config and retrieves it by ID", async () => {
    const chartConfig: ChartConfig = {
      type: "bar",
      labels: ["A", "B"],
      datasets: [{ label: "Test", data: [1, 2] }],
    };

    const chartId = storeChart(chartConfig);
    expect(typeof chartId).toBe("string");
    expect(chartId.length).toBeGreaterThan(0);

    const retrieved = await getStoredChart(chartId);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.type).toBe("bar");
    expect(retrieved!.datasets[0].data).toEqual([1, 2]);
  });

  it("returns null for nonexistent chart ID", async () => {
    const retrieved = await getStoredChart("nonexistent-id-xyz");
    expect(retrieved).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
//  ECharts catalog — new chart types
// ═══════════════════════════════════════════════════════════════

import { validateChartData, VALID_CHART_TYPES } from "../ChartService.ts";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

async function expectPng(config: ChartConfig) {
  const buffer = await renderChartPng(config);
  expect(buffer.length).toBeGreaterThan(1000);
  for (let i = 0; i < 4; i++) expect(buffer[i]).toBe(PNG_MAGIC[i]);
}

describe("renderChartPng — extended catalog", () => {
  it("renders scatter from [x, y] pairs (no labels needed)", async () => {
    await expectPng({
      type: "scatter",
      title: "Correlation",
      labels: [],
      datasets: [
        { label: "Sample", data: [[1, 2], [2, 4.1], [3, 5.8], [4, 8.2]] },
      ],
    });
  });

  it("renders a radar chart", async () => {
    await expectPng({
      type: "radar",
      labels: ["Speed", "Power", "Range", "Cost", "Comfort"],
      datasets: [
        { label: "Model A", data: [8, 6, 7, 4, 9] },
        { label: "Model B", data: [5, 9, 6, 7, 5] },
      ],
    });
  });

  it("renders a heatmap with rows-as-datasets", async () => {
    await expectPng({
      type: "heatmap",
      title: "Activity",
      labels: ["Mon", "Tue", "Wed"],
      datasets: [
        { label: "Morning", data: [1, 5, 3] },
        { label: "Evening", data: [7, 2, 9] },
      ],
    });
  });

  it("renders a candlestick from OHLC arrays", async () => {
    await expectPng({
      type: "candlestick",
      title: "PRSM",
      labels: ["Mon", "Tue", "Wed"],
      datasets: [
        {
          label: "PRSM",
          data: [
            [20, 34, 18, 35],
            [34, 30, 28, 36],
            [30, 41, 29, 42],
          ],
        },
      ],
    });
  });

  it("renders stacked and area variants", async () => {
    for (const type of ["area", "stacked_bar", "stacked_area", "horizontal_bar", "funnel"]) {
      await expectPng({
        type,
        labels: ["A", "B", "C"],
        datasets: [
          { label: "One", data: [3, 5, 2] },
          { label: "Two", data: [1, 2, 4] },
        ],
      });
    }
  });
});

describe("validateChartData", () => {
  it("rejects scatter points that are not [x, y] pairs", () => {
    const error = validateChartData("scatter", [], [
      { label: "S", data: [1, 2, 3] },
    ]);
    expect(error).toContain("[x, y]");
  });

  it("rejects candlestick with multiple datasets", () => {
    const error = validateChartData("candlestick", ["a"], [
      { label: "A", data: [[1, 2, 0, 3]] },
      { label: "B", data: [[1, 2, 0, 3]] },
    ]);
    expect(error).toContain("exactly one dataset");
  });

  it("rejects label/data length mismatches for aligned types", () => {
    const error = validateChartData("bar", ["a", "b"], [
      { label: "A", data: [1, 2, 3] },
    ]);
    expect(error).toContain("must match");
  });

  it("accepts valid shapes for every type", () => {
    expect(validateChartData("bar", ["a"], [{ label: "A", data: [1] }])).toBeNull();
    expect(validateChartData("scatter", [], [{ label: "A", data: [[1, 2]] }])).toBeNull();
    expect(
      validateChartData("candlestick", ["a"], [{ label: "A", data: [[1, 2, 0, 3]] }]),
    ).toBeNull();
    expect(VALID_CHART_TYPES).toContain("heatmap");
  });
});
