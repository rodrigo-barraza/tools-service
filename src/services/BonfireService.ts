import crypto from "node:crypto";
import { buildLocalUrl } from "../utilities.ts";
import { PersistentStore } from "../models/EmbedAsset.ts";

export interface BonfireParams {
  woodType?: "oak" | "pine" | "birch" | "driftwood" | "magical";
  logsCount?: number;
  breezeSpeed?: number;
  fireColor?: "classic" | "emerald" | "sapphire" | "amethyst" | "ghostly";
  intensity?: "ember" | "spark" | "cozy" | "blazing" | "inferno";
  marshmallows?: number;
  itemToBurn?: string;
}

export interface BonfireResult {
  bonfireId: string;
  woodType: "oak" | "pine" | "birch" | "driftwood" | "magical";
  logsCount: number;
  breezeSpeed: number;
  fireColor: "classic" | "emerald" | "sapphire" | "amethyst" | "ghostly";
  intensity: "ember" | "spark" | "cozy" | "blazing" | "inferno";
  marshmallows: number;
  itemToBurn?: string;
  asciiArt: string;
  htmlEmbed: string;
  embedUrl: string;
}

// 2 hours TTL for bonfires in memory
export const bonfireStore = new PersistentStore<BonfireResult>(
  "bonfire",
  2 * 60 * 60 * 1000,
);

/**
 * Generate a beautifully colored procedural ANSI representation of the bonfire.
 */
