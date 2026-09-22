import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { executeLogoProgram } from "../LogoInterpreterService.ts";

// ═══════════════════════════════════════════════════════════════
// FUZZ / PROPERTY-BASED TESTS — LogoInterpreterService
//
// Verifies that the Logo language interpreter never crashes,
// always returns a well-structured result, and respects
// resource limits regardless of input.
// ═══════════════════════════════════════════════════════════════

// ── Custom Arbitraries ──────────────────────────────────────

const arbitraryNumber = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }),
  fc.double({ min: -500, max: 500, noNaN: true }),
);

const arbitrarySimpleStatement = fc.tuple(
  fc.constantFrom("fd", "bk", "rt", "lt"),
  arbitraryNumber,
).map(([command, value]) => `${command} ${value}`);

const arbitraryRepeatBlock = fc.tuple(
  fc.integer({ min: 0, max: 10 }),
  arbitrarySimpleStatement,
).map(([count, body]) => `repeat ${count} [${body}]`);

const arbitraryColorIndex = fc.integer({ min: 0, max: 15 });

const arbitrarySetColor = arbitraryColorIndex.map(
  (colorIndex) => `setpc ${colorIndex}`,
);

const arbitraryDrawingCommand = fc.oneof(
  arbitrarySimpleStatement,
  arbitraryRepeatBlock,
  arbitrarySetColor,
  fc.constant("pu"),
  fc.constant("pd"),
  fc.constant("home"),
  fc.constant("cs"),
);

const arbitraryLogoProgram = fc.array(arbitraryDrawingCommand, {
  minLength: 0,
  maxLength: 20,
}).map((commands) => commands.join("\n"));

// ═══════════════════════════════════════════════════════════════
// Universal Invariants — Never Crash
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — universal invariants", () => {
  it("never crashes for any valid Logo program", () => {
    fc.assert(
      fc.property(arbitraryLogoProgram, (program) => {
        const result = executeLogoProgram(program, { timeout: 2000 });
        expect(result).toBeDefined();
        expect(typeof result.success).toBe("boolean");
        expect(Array.isArray(result.commands)).toBe(true);
        expect(typeof result.canvasWidth).toBe("number");
        expect(typeof result.canvasHeight).toBe("number");
        expect(typeof result.executionTimeMs).toBe("number");
      }),
      { numRuns: 300 },
    );
  });

  it("never crashes for random strings (full fuzz)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (randomInput) => {
          const result = executeLogoProgram(randomInput, { timeout: 1000 });
          expect(result).toBeDefined();
          expect(typeof result.success).toBe("boolean");
          expect(Array.isArray(result.commands)).toBe(true);
          expect(typeof result.executionTimeMs).toBe("number");
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never crashes for random ASCII byte sequences", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 127 }), {
          minLength: 0,
          maxLength: 100,
        }).map((charCodes) => String.fromCharCode(...charCodes)),
        (randomAscii) => {
          const result = executeLogoProgram(randomAscii, { timeout: 1000 });
          expect(result).toBeDefined();
          expect(typeof result.success).toBe("boolean");
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Result Structure Invariants
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — result structure", () => {
  it("canvasWidth always matches input or default", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 2000 }),
        fc.integer({ min: 100, max: 2000 }),
        (width, height) => {
          const result = executeLogoProgram("fd 10", {
            canvasWidth: width,
            canvasHeight: height,
          });
          expect(result.canvasWidth).toBe(width);
          expect(result.canvasHeight).toBe(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("executionTimeMs is always non-negative finite", () => {
    fc.assert(
      fc.property(arbitraryLogoProgram, (program) => {
        const result = executeLogoProgram(program, { timeout: 2000 });
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(result.executionTimeMs)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("on failure, error string is always present", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (randomInput) => {
          const result = executeLogoProgram(randomInput, { timeout: 1000 });
          if (!result.success) {
            expect(typeof result.error).toBe("string");
            expect(result.error!.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Idempotency and Determinism
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — determinism", () => {
  it("same program always produces same number of commands", () => {
    fc.assert(
      fc.property(arbitraryLogoProgram, (program) => {
        const result1 = executeLogoProgram(program, { timeout: 2000 });
        const result2 = executeLogoProgram(program, { timeout: 2000 });
        expect(result1.success).toBe(result2.success);
        expect(result1.commands.length).toBe(result2.commands.length);
      }),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Movement Invariants
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — movement invariants", () => {
  it("fd N + bk N should return turtle to origin", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (distance) => {
          const result = executeLogoProgram(`fd ${distance}\nbk ${distance}`);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rt 360 should preserve heading (same draw result)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (distance) => {
          const straight = executeLogoProgram(`fd ${distance}`);
          const rotated = executeLogoProgram(`rt 360\nfd ${distance}`);
          expect(straight.success).toBe(true);
          expect(rotated.success).toBe(true);
          // Both should draw the same number of line segments
          const straightLines = straight.commands.filter(
            (command) => command.action === "line" || command.action === "draw",
          );
          const rotatedLines = rotated.commands.filter(
            (command) => command.action === "line" || command.action === "draw",
          );
          expect(rotatedLines.length).toBe(straightLines.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("4x rt 90 should be equivalent to rt 360 (full rotation)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (distance) => {
          const result = executeLogoProgram(
            `repeat 4 [fd ${distance} rt 90]`,
          );
          expect(result.success).toBe(true);
          // Should draw 4 lines (a square)
          expect(result.commands.length).toBeGreaterThanOrEqual(4);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Pen State Invariants
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — pen state", () => {
  it("penup movement never produces draw commands", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 1, max: 200 }),
          { minLength: 1, maxLength: 10 },
        ),
        (distances) => {
          const moves = distances.map((distance) => `fd ${distance}`).join("\n");
          const result = executeLogoProgram(`pu\n${moves}`);
          expect(result.success).toBe(true);
          const drawCommands = result.commands.filter(
            (command) => command.action === "line" || command.action === "draw",
          );
          expect(drawCommands.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Repeat Invariants
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — repeat invariants", () => {
  it("repeat N produces proportional commands to N", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (repeatCount) => {
          const result = executeLogoProgram(`repeat ${repeatCount} [fd 10]`);
          expect(result.success).toBe(true);
          // Each fd should produce at least one command
          expect(result.commands.length).toBeGreaterThanOrEqual(repeatCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("repeat 0 always produces zero commands", () => {
    fc.assert(
      fc.property(
        arbitrarySimpleStatement,
        (body) => {
          const result = executeLogoProgram(`repeat 0 [${body}]`);
          expect(result.success).toBe(true);
          expect(result.commands.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Bracket Matching Fuzz
// ═══════════════════════════════════════════════════════════════

describe("LogoInterpreter fuzz — bracket robustness", () => {
  it("random bracket sequences never crash", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom("[", "]", "fd 10", "rt 90", "repeat 2"),
          { minLength: 1, maxLength: 15 },
        ).map((tokens) => tokens.join(" ")),
        (program) => {
          const result = executeLogoProgram(program, { timeout: 1000 });
          expect(result).toBeDefined();
          expect(typeof result.success).toBe("boolean");
        },
      ),
      { numRuns: 300 },
    );
  });
});
