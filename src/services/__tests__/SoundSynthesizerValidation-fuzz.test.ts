import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateSynthesizerInput } from "../SoundSynthesizerValidation.ts";
import { INSTRUMENT_PRESETS } from "../SoundSynthesizerService.ts";
import type { SynthesizerConfig } from "../SoundSynthesizerService.ts";

// ═══════════════════════════════════════════════════════════════
// FUZZ / PROPERTY-BASED TESTS — SoundSynthesizerValidation
//
// Verifies that validation never crashes, always returns
// string|null, and correctly classifies valid/invalid inputs
// across thousands of randomized configurations.
// ═══════════════════════════════════════════════════════════════

const VALID_SOUND_TYPES = ["synthesizer", "sound_effect", "modular"];
const VALID_WAVEFORMS = ["sine", "triangle", "sawtooth", "square", "noise"];
const VALID_NODE_TYPES = [
  "oscillator", "noise", "biquad_filter", "envelope", "delay",
  "stereo_panner", "gain", "reverb", "drum_synth", "distortion",
];

// ═══════════════════════════════════════════════════════════════
// Universal Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — universal invariants", () => {
  it("never throws regardless of input shape", () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (randomInput) => {
          // Must never throw
          const result = validateSynthesizerInput(randomInput as SynthesizerConfig);
          expect(result === null || typeof result === "string").toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("empty config always passes", () => {
    const result = validateSynthesizerInput({});
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Frequency Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — frequency", () => {
  it("frequency in [1, 22050] always passes", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 22050, noNaN: true }),
        (frequency) => {
          expect(validateSynthesizerInput({ frequency })).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("frequency outside [1, 22050] always fails (when not NaN)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -10000, max: 0.99, noNaN: true }),
          fc.double({ min: 22050.01, max: 100000, noNaN: true }),
        ),
        (frequency) => {
          const result = validateSynthesizerInput({ frequency });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid frequency");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Duration Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — duration", () => {
  it("duration in [0.01, 60.0] always passes", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 60.0, noNaN: true }),
        (duration) => {
          expect(validateSynthesizerInput({ duration })).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("duration outside [0.01, 60.0] always fails", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -100, max: 0.0099, noNaN: true }),
          fc.double({ min: 60.01, max: 1000, noNaN: true }),
        ),
        (duration) => {
          const result = validateSynthesizerInput({ duration });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid duration");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// SampleRate Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — sampleRate", () => {
  it("sampleRate in [8000, 48000] always passes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8000, max: 48000 }),
        (sampleRate) => {
          expect(validateSynthesizerInput({ sampleRate })).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("sampleRate outside [8000, 48000] always fails", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 0, max: 7999 }),
          fc.integer({ min: 48001, max: 200000 }),
        ),
        (sampleRate) => {
          const result = validateSynthesizerInput({ sampleRate });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid sampleRate");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Tempo Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — tempo", () => {
  it("tempo in [20, 999] always passes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 999 }),
        (tempo) => {
          expect(validateSynthesizerInput({ tempo })).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("tempo outside [20, 999] always fails", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -100, max: 19 }),
          fc.integer({ min: 1000, max: 10000 }),
        ),
        (tempo) => {
          const result = validateSynthesizerInput({ tempo });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid tempo");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// SoundType Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — soundType", () => {
  it("valid soundTypes always pass", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_SOUND_TYPES),
        (soundType) => {
          // Melody/arpeggio need melody, modular needs tracks+nodes
          if (soundType === "modular") return;
          expect(validateSynthesizerInput({ soundType: soundType as any })).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("random non-valid soundType strings always fail", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (value) => !VALID_SOUND_TYPES.includes(value),
        ),
        (soundType) => {
          const result = validateSynthesizerInput({ soundType: soundType as any });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid soundType");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Waveform Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — waveform", () => {
  it("valid waveforms always pass", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_WAVEFORMS),
        (waveform) => {
          expect(validateSynthesizerInput({ waveform: waveform as any })).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("random non-valid waveform strings always fail", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (value) => !VALID_WAVEFORMS.includes(value),
        ),
        (waveform) => {
          const result = validateSynthesizerInput({ waveform: waveform as any });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid waveform");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Instrument Preset Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — instrument", () => {
  it("all INSTRUMENT_PRESETS keys are always valid", () => {
    for (const instrument of Object.keys(INSTRUMENT_PRESETS)) {
      expect(validateSynthesizerInput({ instrument })).toBeNull();
    }
  });

  it("random non-preset instrument strings always fail", () => {
    const validKeys = new Set(Object.keys(INSTRUMENT_PRESETS));
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (value) => !validKeys.has(value),
        ),
        (instrument) => {
          const result = validateSynthesizerInput({ instrument });
          expect(result).not.toBeNull();
          expect(result).toContain("Invalid instrument");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Node Type Validation Properties
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — node types", () => {
  it("all valid node types pass when used in modular config", () => {
    for (const nodeType of VALID_NODE_TYPES) {
      const result = validateSynthesizerInput({
        soundType: "modular",
        nodes: { testNode: { type: nodeType as any } },
        tracks: [{
          nodeChain: ["testNode", "destination"],
          notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }],
        }],
      } as any);
      expect(result).toBeNull();
    }
  });

  it("random non-valid node types always fail", () => {
    const validNodeSet = new Set(VALID_NODE_TYPES);
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (value) => !validNodeSet.has(value),
        ),
        (nodeType) => {
          const result = validateSynthesizerInput({
            soundType: "modular",
            nodes: { testNode: { type: nodeType } },
            tracks: [{
              nodeChain: ["testNode"],
              notes: [{ time: 0, duration: 0.5, note: "C4" }],
            }],
          } as any);
          expect(result).not.toBeNull();
          expect(result).toContain("invalid type");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Combined Valid Config Property
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation fuzz — combined valid configs", () => {
  it("fully valid synthesizer configs always pass", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_WAVEFORMS),
        fc.double({ min: 1, max: 22050, noNaN: true }),
        fc.double({ min: 0.01, max: 60.0, noNaN: true }),
        fc.constantFrom(8000, 22050, 44100, 48000),
        (waveform, frequency, duration, sampleRate) => {
          const result = validateSynthesizerInput({
            soundType: "synthesizer",
            waveform: waveform as any,
            frequency,
            duration,
            sampleRate,
          });
          expect(result).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