export function generateAnsiArt(
  params: Required<Omit<BonfireParams, "itemToBurn">> & { itemToBurn?: string },
): string {
  const {
    logsCount,
    breezeSpeed,
    fireColor,
    intensity,
    marshmallows,
    itemToBurn,
  } = params;

  // Grid setup: 14 rows, 55 columns
  const height = 14;
  const width = 55;
  const grid: string[][] = Array.from({ length: height }, () =>
    Array(width).fill(" "),
  );

  // Determine flame dimensions
  let flameHeight = 5;
  if (intensity === "ember") flameHeight = 2;
  else if (intensity === "spark") flameHeight = 3;
  else if (intensity === "cozy") flameHeight = 5;
  else if (intensity === "blazing") flameHeight = 7;
  else if (intensity === "inferno") flameHeight = 10;

  const logsStartRow = 11;

  // 1. Generate Flame Structure
  // Higher wind skews the flame further to the right as we go up.
  for (let row = 0; row < flameHeight; row++) {
    const rowIndex = logsStartRow - 1 - row;
    if (rowIndex < 0) continue;

    // Wind tilt offset
    const skew = Math.floor(row * (breezeSpeed / 12));
    const baseCenter = 27 + skew;

    // Flame width narrows as it goes up
    const maxFlameWidth = Math.max(1, Math.floor((flameHeight - row) * 1.6));

    for (let column = -maxFlameWidth; column <= maxFlameWidth; column++) {
      const columnIndex = baseCenter + column;
      if (columnIndex < 0 || columnIndex >= width) continue;

      // Choose flame characters based on distance from core and height
      const dist = Math.abs(column);
      const ratio = dist / maxFlameWidth;

      if (ratio < 0.3 && row < flameHeight * 0.6) {
        grid[rowIndex][columnIndex] = row % 2 === 0 ? "#" : "@"; // Hottest inner core
      } else if (ratio < 0.6) {
        grid[rowIndex][columnIndex] = row % 2 === 0 ? "(" : ")"; // Hot middle flame
      } else {
        // Flickering outer edges / sparks
        const rand = (columnIndex + rowIndex) % 5;
        if (rand === 0) grid[rowIndex][columnIndex] = "*";
        else if (rand === 1) grid[rowIndex][columnIndex] = ".";
        else if (rand === 2 && breezeSpeed > 15) grid[rowIndex][columnIndex] = "~";
      }
    }
  }

  // Add blowing sparks if wind is high
  if (breezeSpeed > 10) {
    for (let row = 0; row < flameHeight; row++) {
      const rowIndex = logsStartRow - 2 - row;
      if (rowIndex < 0) continue;
      const skew = Math.floor(row * (breezeSpeed / 12));
      const sparklineColumn =
        27 + skew + Math.floor((flameHeight - row) * 1.5) + 3 + (rowIndex % 3);
      if (sparklineColumn < width) {
        grid[rowIndex][sparklineColumn] = "*";
      }
    }
  }

  // 2. Add Item to Burn (placed right above logs, nestled in the fire core)
  if (itemToBurn) {
    const cleanedItem =
      itemToBurn.length > 15 ? itemToBurn.slice(0, 12) + "..." : itemToBurn;
    const label = `[🔥 ${cleanedItem.toUpperCase()} 🔥]`;
    const labelRow = logsStartRow - 1;
    const labelStart = Math.max(
      0,
      27 -
        Math.floor(label.length / 2) +
        Math.floor((logsStartRow - labelRow) * (breezeSpeed / 12)),
    );
    for (let i = 0; i < label.length; i++) {
      if (labelStart + i < width) {
        grid[labelRow][labelStart + i] = label[i];
      }
    }
  }

  // 3. Add Marshmallows on Skewers
  if (marshmallows > 0) {
    // Marshmallow 1 (Left side)
    const m1Row = logsStartRow - 3;
    const m1Skew = Math.floor((logsStartRow - m1Row) * (breezeSpeed / 12));
    const m1Start = 10;
    const m1Stick = "=========(O)";
    for (let i = 0; i < mStickLength(m1Stick, 27 + m1Skew - 4); i++) {
      const column = m1Start + i;
      if (column < width) grid[m1Row][column] = m1Stick[i] || "=";
    }

    // Marshmallow 2 (Right side, if > 1)
    if (marshmallows > 1) {
      const m2Row = logsStartRow - 4;
      const m2Skew = Math.floor((logsStartRow - m2Row) * (breezeSpeed / 12));
      const m2End = 44;
      const m2Stick = "(O)=========";
      const m2Start = 27 + m2Skew + 4;
      for (let i = 0; i < m2Stick.length; i++) {
        const column = m2Start + i;
        if (column < width && column <= m2End) grid[m2Row][column] = m2Stick[i];
      }
    }
  }

  // 4. Draw Stacking Logs at the Bottom
  // Row 11, 12, 13
  if (logsCount === 1) {
    writeStringAtGrid(grid, logsStartRow, 19, "[=================]");
  } else if (logsCount === 2) {
    writeStringAtGrid(grid, logsStartRow, 19, "\\=================/");
    writeStringAtGrid(grid, logsStartRow + 1, 17, "[===================]");
  } else if (logsCount === 3) {
    writeStringAtGrid(grid, logsStartRow, 22, "\\============/");
    writeStringAtGrid(grid, logsStartRow + 1, 18, "[==================]");
    writeStringAtGrid(grid, logsStartRow + 2, 16, "/====================\\");
  } else {
    // 4+ logs: Pyramid stack
    writeStringAtGrid(grid, logsStartRow - 1, 24, "[======]");
    writeStringAtGrid(grid, logsStartRow, 21, "\\============/");
    writeStringAtGrid(grid, logsStartRow + 1, 18, "[==================]");
    writeStringAtGrid(grid, logsStartRow + 2, 15, "/======================\\");
  }

  // Add decorative campfire stones at the very base
  writeStringAtGrid(
    grid,
    logsStartRow + 3,
    11,
    "oo   o.o o.o.o.o o.o o.o   oo",
  );

  // 5. Apply ANSI Color Code Themes
  // Color palette definitions
  const ANSI = {
    RESET: "\x1b[0m",
    BOLD: "\x1b[1m",
    GRAY: "\x1b[90m",
    LOGS: "\x1b[38;5;94m", // Rich brown
    STONE: "\x1b[38;5;244m", // Stone gray
    STICK: "\x1b[38;5;137m", // Wood stick tan
    M_SHMALLOW: "\x1b[38;5;231m", // Marshmallow white
    BURNED: "\x1b[38;5;166m", // Toasted orange-brown
    ITEM: "\x1b[1;31;43m", // Flashing red on yellow background
  };

  const getFlameColors = () => {
    switch (fireColor) {
      case "emerald":
        return { core: "\x1b[1;37m", mid: "\x1b[36m", outer: "\x1b[32m" };
      case "sapphire":
        return { core: "\x1b[1;37m", mid: "\x1b[36m", outer: "\x1b[34m" };
      case "amethyst":
        return { core: "\x1b[1;37m", mid: "\x1b[35m", outer: "\x1b[31m" };
      case "ghostly":
        return { core: "\x1b[1;37m", mid: "\x1b[36m", outer: "\x1b[90m" };
      case "classic":
      default:
        return { core: "\x1b[1;33m", mid: "\x1b[33m", outer: "\x1b[31m" };
    }
  };

  const flames = getFlameColors();

  let output = "";
  for (let row = 0; row < height; row++) {
    let line = "";
    for (let column = 0; column < width; column++) {
      const char = grid[row][column];
      if (char === " ") {
        line += " ";
        continue;
      }

      // Color mapping logic
      if (char === "#" || char === "@") {
        line += flames.core + char + ANSI.RESET;
      } else if (char === "(" || char === ")") {
        line += flames.mid + char + ANSI.RESET;
      } else if (char === "*" || char === "." || char === "~") {
        line += flames.outer + char + ANSI.RESET;
      } else if (
        char === "[" ||
        char === "]" ||
        char === "=" ||
        char === "\\" ||
        char === "/"
      ) {
        // Logs or item
        if (row < logsStartRow) {
          // Could be wood logs, item, or skewers
          if (grid[row].join("").includes("[🔥")) {
            line += ANSI.ITEM + char + ANSI.RESET;
          } else if (char === "=") {
            line += ANSI.STICK + char + ANSI.RESET;
          } else {
            line += ANSI.LOGS + char + ANSI.RESET;
          }
        } else {
          line += ANSI.LOGS + char + ANSI.RESET;
        }
      } else if (char === "O") {
        line += ANSI.BOLD + ANSI.M_SHMALLOW + char + ANSI.RESET;
      } else if (char === "o") {
        line += ANSI.STONE + char + ANSI.RESET;
      } else if (char === "🔥" || grid[row].join("").includes("[🔥")) {
        line += ANSI.ITEM + char + ANSI.RESET;
      } else {
        // General text
        line += ANSI.BOLD + flames.core + char + ANSI.RESET;
      }
    }
    output += line + "\n";
  }

  return output;
}

