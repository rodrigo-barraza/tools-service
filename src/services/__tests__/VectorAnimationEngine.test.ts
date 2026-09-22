import { describe, it, expect } from "vitest";
import {
  solveCubicBezier,
  ease,
  easeOutBounce,
  parseColorToRgba,
  parseColor,
  interpolateColor,
  isGradient,
  interpolateGradient,
  interpolate,
  isSvgPathString,
  interpolatePath,
  resolveAnimatedProperties,
  getPathPointAt,
  buildEngineEmbedScript,
  buildTreeIndex,
  sortLayersForRender,
  getSymbolDuration,
  getInstanceLocalTime,
  buildPresetPath,
  VectorLayer,
  VectorSymbol,
  LinearGradient,
} from "../../utilities/VectorAnimationEngine.ts";

describe("VectorAnimationEngine Calculations", () => {
  describe("Cubic Bezier Solver", () => {
    it("correctly evaluates coordinates along a standard cubic-bezier curve", () => {
      const midpoint = solveCubicBezier(0.5, 0.25, 0.1, 0.25, 1.0);
      expect(midpoint).toBeGreaterThan(0.0);
      expect(midpoint).toBeLessThan(1.0);
      expect(solveCubicBezier(0.0, 0.25, 0.1, 0.25, 1.0)).toBe(0.0);
      expect(solveCubicBezier(1.0, 0.25, 0.1, 0.25, 1.0)).toBe(1.0);
    });
  });

  describe("Easing Calculations", () => {
    it("verifies built-in easing curves", () => {
      expect(ease(0.5, "linear")).toBe(0.5);
      expect(ease(0.5, "ease-in")).toBe(0.25); // 0.5 * 0.5
      expect(ease(0.5, "ease-out")).toBe(0.75); // 0.5 * (2 - 0.5)
      expect(ease(0.25, "ease-in-out")).toBe(0.125); // 2 * 0.25 * 0.25
      expect(ease(0.5, "discrete")).toBe(0);
      expect(ease(1.5, "step")).toBe(1);
    });

    it("verifies cubic-bezier parsing and solver mapping", () => {
      const easeResult = ease(0.5, "cubic-bezier(0.25, 0.1, 0.25, 1.0)");
      const directResult = solveCubicBezier(0.5, 0.25, 0.1, 0.25, 1.0);
      expect(easeResult).toBe(directResult);
    });

    it("anchors the Flash-style easing presets at their endpoints", () => {
      for (const preset of ["bounce", "bounce-in", "elastic", "elastic-in", "back", "back-in", "spring"]) {
        expect(ease(0, preset)).toBeCloseTo(0, 5);
        expect(ease(1, preset)).toBeCloseTo(1, 5);
      }
    });

    it("bounce eases through the canonical Penner segments", () => {
      expect(easeOutBounce(0.2)).toBeCloseTo(7.5625 * 0.2 * 0.2, 5);
      expect(ease(0.2, "bounce")).toBe(easeOutBounce(0.2));
      expect(ease(0.8, "bounce-in")).toBeCloseTo(1 - easeOutBounce(0.2), 10);
    });

    it("back overshoots past 1 on the way out, elastic oscillates past 1", () => {
      const backSamples = [0.6, 0.7, 0.8].map((t) => ease(t, "back"));
      expect(Math.max(...backSamples)).toBeGreaterThan(1);
      const elasticSamples = [0.2, 0.3, 0.4, 0.5].map((t) => ease(t, "elastic"));
      expect(Math.max(...elasticSamples)).toBeGreaterThan(1);
    });
  });

  describe("Color Parsing & Conversion", () => {
    it("parses named colors", () => {
      expect(parseColorToRgba("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
      expect(parseColorToRgba("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseColorToRgba("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });

    it("parses hex colors (short and long, with/without alpha)", () => {
      expect(parseColorToRgba("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
      expect(parseColorToRgba("#0000ff")).toEqual({ r: 0, g: 0, b: 255, a: 1 });
      expect(parseColorToRgba("#00ff0080")).toEqual({ r: 0, g: 255, b: 0, a: 128 / 255 });
    });

    it("parses rgb and rgba functions", () => {
      expect(parseColorToRgba("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
      expect(parseColorToRgba("rgba(255, 255, 255, 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    });

    it("parses hsl and hsla functions", () => {
      // hsl(120, 100%, 50%) is pure green
      const greenParsed = parseColorToRgba("hsl(120, 100%, 50%)");
      expect(greenParsed.r).toBe(0);
      expect(greenParsed.g).toBe(255);
      expect(greenParsed.b).toBe(0);
      expect(greenParsed.a).toBe(1);

      // hsla(240, 100%, 50%, 0.4) is semi-transparent blue
      const blueParsed = parseColorToRgba("hsla(240, 100%, 50%, 0.4)");
      expect(blueParsed.r).toBe(0);
      expect(blueParsed.g).toBe(0);
      expect(blueParsed.b).toBe(255);
      expect(blueParsed.a).toBeCloseTo(0.4, 2);
    });

    it("uses the DOM parser if document is defined, else falls back", () => {
      // Since we run in Node and document is undefined, it should fallback to parseColorToRgba
      const parsedColor = parseColor("#ff00ff");
      expect(parsedColor).toEqual({ r: 255, g: 0, b: 255, a: 1 });
    });
  });

  describe("Color & Gradient Interpolation", () => {
    it("interpolates colors linearly", () => {
      const colorResult = interpolateColor("red", "blue", 0.5);
      expect(colorResult).toBe("rgba(128, 0, 128, 1)");

      const colorAlphaResult = interpolateColor("rgba(0,0,0,0)", "rgba(255,255,255,1)", 0.25);
      expect(colorAlphaResult).toBe("rgba(64, 64, 64, 0.25)");
    });

    it("correctly identifies gradient definitions", () => {
      expect(isGradient("red")).toBe(false);
      expect(isGradient({ type: "linear", stops: [] })).toBe(true);
      expect(isGradient({ type: "radial", stops: [] })).toBe(true);
    });

    it("interpolates linear gradients coordinates and stops", () => {
      const gradientStart: LinearGradient = {
        type: "linear",
        x1: 0,
        y1: 0,
        x2: 100,
        y2: 0,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "black" }
        ]
      };

      const gradientEnd: LinearGradient = {
        type: "linear",
        x1: 50,
        y1: 50,
        x2: 150,
        y2: 50,
        stops: [
          { offset: 0, color: "blue" },
          { offset: 1, color: "white" }
        ]
      };

      const interpolatedGradientResult = interpolateGradient(gradientStart, gradientEnd, 0.5);
      expect(interpolatedGradientResult.type).toBe("linear");
      if (interpolatedGradientResult.type === "linear") {
        expect(interpolatedGradientResult.x1).toBe(25);
        expect(interpolatedGradientResult.y1).toBe(25);
        expect(interpolatedGradientResult.x2).toBe(125);
        expect(interpolatedGradientResult.y2).toBe(25);
      } else {
        throw new Error("Expected linear gradient type");
      }

      const stops = interpolatedGradientResult.stops;
      expect(stops).toBeDefined();
      if (stops) {
        expect(stops.length).toBe(2);
        expect(stops[0].offset).toBe(0);
        expect(stops[0].color).toBe("rgba(128, 0, 128, 1)"); // red to blue
        expect(stops[1].offset).toBe(1);
        expect(stops[1].color).toBe("rgba(128, 128, 128, 1)"); // black to white
      }
    });
  });

  describe("Properties Resolving & Movement", () => {
    it("returns default values when no keyframes are defined", () => {
      const layer: VectorLayer = {
        id: "rect",
        shapeType: "rectangle",
        x: 10,
        y: 20,
        fillColor: "red",
        strokeColor: "black",
        strokeWidth: 3,
        imageUrl: "http://example.com/texture.jpg"
      };

      const resolved = resolveAnimatedProperties(layer, 5.0);
      expect(resolved.x).toBe(10);
      expect(resolved.y).toBe(20);
      expect(resolved.scaleX).toBe(1);
      expect(resolved.fillColor).toBe("red");
      expect(resolved.strokeColor).toBe("black");
      expect(resolved.strokeWidth).toBe(3);
      expect(resolved.imageUrl).toBe("http://example.com/texture.jpg");
    });

    it("handles string/image interpolation by swapping at the midpoint", () => {
      const layer: VectorLayer = {
        id: "ball",
        shapeType: "circle",
        keyframes: [
          { time: 0, properties: { imageUrl: "img1.png" } },
          { time: 2, properties: { imageUrl: "img2.png" }, easing: "linear" }
        ]
      };

      // Before midpoint
      expect(resolveAnimatedProperties(layer, 0.9).imageUrl).toBe("img1.png");
      // After midpoint
      expect(resolveAnimatedProperties(layer, 1.1).imageUrl).toBe("img2.png");
    });

    it("interpolates properties between two keyframes", () => {
      const layer: VectorLayer = {
        id: "ball",
        shapeType: "circle",
        keyframes: [
          { time: 0, properties: { x: 0, y: 100, radius: 10, strokeWidth: 1 } },
          { time: 4, properties: { x: 200, y: 300, radius: 50, strokeWidth: 5 }, easing: "linear" }
        ]
      };

      // Exactly at time 0
      const propertiesTime0 = resolveAnimatedProperties(layer, 0);
      expect(propertiesTime0.x).toBe(0);
      expect(propertiesTime0.y).toBe(100);
      expect(propertiesTime0.radius).toBe(10);
      expect(propertiesTime0.strokeWidth).toBe(1);

      // At time 2 (midpoint)
      const propertiesTime2 = resolveAnimatedProperties(layer, 2);
      expect(propertiesTime2.x).toBe(100);
      expect(propertiesTime2.y).toBe(200);
      expect(propertiesTime2.radius).toBe(30);
      expect(propertiesTime2.strokeWidth).toBe(3);

      // Exactly at time 4
      const propertiesTime4 = resolveAnimatedProperties(layer, 4);
      expect(propertiesTime4.x).toBe(200);
      expect(propertiesTime4.y).toBe(300);
      expect(propertiesTime4.radius).toBe(50);
      expect(propertiesTime4.strokeWidth).toBe(5);
    });

    it("keeps static layer transforms when keyframes animate other properties", () => {
      const gear: VectorLayer = {
        id: "gear",
        shapeType: "path",
        x: 520,
        y: 120,
        keyframes: [
          { time: 0, easing: "linear", properties: { rotation: 0 } },
          { time: 2, properties: { rotation: 90 } },
        ],
      };
      const midProps = resolveAnimatedProperties(gear, 1);
      expect(midProps.x).toBe(520);
      expect(midProps.y).toBe(120);
      expect(midProps.rotation).toBe(45);
      // Before-first and after-last clamps keep statics too
      expect(resolveAnimatedProperties(gear, -1).x).toBe(520);
      expect(resolveAnimatedProperties(gear, 99).x).toBe(520);
      // Keyframed values still win over statics
      const override: VectorLayer = {
        id: "o",
        shapeType: "circle",
        x: 10,
        keyframes: [
          { time: 0, easing: "linear", properties: { x: 100 } },
          { time: 2, properties: { x: 200 } },
        ],
      };
      expect(resolveAnimatedProperties(override, 1).x).toBe(150);
    });

    it("resolves keyframe bounds correctly for times outside timeline range", () => {
      const layer: VectorLayer = {
        id: "box",
        shapeType: "rectangle",
        keyframes: [
          { time: 1, properties: { x: 50 } },
          { time: 3, properties: { x: 150 } }
        ]
      };

      // Before first keyframe
      expect(resolveAnimatedProperties(layer, 0).x).toBe(50);

      // After last keyframe
      expect(resolveAnimatedProperties(layer, 4).x).toBe(150);
    });
  });

  describe("Motion Path & Tangent Rotation", () => {
    it("uses linear fallback coordinates in pure Node environment", () => {
      const point = getPathPointAt("M 0 0 L 100 100", 0.5, false);
      expect(point.x).toBe(50);
      expect(point.y).toBe(50);
      expect(point.rotation).toBe(0);
    });

    it("correctly computes position and rotation when document is mocked", () => {
      const globalObject = globalThis as unknown as { document: unknown };
      const originalDocument = globalObject.document;

      // Mock SVG path methods
      globalObject.document = {
        createElementNS: () => {
          return {
            setAttribute: () => {},
            getTotalLength: () => 100,
            getPointAtLength: (targetLength: number) => {
              // Simulating line y = 2x
              return { x: targetLength, y: targetLength * 2 };
            }
          };
        }
      };

      try {
        const point = getPathPointAt("M 0 0 L 100 200", 0.5, true);
        expect(point.x).toBe(50);
        expect(point.y).toBe(100);
        // Tangent rotation: Math.atan2(2 * delta, delta) = Math.atan2(1.0, 0.5) * 180 / Math.PI
        expect(point.rotation).toBeCloseTo((Math.atan2(1.0, 0.5) * 180) / Math.PI, 1);
      } finally {
        globalObject.document = originalDocument;
      }
    });
  });

  describe("SVG Path Shape Tweens", () => {
    it("detects SVG path strings", () => {
      expect(isSvgPathString("M 0 0 L 100 100")).toBe(true);
      expect(isSvgPathString("M10,20 C 30 40, 50 60, 70 80 Z")).toBe(true);
      expect(isSvgPathString("hello")).toBe(false);
      expect(isSvgPathString("#ff0000")).toBe(false);
      expect(isSvgPathString(42)).toBe(false);
    });

    it("falls back to a discrete midpoint swap without a DOM", () => {
      expect(interpolate("M 0 0 L 10 10", "M 5 5 L 20 20", 0.25)).toBe("M 0 0 L 10 10");
      expect(interpolate("M 0 0 L 10 10", "M 5 5 L 20 20", 0.75)).toBe("M 5 5 L 20 20");
    });

    it("morphs between sampled paths when path measurement is available", () => {
      const globalObject = globalThis as unknown as { document: unknown };
      const originalDocument = globalObject.document;
      // Two mock paths: one along y=0, one along y=100; both length 100.
      globalObject.document = {
        createElementNS: () => {
          let assignedPath = "";
          return {
            setAttribute: (_name: string, value: string) => { assignedPath = value; },
            getTotalLength: () => 100,
            getPointAtLength: (targetLength: number) => ({
              x: targetLength,
              y: assignedPath.startsWith("M 0 100") ? 100 : 0,
            }),
          };
        },
      };
      try {
        const halfway = interpolatePath("M 0 0 L 100 0", "M 0 100 L 100 100", 0.5);
        expect(halfway.startsWith("M ")).toBe(true);
        // Every sampled point should sit at y=50 at progress 0.5
        const segments = halfway.match(/[ML] [\d.]+ ([\d.]+)/g) || [];
        expect(segments.length).toBeGreaterThan(10);
        for (const segment of segments) {
          expect(segment.endsWith(" 50.00")).toBe(true);
        }
      } finally {
        globalObject.document = originalDocument;
      }
    });
  });

  describe("Display Tree (parenting, zIndex, masks)", () => {
    const layers: VectorLayer[] = [
      { id: "bg", shapeType: "rectangle", zIndex: -10 },
      { id: "body", shapeType: "group" },
      { id: "arm", shapeType: "rectangle", parent: "body" },
      { id: "hand", shapeType: "circle", parent: "arm" },
      { id: "maskShape", shapeType: "circle", isMask: true },
      { id: "spotlit", shapeType: "rectangle", maskedBy: "maskShape", zIndex: 5 },
      { id: "orphan", shapeType: "circle", parent: "missing-layer" },
    ];

    it("builds roots/children with zIndex ordering and excludes masks from the draw tree", () => {
      const index = buildTreeIndex(layers);
      expect(index.roots.map((layer) => layer.id)).toEqual(["bg", "body", "orphan", "spotlit"]);
      expect(index.childrenOf["body"].map((layer) => layer.id)).toEqual(["arm"]);
      expect(index.childrenOf["arm"].map((layer) => layer.id)).toEqual(["hand"]);
      expect(index.byId["maskShape"].isMask).toBe(true);
      expect(index.roots.find((layer) => layer.id === "maskShape")).toBeUndefined();
    });

    it("treats self-parenting as a root instead of hiding the layer", () => {
      const index = buildTreeIndex([{ id: "loop", shapeType: "circle", parent: "loop" } as VectorLayer]);
      expect(index.roots.map((layer) => layer.id)).toEqual(["loop"]);
    });

    it("sorts stably by zIndex", () => {
      const sorted = sortLayersForRender([
        { id: "a", shapeType: "circle", zIndex: 1 },
        { id: "b", shapeType: "circle" },
        { id: "c", shapeType: "circle", zIndex: 1 },
        { id: "d", shapeType: "circle", zIndex: -1 },
      ] as VectorLayer[]);
      expect(sorted.map((layer) => layer.id)).toEqual(["d", "b", "a", "c"]);
    });
  });

  describe("Symbols (nested timelines)", () => {
    const walkCycle: VectorSymbol = {
      layers: [
        {
          id: "leg",
          shapeType: "rectangle",
          keyframes: [
            { time: 0, properties: { rotation: -20 } },
            { time: 0.6, properties: { rotation: 20 } },
          ],
        },
      ],
    };

    it("derives symbol duration from the last keyframe when unset", () => {
      expect(getSymbolDuration(walkCycle, 5)).toBe(0.6);
      expect(getSymbolDuration({ ...walkCycle, duration: 2 }, 5)).toBe(2);
      expect(getSymbolDuration({ layers: [] }, 5)).toBe(5);
    });

    it("loops instance local time over the symbol duration", () => {
      const instance = { id: "walker", shapeType: "instance", symbol: "walk" } as VectorLayer;
      expect(getInstanceLocalTime(instance, 0.3, 0.6)).toBeCloseTo(0.3, 10);
      expect(getInstanceLocalTime(instance, 0.9, 0.6)).toBeCloseTo(0.3, 10);
      expect(getInstanceLocalTime(instance, 1.2, 0.6)).toBeCloseTo(0, 10);
    });

    it("applies timeScale and timeOffset, and clamps when symbolLoop is false", () => {
      const fast = { id: "w", shapeType: "instance", symbol: "walk", timeScale: 2 } as VectorLayer;
      expect(getInstanceLocalTime(fast, 0.4, 0.6)).toBeCloseTo(0.2, 10);
      const staggered = { id: "w", shapeType: "instance", symbol: "walk", timeOffset: 0.3 } as VectorLayer;
      expect(getInstanceLocalTime(staggered, 0.4, 0.6)).toBeCloseTo(0.1, 10);
      const once = { id: "w", shapeType: "instance", symbol: "walk", symbolLoop: false } as VectorLayer;
      expect(getInstanceLocalTime(once, 5, 0.6)).toBe(0.6);
      expect(getInstanceLocalTime(once, -1, 0.6)).toBe(0);
    });
  });

  describe("Preset Shape Paths", () => {
    it("builds a star with alternating outer/inner vertices", () => {
      const path = buildPresetPath("star", { spikes: 5, outerRadius: 50, innerRadius: 20 });
      expect(path.startsWith("M ")).toBe(true);
      expect(path.trim().endsWith("Z")).toBe(true);
      // 5 spikes → 10 vertices → 1 M + 9 L
      expect((path.match(/L /g) || []).length).toBe(9);
      // First vertex is the top outer point
      expect(path.startsWith("M 0.00 -50.00")).toBe(true);
    });

    it("builds a heart from cubic curves, scaled by size", () => {
      const path = buildPresetPath("heart", { size: 100 });
      expect(path.startsWith("M ")).toBe(true);
      expect((path.match(/C /g) || []).length).toBe(4);
      const half = buildPresetPath("heart", { size: 50 });
      expect(half).toContain("-25.00");
    });

    it("builds a symmetric right-pointing arrow", () => {
      const path = buildPresetPath("arrow", { length: 100, thickness: 40 });
      expect(path).toContain("M -50.00 -10.00");
      expect(path).toContain("L 50.00 0.00");
      expect(path.trim().endsWith("Z")).toBe(true);
    });

    it("builds a gear with teeth and a counter-wound center hole", () => {
      const path = buildPresetPath("gear", { teeth: 8, outerRadius: 50, holeRadius: 15 });
      // 8 teeth × 4 vertices → 1 M + 31 L, plus the hole arcs
      expect((path.match(/L /g) || []).length).toBe(31);
      expect((path.match(/A /g) || []).length).toBe(2);
      expect(path).toContain("M 15.00 0");
      const noHole = buildPresetPath("gear", { teeth: 8, outerRadius: 50, holeRadius: 0 });
      expect(noHole).not.toContain("A ");
    });
  });

  // The embed player is built by serializing engine functions with
  // Function.toString(), which drops closures over module-level symbols
  // (NAMED_COLORS, pathCache, interpolateNumber). These tests execute the
  // serialized script the way the browser does — importing the functions
  // directly would never catch a missing declaration.
  describe("Embed Script Serialization", () => {
    type EmbedEngine = {
      interpolate: typeof interpolate;
      parseColorToRgba: typeof parseColorToRgba;
      interpolateGradient: typeof interpolateGradient;
      resolveAnimatedProperties: typeof resolveAnimatedProperties;
      getPathPointAt: typeof getPathPointAt;
      ease: typeof ease;
      interpolatePath: typeof interpolatePath;
      buildTreeIndex: typeof buildTreeIndex;
      getSymbolDuration: typeof getSymbolDuration;
      getInstanceLocalTime: typeof getInstanceLocalTime;
      sortLayersForRender: typeof sortLayersForRender;
    };

    function evaluateEmbedScript(): EmbedEngine {
      const script = buildEngineEmbedScript();
      return new Function(
        `"use strict"; ${script}; return { interpolate, parseColorToRgba, interpolateGradient, resolveAnimatedProperties, getPathPointAt, ease, interpolatePath, buildTreeIndex, getSymbolDuration, getInstanceLocalTime, sortLayersForRender };`,
      )() as EmbedEngine;
    }

    it("evaluates without ReferenceError and interpolates numbers (production blank-canvas regression)", () => {
      const engine = evaluateEmbedScript();
      expect(engine.interpolate(0, 100, 0.5)).toBe(50);
    });

    it("resolves animated properties between two keyframes like the player's renderFrame", () => {
      const engine = evaluateEmbedScript();
      const layer: VectorLayer = {
        id: "ball",
        shapeType: "circle",
        shapeData: { radius: 40 },
        fillColor: "#38bdf8",
        keyframes: [
          { time: 0, easing: "linear", properties: { y: 500 } },
          { time: 2, easing: "linear", properties: { y: 100 } },
        ],
      };
      const props = engine.resolveAnimatedProperties(layer, 1);
      expect(props.y).toBe(300);
    });

    it("parses named colors via the serialized NAMED_COLORS table", () => {
      const engine = evaluateEmbedScript();
      expect(engine.parseColorToRgba("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    });

    it("interpolates gradients via the serialized interpolateNumber helper", () => {
      const engine = evaluateEmbedScript();
      const gradientA: LinearGradient = { type: "linear", x1: 0, y1: 0, x2: 100, y2: 0, stops: [{ offset: 0, color: "#000000" }] };
      const gradientB: LinearGradient = { type: "linear", x1: 0, y1: 0, x2: 200, y2: 0, stops: [{ offset: 1, color: "#ffffff" }] };
      const mid = engine.interpolateGradient(gradientA, gradientB, 0.5) as LinearGradient;
      expect(mid.x2).toBe(150);
      expect(mid.stops?.[0].offset).toBe(0.5);
    });

    it("resolves motion paths via the serialized pathCache (non-DOM fallback)", () => {
      const engine = evaluateEmbedScript();
      const point = engine.getPathPointAt("M 0 0 L 100 100", 0.5);
      expect(point.x).toBe(50);
      expect(point.y).toBe(50);
    });

    it("evaluates the Flash-style easing presets via the serialized easeOutBounce helper", () => {
      const engine = evaluateEmbedScript();
      expect(engine.ease(0.2, "bounce")).toBe(easeOutBounce(0.2));
      expect(engine.ease(1, "elastic")).toBe(1);
      expect(engine.ease(1, "spring")).toBe(1);
    });

    it("morphs SVG paths via the serialized samplePathPoints helper (non-DOM fallback)", () => {
      const engine = evaluateEmbedScript();
      expect(engine.interpolatePath("M 0 0 L 10 10", "M 5 5 L 20 20", 0.75)).toBe("M 5 5 L 20 20");
    });

    it("builds display trees and instance timelines from the serialized helpers", () => {
      const engine = evaluateEmbedScript();
      const index = engine.buildTreeIndex([
        { id: "group", shapeType: "group" },
        { id: "child", shapeType: "circle", parent: "group" },
        { id: "mask", shapeType: "circle", isMask: true },
      ] as VectorLayer[]);
      expect(index.roots.map((layer) => layer.id)).toEqual(["group"]);
      expect(index.childrenOf["group"].map((layer) => layer.id)).toEqual(["child"]);

      const symbol: VectorSymbol = {
        layers: [{ id: "leg", shapeType: "rectangle", keyframes: [{ time: 0, properties: {} }, { time: 0.5, properties: {} }] }],
      };
      expect(engine.getSymbolDuration(symbol, 5)).toBe(0.5);
      expect(
        engine.getInstanceLocalTime({ id: "w", shapeType: "instance", symbol: "s" } as VectorLayer, 1.25, 0.5),
      ).toBeCloseTo(0.25, 10);
    });
  });
});
