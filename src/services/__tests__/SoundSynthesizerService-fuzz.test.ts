import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  noteToFreq,
  parseBeatDuration,
  parseTimeMarker,
  getEnvelopeValue,
  applySwingOffset,
  computeSixteenthIndex,
  BiquadFilter,
  createWavBuffer,
} from "../SoundSynthesizerService.ts";
import type { ADSREnvelope } from "../SoundSynthesizerService.ts";

// ═══════════════════════════════════════════════════════════════
// FUZZ / PROPERTY-BASED TESTS — SoundSynthesizerService
//
// Verifies mathematical invariants of the DSP engine and music
// theory functions hold across thousands of randomized inputs.
// ═══════════════════════════════════════════════════════════════

// ── Custom Arbitraries ──────────────────────────────────────

const arbitraryNoteName = fc.constantFrom(
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Db", "Eb", "Gb", "Ab", "Bb",
);

const arbitraryOctave = fc.integer({ min: 0, max: 8 });

const arbitraryNoteString = fc.tuple(arbitraryNoteName, arbitraryOctave).map(
  ([name, octave]) => `${name}${octave}`,
);

const arbitraryTempo = fc.integer({ min: 20, max: 999 });

const arbitraryADSR: fc.Arbitrary<ADSREnvelope> = fc.record({
  attack: fc.double({ min: 0, max: 2, noNaN: true }),
  decay: fc.double({ min: 0, max: 2, noNaN: true }),
  sustain: fc.double({ min: 0, max: 1, noNaN: true }),
  release: fc.double({ min: 0, max: 2, noNaN: true }),
});

const arbitraryDuration = fc.double({ min: 0.01, max: 10, noNaN: true });

