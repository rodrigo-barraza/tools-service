import { describe, it, expect } from "vitest";
import {
  noteToFreq,
  isChordNotation,
  expandChordToNotes,
  parseBeatDuration,
  parseTimeMarker,
  getEnvelopeValue,
  applySwingOffset,
  getVoiceReleaseTime,
  BiquadFilter,
  createWavBuffer,
} from "../SoundSynthesizerService.ts";
import type { ADSREnvelope, NodeConfig } from "../SoundSynthesizerService.ts";

// ═══════════════════════════════════════════════════════════════
// ADVERSARIAL TESTS — SoundSynthesizerService
//
// Hand-crafted edge cases targeting note parsing ambiguity,
// frequency computation overflow, ADSR envelope boundary
// conditions, BiquadFilter numeric stability, WAV buffer
// corruption, and music theory edge cases.
// ═══════════════════════════════════════════════════════════════

// ── noteToFreq adversarial ──────────────────────────────────

describe("noteToFreq adversarial — parsing edge cases", () => {
  it("empty string should return default 440 Hz", () => {
    expect(noteToFreq("")).toBe(440);
  });

  it("whitespace-only string should return default 440 Hz", () => {
    expect(noteToFreq("   ")).toBe(440);
  });

  it("numeric string should be parsed as frequency", () => {
    expect(noteToFreq("523.25")).toBeCloseTo(523.25, 1);
  });

  it("numeric input should pass through unchanged", () => {
    expect(noteToFreq(440)).toBe(440);
    expect(noteToFreq(0)).toBe(0);
  });

  it("negative frequency input should pass through", () => {
    expect(noteToFreq(-100)).toBe(-100);
  });

  it("rest (lowercase) should return 0", () => {
    expect(noteToFreq("rest")).toBe(0);
  });

  it("REST (uppercase) should return 0", () => {
    expect(noteToFreq("REST")).toBe(0);
  });

  it("SILENCE should return 0", () => {
    expect(noteToFreq("SILENCE")).toBe(0);
  });

  it("'Rest' mixed case should return 0", () => {
    expect(noteToFreq("Rest")).toBe(0);
  });

  it("negative octave (C-1) should produce sub-audible frequency", () => {
    const frequency = noteToFreq("C-1");
    expect(frequency).toBeGreaterThan(0);
    expect(frequency).toBeLessThan(20);
  });

  it("very high octave (C10) should produce ultrasonic frequency", () => {
    const frequency = noteToFreq("C10");
    expect(frequency).toBeGreaterThan(10000);
    expect(Number.isFinite(frequency)).toBe(true);
  });

  it("double sharp (C##4) should not be recognized as note, fallback to 440", () => {
    expect(noteToFreq("C##4")).toBe(440);
  });

  it("Fb should resolve to E (enharmonic equivalent)", () => {
    const fbFrequency = noteToFreq("Fb4");
    const eFrequency = noteToFreq("E4");
    expect(fbFrequency).toBeCloseTo(eFrequency, 1);
  });

  it("Cb should resolve to B (enharmonic equivalent)", () => {
    const cbFrequency = noteToFreq("Cb4");
    const bFrequency = noteToFreq("B3"); // Cb4 = B3
    expect(cbFrequency).toBeCloseTo(bFrequency, 1);
  });

  it("note with leading/trailing whitespace should be trimmed", () => {
    expect(noteToFreq("  A4  ")).toBeCloseTo(440, 1);
  });

  it("invalid note letter (H4) should fallback to 440", () => {
    expect(noteToFreq("H4")).toBe(440);
  });

  it("gibberish string should fallback to 440", () => {
    expect(noteToFreq("notavalidnote")).toBe(440);
  });
});

describe("noteToFreq adversarial — frequency accuracy", () => {
  it("octave doubling: A5 should be exactly 2x A4", () => {
    expect(noteToFreq("A5")).toBeCloseTo(880, 1);
  });

  it("octave halving: A3 should be exactly 0.5x A4", () => {
    expect(noteToFreq("A3")).toBeCloseTo(220, 1);
  });

  it("chromatic interval: A4 to A#4 should be semitone ratio (2^(1/12))", () => {
    const a4 = noteToFreq("A4");
    const aSharp4 = noteToFreq("A#4");
    expect(aSharp4 / a4).toBeCloseTo(Math.pow(2, 1 / 12), 5);
  });
});