function writeStringAtGrid(
  grid: string[][],
  row: number,
  startColumn: number,
  text: string,
) {
  if (row < 0 || row >= grid.length) return;
  for (let i = 0; i < text.length; i++) {
    const column = startColumn + i;
    if (column >= 0 && column < grid[row].length) {
      grid[row][column] = text[i];
    }
  }
}

function mStickLength(stick: string, maxColumns: number): number {
  return Math.min(stick.length, maxColumns - 10);
}

/**
 * Generate a jaw-dropping premium GPU-accelerated responsive HTML page
 * displaying a stunning interactive bonfire animation matching parameters.
 */
export function generateHtmlEmbed(
  params: Required<Omit<BonfireParams, "itemToBurn">> & { itemToBurn?: string },
): string {
  const {
    woodType,
    logsCount,
    breezeSpeed,
    fireColor,
    intensity,
    marshmallows,
    itemToBurn,
  } = params;

  // Custom Color Themes
  const getThemePalette = () => {
    switch (fireColor) {
      case "emerald":
        return {
          glow: "rgba(16, 185, 129, 0.2)",
          outer: "#10b981",
          mid: "#06b6d4",
          inner: "#a7f3d0",
          particle: "#34d399",
        };
      case "sapphire":
        return {
          glow: "rgba(59, 130, 246, 0.2)",
          outer: "#3b82f6",
          mid: "#06b6d4",
          inner: "#bfdbfe",
          particle: "#60a5fa",
        };
      case "amethyst":
        return {
          glow: "rgba(168, 85, 247, 0.2)",
          outer: "#a855f7",
          mid: "#ec4899",
          inner: "#f5d0fe",
          particle: "#c084fc",
        };
      case "ghostly":
        return {
          glow: "rgba(6, 182, 212, 0.15)",
          outer: "#06b6d4",
          mid: "#64748b",
          inner: "#f8fafc",
          particle: "#22d3ee",
        };
      case "classic":
      default:
        return {
          glow: "rgba(239, 68, 68, 0.25)",
          outer: "#ef4444",
          mid: "#f97316",
          inner: "#fef08a",
          particle: "#fbbf24",
        };
    }
  };

  const theme = getThemePalette();

  // Scale variables by intensity
  let scale = 1.0;
  let flameSpeed = "1.5s";
  let sparkCount = 15;
  if (intensity === "ember") {
    scale = 0.5;
    flameSpeed = "2.5s";
    sparkCount = 5;
  } else if (intensity === "spark") {
    scale = 0.7;
    flameSpeed = "2.0s";
    sparkCount = 8;
  } else if (intensity === "cozy") {
    scale = 1.0;
    flameSpeed = "1.4s";
    sparkCount = 16;
  } else if (intensity === "blazing") {
    scale = 1.35;
    flameSpeed = "1.0s";
    sparkCount = 28;
  } else if (intensity === "inferno") {
    scale = 1.8;
    flameSpeed = "0.7s";
    sparkCount = 45;
  }

  // Generate logs HTML
  let logsHtml: string;
  if (logsCount === 1) {
    logsHtml = `<div class="log log-base log-single"></div>`;
  } else if (logsCount === 2) {
    logsHtml = `
      <div class="log log-angle-left"></div>
      <div class="log log-angle-right"></div>
    `;
  } else if (logsCount === 3) {
    logsHtml = `
      <div class="log log-angle-left"></div>
      <div class="log log-angle-right"></div>
      <div class="log log-base"></div>
    `;
  } else {
    // 4+ logs
    logsHtml = `
      <div class="log log-top"></div>
      <div class="log log-angle-left"></div>
      <div class="log log-angle-right"></div>
      <div class="log log-base"></div>
    `;
  }

  // Generate spark particle divs
  let sparksHtml = "";
  for (let i = 0; i < sparkCount; i++) {
    const delay = (Math.random() * 3).toFixed(2);
    const left = (25 + Math.random() * 50).toFixed(1);
    const size = (2 + Math.random() * 5).toFixed(0);
    const duration = (1 + Math.random() * 2).toFixed(2);
    sparksHtml += `<div class="spark" style="left: ${left}%; width: ${size}px; height: ${size}px; animation-delay: ${delay}s; animation-duration: ${duration}s;"></div>`;
  }

  // Marshmallows skewers HTML
  let marshmallowHtml = "";
  if (marshmallows > 0) {
    marshmallowHtml += `
      <div class="skewer left-skewer">
        <div class="stick"></div>
        <div class="marshmallow"></div>
      </div>
    `;
    if (marshmallows > 1) {
      marshmallowHtml += `
        <div class="skewer right-skewer">
          <div class="stick"></div>
          <div class="marshmallow"></div>
        </div>
      `;
    }
  }

  // Item to burn HTML
  let itemHtml = "";
  if (itemToBurn) {
    itemHtml = `
      <div class="burning-item">
        <div class="item-inner">${itemToBurn.toUpperCase()}</div>
      </div>
    `;
  }

  // Breeze direction class
  const breezeAngle = Math.min(breezeSpeed * 0.7, 30);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cozy Bonfire - ${intensity.toUpperCase()} 🔥</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --glow-color: ${theme.glow};
      --flame-outer: ${theme.outer};
      --flame-mid: ${theme.mid};
      --flame-inner: ${theme.inner};
      --spark-color: ${theme.particle};
      --fire-scale: ${scale};
      --flame-speed: ${flameSpeed};
      --wind-skew: ${breezeAngle}deg;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      background: #070b13;
      color: #e2e8f0;
      font-family: 'Outfit', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
      perspective: 1000px;
    }

    /* Star Field */
    .sky {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 1;
      overflow: hidden;
    }

    .star {
      position: absolute;
      background: #ffffff;
      border-radius: 50%;
      animation: twinkle 4s infinite ease-in-out;
    }

    /* Fire Glow */
    .glow {
      position: absolute;
      bottom: 15%;
      width: 600px;
      height: 600px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--glow-color) 0%, rgba(7,11,19,0) 70%);
      filter: blur(40px);
      z-index: 2;
      pointer-events: none;
      transform: translate3d(0, 50px, 0);
      animation: pulse-glow 3s infinite ease-in-out;
    }

    /* Fire Container */
    .fire-scene {
      position: relative;
      width: 400px;
      height: 450px;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      z-index: 10;
      transform-style: preserve-3d;
      margin-bottom: 20px;
    }

    /* Logs Stacking */
    .logs-base {
      position: absolute;
      bottom: 20px;
      width: 240px;
      height: 60px;
      z-index: 20;
      transform-style: preserve-3d;
    }

    .log {
      position: absolute;
      background: linear-gradient(90deg, #4c2c16 0%, #2f180a 50%, #4c2c16 100%);
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.5), inset 0 2px 3px rgba(255,255,255,0.1);
      border: 1px solid #1a0c05;
      overflow: hidden;
    }

    .log::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: repeating-linear-gradient(90deg, transparent, transparent 15px, rgba(0,0,0,0.15) 15px, rgba(0,0,0,0.15) 30px);
    }

    /* Glowing Hot Spot Core on Logs */
    .log::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 20%;
      width: 60%;
      height: 6px;
      background: linear-gradient(90deg, transparent, var(--flame-outer), var(--flame-inner), var(--flame-outer), transparent);
      box-shadow: 0 0 10px var(--flame-outer);
      filter: blur(1px);
    }

    .log-base {
      bottom: 0;
      left: 20px;
      width: 200px;
      height: 24px;
    }

    .log-single {
      left: 0px;
      width: 240px;
      height: 28px;
    }

    .log-angle-left {
      bottom: 8px;
      left: 10px;
      width: 160px;
      height: 22px;
      transform: rotate(18deg);
    }

    .log-angle-right {
      bottom: 8px;
      right: 10px;
      width: 160px;
      height: 22px;
      transform: rotate(-18deg);
    }

    .log-top {
      bottom: 24px;
      left: 45px;
      width: 150px;
      height: 20px;
      transform: rotate(2deg);
    }

    /* Coal circle */
    .coal-circle {
      position: absolute;
      bottom: 5px;
      width: 280px;
      height: 25px;
      border: 6px double #334155;
      border-radius: 50%;
      z-index: 15;
      background: #0f172a;
      box-shadow: inset 0 0 15px rgba(0,0,0,0.8);
    }

    /* Flame graphics */
    .flame-wrapper {
      position: absolute;
      bottom: 40px;
      width: 200px;
      height: 300px;
      z-index: 25;
      transform: scale(var(--fire-scale)) skewX(var(--wind-skew));
      transform-origin: bottom center;
      transition: transform 0.5s ease-out;
      pointer-events: none;
    }

    .flame {
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      transform-origin: bottom center;
      filter: blur(2px);
    }

    .flame-outer {
      width: 140px;
      height: 240px;
      background: var(--flame-outer);
      border-radius: 50% 50% 20% 20% / 60% 60% 40% 40%;
      opacity: 0.7;
      animation: flicker var(--flame-speed) infinite ease-in-out;
      box-shadow: 0 0 40px var(--flame-outer);
    }

    .flame-middle {
      width: 100px;
      height: 180px;
      background: var(--flame-mid);
      border-radius: 50% 50% 20% 20% / 60% 60% 40% 40%;
      opacity: 0.85;
      animation: flicker calc(var(--flame-speed) * 0.8) infinite ease-in-out alternate;
    }

    .flame-inner {
      width: 60px;
      height: 120px;
      background: var(--flame-inner);
      border-radius: 50% 50% 20% 20% / 60% 60% 40% 40%;
      opacity: 0.95;
      animation: flicker calc(var(--flame-speed) * 0.6) infinite ease-in-out;
      box-shadow: 0 0 20px var(--flame-inner);
    }

    /* Spark animations */
    .spark {
      position: absolute;
      bottom: 50px;
      background: var(--spark-color);
      border-radius: 50%;
      opacity: 0;
      z-index: 30;
      box-shadow: 0 0 8px var(--spark-color);
      animation: rise-spark infinite linear;
    }

    /* Marshmallow Roasting Skewers */
    .skewer {
      position: absolute;
      z-index: 35;
      display: flex;
      align-items: center;
      pointer-events: none;
    }

    .left-skewer {
      bottom: 120px;
      left: -40px;
      transform: rotate(15deg);
    }

    .right-skewer {
      bottom: 140px;
      right: -40px;
      transform: rotate(-15deg) scaleX(-1);
    }

    .skewer .stick {
      width: 180px;
      height: 3px;
      background: linear-gradient(90deg, #64748b, #475569);
      box-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }

    .skewer .marshmallow {
      width: 24px;
      height: 18px;
      background: #f8fafc;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      position: relative;
      animation: roast 5s forwards ease-in-out;
    }

    /* Burning item */
    .burning-item {
      position: absolute;
      bottom: 45px;
      width: 90px;
      height: 45px;
      background: #1e293b;
      border: 2px solid #ef4444;
      border-radius: 6px;
      z-index: 22;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.6);
      transform: rotate(-5deg);
      animation: burn-away 6s forwards linear;
    }

    .item-inner {
      font-size: 8px;
      font-weight: 800;
      color: #fca5a5;
      text-align: center;
      padding: 4px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: monospace;
    }

    /* Cozy Info Overlay */
    .overlay-panel {
      z-index: 100;
      text-align: center;
      margin-top: 10px;
      background: rgba(15, 23, 42, 0.7);
      padding: 16px 28px;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      max-width: 90%;
    }

    .title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      background: linear-gradient(135deg, var(--flame-inner), var(--flame-outer));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 4px;
    }

    .stat-bar {
      display: flex;
      gap: 15px;
      font-size: 11px;
      color: #94a3b8;
      justify-content: center;
      margin-top: 8px;
      font-family: monospace;
    }

    .stat-bar span {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Keyframes */
    @keyframes twinkle {
      0%, 100% { opacity: 0.2; transform: scale(0.8); }
      50% { opacity: 1; transform: scale(1.2); }
    }

    @keyframes pulse-glow {
      0%, 100% { transform: scale(1) translate3d(0, 50px, 0); opacity: 0.9; }
      50% { transform: scale(1.15) translate3d(0, 50px, 0); opacity: 1.1; }
    }

    @keyframes flicker {
      0%, 100% {
        transform: translateX(-50%) scale(1, 1) rotate(0deg);
        border-radius: 50% 50% 20% 20% / 60% 60% 40% 40%;
      }
      25% {
        transform: translateX(-51%) scale(0.96, 1.05) rotate(-1deg);
        border-radius: 48% 52% 22% 18% / 62% 58% 42% 38%;
      }
      50% {
        transform: translateX(-49%) scale(1.04, 0.95) rotate(1deg);
        border-radius: 52% 48% 18% 22% / 58% 62% 38% 42%;
      }
      75% {
        transform: translateX(-50.5%) scale(0.98, 1.02) rotate(-0.5deg);
        border-radius: 49% 51% 21% 19% / 61% 59% 41% 39%;
      }
    }

    @keyframes rise-spark {
      0% {
        transform: translate3d(0, 0, 0) scale(1);
        opacity: 1;
      }
      80% {
        opacity: 0.8;
      }
      100% {
        /* Spark drifts left/right and flows with the wind */
        transform: translate3d(
          calc(sin(var(--fire-scale) * 10) * 40px + calc(var(--wind-skew) * 3)),
          calc(-250px - calc(var(--fire-scale) * 40px)),
          0
        ) scale(0.2);
        opacity: 0;
      }
    }

    @keyframes roast {
      0% { background: #f8fafc; }
      30% { background: #fde047; box-shadow: 0 0 8px #fde047; }
      70% { background: #ca8a04; box-shadow: 0 0 12px #ca8a04; }
      100% { background: #451a03; border: 1px solid #1a0500; box-shadow: 0 0 4px #78350f; }
    }

    @keyframes burn-away {
      0% { opacity: 1; transform: rotate(-5deg) scale(1); filter: grayscale(0%); }
      20% { border-color: #f97316; box-shadow: 0 0 20px #f97316; }
      50% { opacity: 0.8; border-color: #ef4444; box-shadow: 0 0 25px #ef4444; filter: brightness(1.5) grayscale(50%); }
      90% { opacity: 0.3; transform: rotate(-8deg) scale(0.65) translate3d(0, 15px, 0); }
      100% { opacity: 0; transform: rotate(-10deg) scale(0) translate3d(0, 30px, 0); }
    }
  </style>
</head>
<body>

  <!-- Sky Star Field -->
  <div class="sky" id="starfield"></div>

  <!-- Ambient Light Glow -->
  <div class="glow"></div>

  <!-- Bonfire Visual Container -->
  <div class="fire-scene">
    <!-- Fire Pit border -->
    <div class="coal-circle"></div>

    <!-- Active Flickering Flames -->
    <div class="flame-wrapper">
      <div class="flame flame-outer"></div>
      <div class="flame flame-middle"></div>
      <div class="flame flame-inner"></div>
    </div>

    <!-- Stacked Logs -->
    <div class="logs-base">
      ${logsHtml}
    </div>

    <!-- Spark Particles -->
    ${sparksHtml}

    <!-- Toasting Marshmallows -->
    ${marshmallowHtml}

    <!-- Item being incinerated -->
    ${itemHtml}
  </div>

  <!-- Cozy Status Panel -->
  <div class="overlay-panel">
    <div class="title">Cozy Bonfire</div>
    <div class="stat-bar">
      <span>🪵 ${woodType.toUpperCase()}</span>
      <span>🔥 ${intensity.toUpperCase()}</span>
      <span>💨 ${breezeSpeed} MPH</span>
      <span>🎨 ${fireColor.toUpperCase()}</span>
    </div>
  </div>

  <script>
    // Dynamically populate star field
    const starfield = document.getElementById('starfield');
    const starCount = 35;
    for (let i = 0; i < starCount; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.left = (Math.random() * 100) + '%';
      star.style.top = (Math.random() * 70) + '%';
      const size = (1 + Math.random() * 2) + 'px';
      star.style.width = size;
      star.style.height = size;
      star.style.animationDelay = (Math.random() * 4) + 's';
      starfield.appendChild(star);
    }
  </script>
</body>
</html>`;
}

/**
 * Handle creation of a new custom bonfire, validation, ANSI rendering, and caching.
 */
export function createBonfire(params: BonfireParams): BonfireResult {
  // Validate and fall back
  const woodType = params.woodType || "oak";
  const logsCount = Math.min(Math.max(params.logsCount ?? 4, 1), 10);
  const breezeSpeed = Math.min(Math.max(params.breezeSpeed ?? 5, 0), 50);
  const fireColor = params.fireColor || "classic";
  const intensity = params.intensity || "cozy";
  const marshmallows = Math.min(Math.max(params.marshmallows ?? 0, 0), 2);
  const itemToBurn = params.itemToBurn?.trim();

  // Validate types/enums strictly
  const validWoods = ["oak", "pine", "birch", "driftwood", "magical"];
  if (!validWoods.includes(woodType)) {
    throw new Error(
      `Invalid woodType: ${woodType}. Allowed: ${validWoods.join(", ")}`,
    );
  }

  const validColors = ["classic", "emerald", "sapphire", "amethyst", "ghostly"];
  if (!validColors.includes(fireColor)) {
    throw new Error(
      `Invalid fireColor: ${fireColor}. Allowed: ${validColors.join(", ")}`,
    );
  }

  const validIntensities = ["ember", "spark", "cozy", "blazing", "inferno"];
  if (!validIntensities.includes(intensity)) {
    throw new Error(
      `Invalid intensity: ${intensity}. Allowed: ${validIntensities.join(", ")}`,
    );
  }

  const resolvedParams = {
    woodType,
    logsCount,
    breezeSpeed,
    fireColor,
    intensity,
    marshmallows,
    itemToBurn,
  };

  // Generate artifacts
  const asciiArt = generateAnsiArt(resolvedParams);
  const htmlEmbed = generateHtmlEmbed(resolvedParams);

  const bonfireId = crypto.randomUUID().slice(0, 12);
  const embedUrl = buildLocalUrl("gaming/bonfire/embed", { id: bonfireId });

  const result: BonfireResult = {
    bonfireId,
    woodType,
    logsCount,
    breezeSpeed,
    fireColor,
    intensity,
    marshmallows,
    itemToBurn,
    asciiArt,
    htmlEmbed,
    embedUrl,
  };

  // Cache in the store
  bonfireStore.set(result);

  return result;
}