// ═══════════════════════════════════════════════════════════════
// noteToFreq — Frequency Conversion Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — noteToFreq invariants", () => {
  it("numeric input always passes through unchanged", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }),
        (frequency) => {
          expect(noteToFreq(frequency)).toBe(frequency);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("valid note strings always produce positive finite frequency", () => {
    fc.assert(
      fc.property(arbitraryNoteString, (noteString) => {
        const frequency = noteToFreq(noteString);
        expect(Number.isFinite(frequency)).toBe(true);
        expect(frequency).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it("octave+1 always doubles the frequency (equal temperament)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("C", "D", "E", "F", "G", "A", "B"),
        fc.integer({ min: 1, max: 7 }),
        (noteName, octave) => {
          const lowerFrequency = noteToFreq(`${noteName}${octave}`);
          const higherFrequency = noteToFreq(`${noteName}${octave + 1}`);
          expect(higherFrequency / lowerFrequency).toBeCloseTo(2.0, 3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("same note at higher octave always has higher frequency", () => {
    fc.assert(
      fc.property(
        arbitraryNoteName,
        fc.integer({ min: 0, max: 7 }),
        (noteName, octave) => {
          const lower = noteToFreq(`${noteName}${octave}`);
          const higher = noteToFreq(`${noteName}${octave + 1}`);
          expect(higher).toBeGreaterThan(lower);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("'rest' and 'silence' always produce 0 regardless of case", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("rest", "REST", "Rest", "silence", "SILENCE", "Silence"),
        (silentNote) => {
          expect(noteToFreq(silentNote)).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// parseBeatDuration — Duration Math Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — parseBeatDuration invariants", () => {
  it("numeric input always passes through unchanged", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        (duration) => {
          expect(parseBeatDuration(duration, 120)).toBe(duration);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("beat fraction produces positive finite duration for any valid tempo", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("1/1", "1/2", "1/4", "1/8", "1/16", "1/32"),
        arbitraryTempo,
        (fraction, tempo) => {
          const duration = parseBeatDuration(fraction, tempo);
          expect(duration).toBeGreaterThan(0);
          expect(Number.isFinite(duration)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("dotted duration is always 1.5x the undotted duration", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("1", "2", "4", "8", "16"),
        arbitraryTempo,
        (denominator, tempo) => {
          const undotted = parseBeatDuration(`1/${denominator}`, tempo);
          const dotted = parseBeatDuration(`1/${denominator}d`, tempo);
          expect(dotted).toBeCloseTo(undotted * 1.5, 8);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("triplet duration is always 2/3 of the undotted duration", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("1", "2", "4", "8", "16"),
        arbitraryTempo,
        (denominator, tempo) => {
          const undotted = parseBeatDuration(`1/${denominator}`, tempo);
          const triplet = parseBeatDuration(`1/${denominator}t`, tempo);
          expect(triplet).toBeCloseTo(undotted * (2 / 3), 8);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("faster tempo always produces shorter durations for same fraction", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("1/4", "1/8", "1/16"),
        fc.integer({ min: 20, max: 500 }),
        fc.integer({ min: 20, max: 500 }),
        (fraction, tempoA, tempoB) => {
          const slower = Math.min(tempoA, tempoB);
          const faster = Math.max(tempoA, tempoB);
          if (slower === faster) return;

          const durationSlow = parseBeatDuration(fraction, slower);
          const durationFast = parseBeatDuration(fraction, faster);
          expect(durationSlow).toBeGreaterThan(durationFast);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// parseTimeMarker — Time Marker Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — parseTimeMarker invariants", () => {
  it("numeric input always passes through", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (time) => {
          expect(parseTimeMarker(time)).toBe(time);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("higher bar number always produces later time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        arbitraryTempo,
        (barA, barB, tempo) => {
          if (barA === barB) return;
          const smaller = Math.min(barA, barB);
          const larger = Math.max(barA, barB);
          const timeSmaller = parseTimeMarker(`${smaller}.1.1`, tempo, 4);
          const timeLarger = parseTimeMarker(`${larger}.1.1`, tempo, 4);
          expect(timeLarger).toBeGreaterThan(timeSmaller);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("result is always non-negative for valid bar.beat.sixteenth", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 4 }),
        arbitraryTempo,
        (bar, beat, sixteenth, tempo) => {
          const time = parseTimeMarker(`${bar}.${beat}.${sixteenth}`, tempo, 4);
          expect(time).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// getEnvelopeValue — ADSR Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — getEnvelopeValue invariants", () => {
  it("value is always between 0 and 1 for time in [0, totalDuration]", () => {
    fc.assert(
      fc.property(
        arbitraryADSR,
        arbitraryDuration,
        (adsr, totalDuration) => {
          // Sample at 20 evenly spaced points
          for (let i = 0; i <= 20; i++) {
            const time = (i / 20) * totalDuration;
            const value = getEnvelopeValue(time, totalDuration, adsr);
            expect(value).toBeGreaterThanOrEqual(-0.001); // Small float tolerance
            expect(value).toBeLessThanOrEqual(1.001);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("value at time=0 with positive attack is always 0 (start of ramp)", () => {
    fc.assert(
      fc.property(
        arbitraryADSR.filter((adsr) => adsr.attack >= 0.001),
        arbitraryDuration,
        (adsr, totalDuration) => {
          const value = getEnvelopeValue(0, totalDuration, adsr);
          expect(value).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("value beyond totalDuration is always 0", () => {
    fc.assert(
      fc.property(
        arbitraryADSR,
        arbitraryDuration,
        fc.double({ min: 0.01, max: 10, noNaN: true }),
        (adsr, totalDuration, overshoot) => {
          const value = getEnvelopeValue(
            totalDuration + overshoot,
            totalDuration,
            adsr,
          );
          expect(value).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("result is always a finite number", () => {
    fc.assert(
      fc.property(
        arbitraryADSR,
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        (adsr, time, totalDuration) => {
          const value = getEnvelopeValue(time, totalDuration, adsr);
          expect(Number.isFinite(value)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// applySwingOffset — Swing Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — applySwingOffset invariants", () => {
  it("even indices always return 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }).map((n) => n * 2),
        fc.double({ min: 0, max: 1, noNaN: true }),
        arbitraryTempo,
        (evenIndex, swingAmount, tempo) => {
          expect(applySwingOffset(evenIndex, swingAmount, tempo)).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("odd indices with positive swing always return positive offset", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }).map((n) => n * 2 + 1),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        arbitraryTempo,
        (oddIndex, swingAmount, tempo) => {
          const offset = applySwingOffset(oddIndex, swingAmount, tempo);
          expect(offset).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("higher swing amount produces larger offset (monotonic)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }).map((n) => n * 2 + 1),
        fc.double({ min: 0.01, max: 0.49, noNaN: true }),
        arbitraryTempo,
        (oddIndex, swingA, tempo) => {
          const swingB = swingA + 0.5; // Always larger
          const offsetA = applySwingOffset(oddIndex, swingA, tempo);
          const offsetB = applySwingOffset(oddIndex, swingB, tempo);
          expect(offsetB).toBeGreaterThan(offsetA);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// computeSixteenthIndex — Quantization Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — computeSixteenthIndex invariants", () => {
  it("result is always a non-negative integer", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        arbitraryTempo,
        (timeInSeconds, tempo) => {
          const index = computeSixteenthIndex(timeInSeconds, tempo);
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("higher time always produces higher or equal index (monotonic)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        arbitraryTempo,
        (timeA, timeB, tempo) => {
          const smaller = Math.min(timeA, timeB);
          const larger = Math.max(timeA, timeB);
          const indexSmaller = computeSixteenthIndex(smaller, tempo);
          const indexLarger = computeSixteenthIndex(larger, tempo);
          expect(indexLarger).toBeGreaterThanOrEqual(indexSmaller);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// BiquadFilter — DSP Stability Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — BiquadFilter stability", () => {
  it("process() always returns finite number for finite input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("lowpass", "highpass", "bandpass") as fc.Arbitrary<
          "lowpass" | "highpass" | "bandpass"
        >,
        fc.double({ min: 10, max: 20000, noNaN: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 100,
        }),
        (filterType, cutoff, q, samples) => {
          const filter = new BiquadFilter(filterType, 44100);
          filter.updateCoefficients(cutoff, q);
          for (const sample of samples) {
            const output = filter.process(sample);
            expect(Number.isFinite(output)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// createWavBuffer — WAV Format Invariants
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerService fuzz — createWavBuffer invariants", () => {
  it("output length is always 44 + (samples.length * 2)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: 0,
          maxLength: 200,
        }),
        fc.constantFrom(8000, 22050, 44100, 48000),
        (samples, sampleRate) => {
          const buffer = createWavBuffer(new Float32Array(samples), sampleRate);
          expect(buffer.length).toBe(44 + samples.length * 2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("RIFF/WAVE headers are always present", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: 0,
          maxLength: 50,
        }),
        fc.constantFrom(8000, 44100),
        (samples, sampleRate) => {
          const buffer = createWavBuffer(new Float32Array(samples), sampleRate);
          expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
          expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
          expect(buffer.toString("ascii", 12, 16)).toBe("fmt ");
          expect(buffer.toString("ascii", 36, 40)).toBe("data");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sample rate in header always matches input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8000, 11025, 22050, 44100, 48000),
        (sampleRate) => {
          const buffer = createWavBuffer(new Float32Array([0.5]), sampleRate);
          expect(buffer.readUInt32LE(24)).toBe(sampleRate);
        },
      ),
      { numRuns: 50 },
    );
  });
});