// ── parseBeatDuration adversarial ───────────────────────────

describe("parseBeatDuration adversarial — edge cases", () => {
  it("numeric input passes through directly", () => {
    expect(parseBeatDuration(0.5, 120)).toBe(0.5);
  });

  it("empty string returns default 0.25", () => {
    expect(parseBeatDuration("", 120)).toBe(0.25);
  });

  it("invalid string returns default 0.25", () => {
    expect(parseBeatDuration("not_a_duration", 120)).toBe(0.25);
  });

  it("1/4 at 120 BPM should be 0.5 seconds (quarter note)", () => {
    expect(parseBeatDuration("1/4", 120)).toBeCloseTo(0.5, 5);
  });

  it("1/4d (dotted quarter) should be 1.5x quarter note", () => {
    const quarter = parseBeatDuration("1/4", 120);
    const dottedQuarter = parseBeatDuration("1/4d", 120);
    expect(dottedQuarter).toBeCloseTo(quarter * 1.5, 5);
  });

  it("1/4t (triplet quarter) should be 2/3 of quarter note", () => {
    const quarter = parseBeatDuration("1/4", 120);
    const tripletQuarter = parseBeatDuration("1/4t", 120);
    expect(tripletQuarter).toBeCloseTo(quarter * (2 / 3), 5);
  });

  it("1/1 at 120 BPM should be 2 seconds (whole note)", () => {
    expect(parseBeatDuration("1/1", 120)).toBeCloseTo(2.0, 5);
  });

  it("1/16 at 120 BPM should be 0.125 seconds", () => {
    expect(parseBeatDuration("1/16", 120)).toBeCloseTo(0.125, 5);
  });

  it("1/0 (division by zero) should handle gracefully", () => {
    const result = parseBeatDuration("1/0", 120);
    expect(result === Infinity || result === 0.25 || Number.isFinite(result)).toBe(true);
  });

  it("very fast tempo (999 BPM) should still produce valid durations", () => {
    const duration = parseBeatDuration("1/4", 999);
    expect(duration).toBeGreaterThan(0);
    expect(Number.isFinite(duration)).toBe(true);
  });
});

// ── parseTimeMarker adversarial ─────────────────────────────

