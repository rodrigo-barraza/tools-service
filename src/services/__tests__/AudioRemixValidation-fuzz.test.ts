import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateAudioRemixInput } from "../AudioRemixValidation.ts";

// ═══════════════════════════════════════════════════════════════
// FUZZ / PROPERTY-BASED TESTS — AudioRemixValidation
//
// Verifies that validation always returns string|null, correctly
// classifies valid/invalid inputs, and never crashes across
// thousands of randomized operation configurations.
// ═══════════════════════════════════════════════════════════════

const VALID_OPERATION_TYPES = [
  "pitch_shift", "tempo", "speed", "reverb", "echo", "lowpass",
  "highpass", "bandpass", "equalizer", "bass_boost", "treble_boost",
  "distortion", "chorus", "flanger", "phaser", "tremolo", "vibrato",
  "compressor", "normalize", "reverse", "fade_in", "fade_out",
  "trim", "volume", "stereo_pan", "bitcrush", "crystalizer",
];

const VALID_PRESETS = [
  "chipmunk", "demon_voice", "nightcore", "vaporwave",
  "slowed_reverb", "underwater", "radio", "telephone",
  "robot", "cave", "vinyl", "megaphone",
];

const arbitraryValidInput = fc.constantFrom(
  "https://example.com/audio.mp3",
  "http://example.com/audio.wav",
  "data:audio/wav;base64,UklGRg==",
  "/tmp/audio.wav",
);

// ═══════════════════════════════════════════════════════════════
// Universal Invariants
// ═══════════════════════════════════════════════════════════════

describe("AudioRemixValidation fuzz — universal invariants", () => {
  it("always returns string or null", () => {
    fc.assert(
      fc.property(
        fc.record({
          input: fc.option(fc.string(), { nil: undefined }),
          preset: fc.option(fc.string(), { nil: undefined }),
          outputFormat: fc.option(fc.string(), { nil: undefined }),
          sampleRate: fc.option(fc.integer(), { nil: undefined }),
        }),
        (config) => {
          const result = validateAudioRemixInput(config as any);
          expect(result === null || typeof result === "string").toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Input Source Properties
// ═══════════════════════════════════════════════════════════════

describe("AudioRemixValidation fuzz — input source", () => {
  it("valid input sources always pass (without operations)", () => {
    fc.assert(
      fc.property(arbitraryValidInput, (input) => {
        expect(validateAudioRemixInput({ input })).toBeNull();
      }),
      { numRuns: 50 },
    );
  });

  it("random strings without valid prefix always fail", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (value) =>
            !value.trimStart().startsWith("http://") &&
            !value.trimStart().startsWith("https://") &&
            !value.trimStart().startsWith("data:") &&
            !value.trimStart().startsWith("/"),
        ),
        (input) => {
          const result = validateAudioRemixInput({ input });
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Preset Properties
// ═══════════════════════════════════════════════════════════════

describe("AudioRemixValidation fuzz — preset", () => {
  it("valid presets always pass", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.constantFrom(...VALID_PRESETS),
        (input, preset) => {
          expect(validateAudioRemixInput({ input, preset })).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("random non-valid preset strings always fail", () => {
    const presetSet = new Set(VALID_PRESETS);
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (value) => !presetSet.has(value),
        ),
        (input, preset) => {
          const result = validateAudioRemixInput({ input, preset });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid preset");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// SampleRate Properties
// ═══════════════════════════════════════════════════════════════

describe("AudioRemixValidation fuzz — sampleRate", () => {
  it("sampleRate in [8000, 48000] always passes", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.integer({ min: 8000, max: 48000 }),
        (input, sampleRate) => {
          expect(validateAudioRemixInput({ input, sampleRate })).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("sampleRate outside [8000, 48000] always fails", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.oneof(
          fc.integer({ min: 0, max: 7999 }),
          fc.integer({ min: 48001, max: 200000 }),
        ),
        (input, sampleRate) => {
          const result = validateAudioRemixInput({ input, sampleRate });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid sampleRate");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Operation Type Properties
// ═══════════════════════════════════════════════════════════════

describe("AudioRemixValidation fuzz — operation types", () => {
  it("valid operation types always pass", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.constantFrom(...VALID_OPERATION_TYPES),
        (input, operationType) => {
          expect(
            validateAudioRemixInput({
              input,
              operations: [{ type: operationType }],
            }),
          ).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("invalid operation types always fail", () => {
    const operationTypeSet = new Set(VALID_OPERATION_TYPES);
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (value) => !operationTypeSet.has(value),
        ),
        (input, operationType) => {
          const result = validateAudioRemixInput({
            input,
            operations: [{ type: operationType }],
          });
          expect(result).not.toBeNull();
          expect(result).toContain("unknown operation type");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Per-Operation Parameter Range Properties
// ═══════════════════════════════════════════════════════════════

describe("AudioRemixValidation fuzz — pitch_shift semitones", () => {
  it("semitones in [-24, 24] always passes", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.integer({ min: -24, max: 24 }),
        (input, semitones) => {
          expect(validateAudioRemixInput({
            input,
            operations: [{ type: "pitch_shift", semitones }],
          })).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("semitones outside [-24, 24] always fails", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.oneof(
          fc.integer({ min: -100, max: -25 }),
          fc.integer({ min: 25, max: 100 }),
        ),
        (input, semitones) => {
          const result = validateAudioRemixInput({
            input,
            operations: [{ type: "pitch_shift", semitones }],
          });
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("AudioRemixValidation fuzz — tempo/speed factor", () => {
  it("factor in [0.25, 4.0] always passes", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.constantFrom("tempo", "speed"),
        fc.double({ min: 0.25, max: 4.0, noNaN: true }),
        (input, operationType, factor) => {
          expect(validateAudioRemixInput({
            input,
            operations: [{ type: operationType, factor }],
          })).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("factor outside [0.25, 4.0] always fails", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.constantFrom("tempo", "speed"),
        fc.oneof(
          fc.double({ min: -10, max: 0.249, noNaN: true }),
          fc.double({ min: 4.001, max: 100, noNaN: true }),
        ),
        (input, operationType, factor) => {
          const result = validateAudioRemixInput({
            input,
            operations: [{ type: operationType, factor }],
          });
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("AudioRemixValidation fuzz — volume level", () => {
  it("level in [0, 3.0] always passes", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.double({ min: 0, max: 3.0, noNaN: true }),
        (input, level) => {
          expect(validateAudioRemixInput({
            input,
            operations: [{ type: "volume", level }],
          })).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("level outside [0, 3.0] always fails", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.oneof(
          fc.double({ min: -10, max: -0.001, noNaN: true }),
          fc.double({ min: 3.001, max: 100, noNaN: true }),
        ),
        (input, level) => {
          const result = validateAudioRemixInput({
            input,
            operations: [{ type: "volume", level }],
          });
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("AudioRemixValidation fuzz — stereo_pan", () => {
  it("pan in [-1, 1] always passes", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.double({ min: -1, max: 1, noNaN: true }),
        (input, pan) => {
          expect(validateAudioRemixInput({
            input,
            operations: [{ type: "stereo_pan", pan }],
          })).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("pan outside [-1, 1] always fails", () => {
    fc.assert(
      fc.property(
        arbitraryValidInput,
        fc.oneof(
          fc.double({ min: -100, max: -1.001, noNaN: true }),
          fc.double({ min: 1.001, max: 100, noNaN: true }),
        ),
        (input, pan) => {
          const result = validateAudioRemixInput({
            input,
            operations: [{ type: "stereo_pan", pan }],
          });
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