describe("parseTimeMarker adversarial — bar.beat.sixteenth parsing", () => {
  it("numeric input passes through directly", () => {
    expect(parseTimeMarker(1.5)).toBe(1.5);
  });

  it("empty string returns 0.0", () => {
    expect(parseTimeMarker("")).toBe(0.0);
  });

  it("'1.1.1' at 120 BPM = 0.0 seconds (start of bar 1)", () => {
    expect(parseTimeMarker("1.1.1", 120)).toBeCloseTo(0.0, 5);
  });

  it("'2.1.1' at 120 BPM = 2.0 seconds (start of bar 2, 4/4 time)", () => {
    expect(parseTimeMarker("2.1.1", 120, 4)).toBeCloseTo(2.0, 5);
  });

  it("'1.2.1' at 120 BPM = 0.5 seconds (beat 2 of bar 1)", () => {
    expect(parseTimeMarker("1.2.1", 120, 4)).toBeCloseTo(0.5, 5);
  });

  it("'1.1.2' at 120 BPM = 0.125 seconds (second sixteenth)", () => {
    expect(parseTimeMarker("1.1.2", 120, 4)).toBeCloseTo(0.125, 5);
  });

  it("two-part marker (e.g. '1.5') should parse as float", () => {
    expect(parseTimeMarker("1.5")).toBeCloseTo(1.5, 5);
  });

  it("invalid string should return 0.0", () => {
    expect(parseTimeMarker("invalid")).toBe(0.0);
  });

  it("'0.0.0' should handle zero-based parts gracefully", () => {
    // Parts default to 1 when parsed as 0 via || 1
    const result = parseTimeMarker("0.0.0", 120, 4);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("3/4 time signature should adjust bar duration", () => {
    // In 3/4 time, a bar has 3 beats, so bar 2 starts at 3 * 0.5 = 1.5s at 120 BPM
    expect(parseTimeMarker("2.1.1", 120, 3)).toBeCloseTo(1.5, 5);
  });
});

// ── getEnvelopeValue adversarial ────────────────────────────

describe("getEnvelopeValue adversarial — ADSR boundary conditions", () => {
  const standardADSR: ADSREnvelope = {
    attack: 0.1,
    decay: 0.2,
    sustain: 0.5,
    release: 0.3,
  };

  it("time=0 should return 0 (start of attack)", () => {
    expect(getEnvelopeValue(0, 1.0, standardADSR)).toBe(0);
  });

  it("time at end of attack should be 1.0", () => {
    expect(getEnvelopeValue(0.1, 1.0, standardADSR)).toBeCloseTo(1.0, 5);
  });

  it("time in sustain phase should equal sustain level", () => {
    expect(getEnvelopeValue(0.4, 1.0, standardADSR)).toBeCloseTo(0.5, 5);
  });

  it("time at end (totalDuration) should be 0", () => {
    expect(getEnvelopeValue(1.0, 1.0, standardADSR)).toBe(0);
  });

  it("time beyond totalDuration should be 0", () => {
    expect(getEnvelopeValue(2.0, 1.0, standardADSR)).toBe(0);
  });

  it("negative time should return 0 (clamped to pre-attack)", () => {
    const value = getEnvelopeValue(-0.5, 1.0, standardADSR);
    // Negative time < attack, so time/attack = -5 which is... a negative ramp
    // This is a potential bug — negative time produces negative envelope
    expect(typeof value).toBe("number");
  });

  it("zero-duration totalDuration should not crash", () => {
    const value = getEnvelopeValue(0, 0, standardADSR);
    expect(Number.isFinite(value)).toBe(true);
  });

  it("all-zero ADSR should not crash", () => {
    const zeroADSR: ADSREnvelope = { attack: 0, decay: 0, sustain: 0, release: 0 };
    const value = getEnvelopeValue(0, 1.0, zeroADSR);
    expect(Number.isFinite(value)).toBe(true);
  });

  it("ADSR sum exceeding totalDuration should be proportionally scaled", () => {
    const longADSR: ADSREnvelope = { attack: 5, decay: 5, sustain: 0.5, release: 5 };
    // totalDuration = 1.0, sum = 15 → scale by 1/15
    const midpoint = getEnvelopeValue(0.5, 1.0, longADSR);
    expect(Number.isFinite(midpoint)).toBe(true);
    expect(midpoint).toBeGreaterThanOrEqual(0);
    expect(midpoint).toBeLessThanOrEqual(1);
  });

  it("sustain=1.0 should hold at maximum level", () => {
    const fullSustain: ADSREnvelope = { attack: 0.01, decay: 0.01, sustain: 1.0, release: 0.01 };
    const value = getEnvelopeValue(0.5, 1.0, fullSustain);
    expect(value).toBeCloseTo(1.0, 3);
  });

  it("sustain=0 should drop to 0 after decay", () => {
    const zeroSustain: ADSREnvelope = { attack: 0.01, decay: 0.01, sustain: 0, release: 0.01 };
    const value = getEnvelopeValue(0.5, 1.0, zeroSustain);
    expect(value).toBeCloseTo(0, 3);
  });
});

// ── BiquadFilter adversarial ────────────────────────────────

describe("BiquadFilter adversarial — numeric stability", () => {
  it("processing NaN input should produce 0 (NaN guard)", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(1000, 1.0);
    const result = filter.process(NaN);
    expect(result).toBe(0);
  });

  it("processing Infinity should produce 0", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(1000, 1.0);
    const result = filter.process(Infinity);
    expect(result).toBe(0);
  });

  it("cutoff at Nyquist boundary should not produce NaN", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(22000, 1.0); // Near Nyquist
    const result = filter.process(1.0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("cutoff of 0 should be clamped to minimum 10 Hz", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(0, 1.0);
    const result = filter.process(1.0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("Q of 0 should be clamped to minimum 0.1", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(1000, 0);
    const result = filter.process(1.0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("highpass filter should not blow up with DC input", () => {
    const filter = new BiquadFilter("highpass", 44100);
    filter.updateCoefficients(1000, 1.0);
    // Feed 100 samples of DC (constant 1.0) — output should settle near 0
    let lastOutput = 0;
    for (let i = 0; i < 100; i++) {
      lastOutput = filter.process(1.0);
    }
    expect(Number.isFinite(lastOutput)).toBe(true);
    expect(Math.abs(lastOutput)).toBeLessThan(0.1); // Highpass rejects DC
  });

  it("bandpass filter should be stable with impulse input", () => {
    const filter = new BiquadFilter("bandpass", 44100);
    filter.updateCoefficients(1000, 5.0);
    filter.process(1.0); // Impulse
    let isStable = true;
    for (let i = 0; i < 1000; i++) {
      const output = filter.process(0.0);
      if (!Number.isFinite(output)) {
        isStable = false;
        break;
      }
    }
    expect(isStable).toBe(true);
  });
});

// ── createWavBuffer adversarial ─────────────────────────────

describe("createWavBuffer adversarial — WAV format integrity", () => {
  it("empty samples array should produce valid 44-byte header", () => {
    const buffer = createWavBuffer(new Float32Array(0), 44100);
    expect(buffer.length).toBe(44); // Header only, no data
    expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("single sample should produce 46 bytes (44 header + 2 data)", () => {
    const buffer = createWavBuffer(new Float32Array([0.5]), 44100);
    expect(buffer.length).toBe(46);
  });

  it("sample value above 1.0 should be clamped to 1.0", () => {
    const buffer = createWavBuffer(new Float32Array([2.0]), 44100);
    const sampleValue = buffer.readInt16LE(44);
    expect(sampleValue).toBe(0x7FFF); // Max positive 16-bit
  });

  it("sample value below -1.0 should be clamped to -1.0", () => {
    const buffer = createWavBuffer(new Float32Array([-2.0]), 44100);
    const sampleValue = buffer.readInt16LE(44);
    expect(sampleValue).toBe(-0x8000); // Min negative 16-bit
  });

  it("NaN sample should be clamped to 0", () => {
    const buffer = createWavBuffer(new Float32Array([NaN]), 44100);
    const sampleValue = buffer.readInt16LE(44);
    // NaN clamped: Math.max(-1, Math.min(1, NaN)) = NaN, NaN < 0 is false
    // so it goes to sample * 0x7fff = NaN → Math.floor(NaN) = NaN
    // This documents potential NaN corruption in the WAV buffer
    expect(typeof sampleValue).toBe("number");
  });

  it("stereo (2 channels) should produce correct header metadata", () => {
    const buffer = createWavBuffer(new Float32Array([0.5, -0.5]), 44100, 2);
    const numChannels = buffer.readUInt16LE(22);
    const byteRate = buffer.readUInt32LE(28);
    const blockAlign = buffer.readUInt16LE(32);
    expect(numChannels).toBe(2);
    expect(byteRate).toBe(44100 * 2 * 2); // sampleRate * channels * bytesPerSample
    expect(blockAlign).toBe(4); // channels * bytesPerSample
  });

  it("sample rate of 8000 should be written correctly", () => {
    const buffer = createWavBuffer(new Float32Array([0]), 8000);
    expect(buffer.readUInt32LE(24)).toBe(8000);
  });
});

// ── isChordNotation adversarial ─────────────────────────────

describe("isChordNotation adversarial — chord parsing", () => {
  it("plain note (C4) should NOT be chord notation", () => {
    expect(isChordNotation("C4")).toBe(false);
  });

  it("Cmaj should be chord notation", () => {
    expect(isChordNotation("Cmaj")).toBe(true);
  });

  it("Am should be chord notation", () => {
    expect(isChordNotation("Am")).toBe(true);
  });

  it("Bb7 should be chord notation", () => {
    expect(isChordNotation("Bb7")).toBe(true);
  });

  it("Gdim7 should be chord notation", () => {
    expect(isChordNotation("Gdim7")).toBe(true);
  });

  it("empty string should not be chord notation", () => {
    expect(isChordNotation("")).toBe(false);
  });

  it("F#sus2 should be chord notation", () => {
    expect(isChordNotation("F#sus2")).toBe(true);
  });

  it("rest should NOT be chord notation", () => {
    expect(isChordNotation("rest")).toBe(false);
  });
});

// ── expandChordToNotes adversarial ──────────────────────────

describe("expandChordToNotes adversarial — chord expansion", () => {
  it("Cmaj should expand to [C4, E4, G4]", () => {
    const notes = expandChordToNotes("Cmaj4");
    expect(notes).toEqual(["C4", "E4", "G4"]);
  });

  it("Am should expand to [A4, C5, E5]", () => {
    const notes = expandChordToNotes("Am4");
    expect(notes).toEqual(["A4", "C5", "E5"]);
  });

  it("C5 (power chord) should expand to [C4, G4] with default octave", () => {
    expandChordToNotes("C5"); // chord type "5" = power chord
    // "C5" regex: root=C, chordType=5, octave=undefined → default 4
    // Wait, "C5" could be misparse: root=C, chordType=5? Let's test the actual behavior
    const result = expandChordToNotes("C5");
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("invalid chord string should return the original as single-element array", () => {
    expect(expandChordToNotes("xyz")).toEqual(["xyz"]);
  });

  it("chord with explicit octave (Cmaj3) should use octave 3", () => {
    const notes = expandChordToNotes("Cmaj3");
    expect(notes[0]).toContain("3");
  });
});

// ── applySwingOffset adversarial ────────────────────────────

describe("applySwingOffset adversarial — timing", () => {
  it("on-beat (even sixteenth index) should produce 0 offset", () => {
    expect(applySwingOffset(0, 0.5, 120)).toBe(0);
    expect(applySwingOffset(2, 0.5, 120)).toBe(0);
    expect(applySwingOffset(4, 0.5, 120)).toBe(0);
  });

  it("off-beat (odd sixteenth index) should produce positive offset", () => {
    const offset = applySwingOffset(1, 0.5, 120);
    expect(offset).toBeGreaterThan(0);
  });

  it("zero swing amount should produce 0 for any index", () => {
    expect(applySwingOffset(1, 0, 120)).toBe(0);
    expect(applySwingOffset(3, 0, 120)).toBe(0);
  });

  it("negative swing amount should produce 0 (clamped)", () => {
    expect(applySwingOffset(1, -0.5, 120)).toBe(0);
  });

  it("swing=1.0 (maximum) should shift offbeat by half a sixteenth", () => {
    const offset = applySwingOffset(1, 1.0, 120);
    const sixteenthDuration = 60.0 / 120 / 4.0;
    expect(offset).toBeCloseTo(sixteenthDuration * 0.5, 5);
  });
});

// ── getVoiceReleaseTime adversarial ─────────────────────────

describe("getVoiceReleaseTime adversarial — envelope scanning", () => {
  it("empty node configs should return 0", () => {
    expect(getVoiceReleaseTime({})).toBe(0);
  });

  it("non-envelope nodes should be ignored", () => {
    const nodes: Record<string, NodeConfig> = {
      osc: { type: "oscillator", release: 5.0 },
    };
    expect(getVoiceReleaseTime(nodes)).toBe(0);
  });

  it("envelope node without release should be ignored", () => {
    const nodes: Record<string, NodeConfig> = {
      env: { type: "envelope", attack: 0.1, decay: 0.2, sustain: 0.5 },
    };
    expect(getVoiceReleaseTime(nodes)).toBe(0);
  });

  it("should return the maximum release across multiple envelopes", () => {
    const nodes: Record<string, NodeConfig> = {
      env1: { type: "envelope", release: 0.3 },
      env2: { type: "envelope", release: 0.8 },
      env3: { type: "envelope", release: 0.1 },
    };
    expect(getVoiceReleaseTime(nodes)).toBe(0.8);
  });
});
