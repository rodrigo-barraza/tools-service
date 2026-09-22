import { describe, it, expect } from "vitest";
import {
  noteToFreq,
  isChordNotation,
  expandChordToNotes,
  getScaleNotes,
  parseBeatDuration,
  parseTimeMarker,
  computeTimelineDuration,
  applySwingOffset,
  applyHumanizeOffset,
  computeSixteenthIndex,
  getVoiceReleaseTime,
  expandTrackRepeats,
  getEnvelopeValue,
  BiquadFilter,
  synthesizeSound,
  synthesizeSequence,
  createWavBuffer,
} from "../SoundSynthesizerService.ts";

// ═══════════════════════════════════════════════════════════════
// SoundSynthesizerService — Core DSP Logic Unit Tests
//
// Tests the pure functions exported from the synthesizer service:
// note/chord/scale parsing, beat duration resolution, time marker
// parsing, DSP node classes, and waveform generation.
// ═══════════════════════════════════════════════════════════════

// ── noteToFreq ───────────────────────────────────────────────

describe("noteToFreq — Note-to-Frequency Conversion", () => {
  it("returns 440 Hz for A4 (concert pitch)", () => {
    expect(noteToFreq("A4")).toBeCloseTo(440.0, 1);
  });

  it("returns ~261.63 Hz for C4 (middle C)", () => {
    expect(noteToFreq("C4")).toBeCloseTo(261.63, 0);
  });

  it("handles sharp notation (C#4, F#5)", () => {
    expect(noteToFreq("C#4")).toBeCloseTo(277.18, 0);
    expect(noteToFreq("F#5")).toBeCloseTo(739.99, 0);
  });

  it("handles flat notation (Bb4, Eb3)", () => {
    // Bb4 = A#4 = 466.16 Hz
    expect(noteToFreq("Bb4")).toBeCloseTo(466.16, 0);
    // Eb3 = D#3 = 155.56 Hz
    expect(noteToFreq("Eb3")).toBeCloseTo(155.56, 0);
  });

  it("returns 0 for REST/SILENCE", () => {
    expect(noteToFreq("rest")).toBe(0);
    expect(noteToFreq("REST")).toBe(0);
    expect(noteToFreq("silence")).toBe(0);
    expect(noteToFreq("SILENCE")).toBe(0);
  });

  it("passes through numeric values as-is", () => {
    expect(noteToFreq(880)).toBe(880);
    expect(noteToFreq(0)).toBe(0);
  });

  it("parses numeric strings as frequencies", () => {
    expect(noteToFreq("880")).toBe(880);
  });

  it("defaults to 440 for unparseable strings", () => {
    expect(noteToFreq("XYZ")).toBe(440);
  });

  it("defaults to 440 for empty string", () => {
    expect(noteToFreq("")).toBe(440);
  });

  it("handles negative octaves", () => {
    const frequency = noteToFreq("C-1");
    expect(frequency).toBeGreaterThan(0);
    expect(frequency).toBeLessThan(10);
  });

  it("produces octave doubling (A5 = 2 × A4)", () => {
    expect(noteToFreq("A5")).toBeCloseTo(noteToFreq("A4") * 2, 1);
  });
});

// ── isChordNotation / expandChordToNotes ─────────────────────

describe("isChordNotation", () => {
  it("recognizes major chord notation", () => {
    expect(isChordNotation("Cmaj")).toBe(true);
    expect(isChordNotation("Gmaj4")).toBe(true);
  });

  it("recognizes minor chord notation", () => {
    expect(isChordNotation("Am")).toBe(true);
    expect(isChordNotation("Fmin")).toBe(true);
  });

  it("recognizes seventh chords", () => {
    expect(isChordNotation("C7")).toBe(true);
    expect(isChordNotation("Cmaj7")).toBe(true);
    expect(isChordNotation("Dm7")).toBe(true);
  });

  it("recognizes suspended chords", () => {
    expect(isChordNotation("Csus2")).toBe(true);
    expect(isChordNotation("Dsus4")).toBe(true);
  });

  it("rejects plain note names without chord quality", () => {
    expect(isChordNotation("C4")).toBe(false);
    expect(isChordNotation("A#3")).toBe(false);
    // Note: A#5 matches because "5" is a valid chord quality (power chord)
    expect(isChordNotation("A#5")).toBe(true);
  });
});

describe("expandChordToNotes", () => {
  it("expands C major to C-E-G", () => {
    const notes = expandChordToNotes("Cmaj4");
    expect(notes).toContain("C4");
    expect(notes).toContain("E4");
    expect(notes).toContain("G4");
    expect(notes).toHaveLength(3);
  });

  it("expands Am to A-C-E", () => {
    const notes = expandChordToNotes("Am4");
    expect(notes).toContain("A4");
    expect(notes).toContain("C5"); // minor third up from A4
    expect(notes).toContain("E5"); // perfect fifth up
  });

  it("expands Cmaj7 to four notes", () => {
    const notes = expandChordToNotes("Cmaj7");
    expect(notes).toHaveLength(4);
  });

  it("defaults to octave 4 when unspecified", () => {
    const notes = expandChordToNotes("Cmaj");
    expect(notes[0]).toContain("4");
  });

  it("returns the input as-is for unrecognized patterns", () => {
    const result = expandChordToNotes("XYZ");
    expect(result).toEqual(["XYZ"]);
  });
});

// ── getScaleNotes ────────────────────────────────────────────

describe("getScaleNotes", () => {
  it("generates a C major scale with 7 notes", () => {
    const scale = getScaleNotes("C", "major", 4, 1);
    expect(scale).toHaveLength(7);
    expect(scale[0]).toBe("C4");
  });

  it("generates a minor scale", () => {
    const scale = getScaleNotes("A", "minor", 4, 1);
    expect(scale.length).toBeGreaterThanOrEqual(7);
    expect(scale[0]).toBe("A4");
  });

  it("returns empty array for unknown scale", () => {
    const scale = getScaleNotes("C", "nonexistent_scale", 4, 1);
    expect(scale).toEqual([]);
  });

  it("supports multi-octave generation", () => {
    const scale = getScaleNotes("C", "major", 4, 2);
    expect(scale.length).toBe(14);
  });
});

// ── parseBeatDuration ────────────────────────────────────────

describe("parseBeatDuration", () => {
  it("passes through numeric values", () => {
    expect(parseBeatDuration(0.5, 120)).toBe(0.5);
  });

  it("parses 1/4 (quarter note) at 120 BPM = 0.5s", () => {
    expect(parseBeatDuration("1/4", 120)).toBeCloseTo(0.5, 4);
  });

  it("parses 1/8 (eighth note) at 120 BPM = 0.25s", () => {
    expect(parseBeatDuration("1/8", 120)).toBeCloseTo(0.25, 4);
  });

  it("parses 1/16 (sixteenth note) at 120 BPM = 0.125s", () => {
    expect(parseBeatDuration("1/16", 120)).toBeCloseTo(0.125, 4);
  });

  it("parses dotted notes (1/4d = 1.5 × quarter)", () => {
    const quarterDuration = parseBeatDuration("1/4", 120);
    const dottedDuration = parseBeatDuration("1/4d", 120);
    expect(dottedDuration).toBeCloseTo(quarterDuration * 1.5, 4);
  });

  it("parses triplet notes (1/4t = 2/3 × quarter)", () => {
    const quarterDuration = parseBeatDuration("1/4", 120);
    const tripletDuration = parseBeatDuration("1/4t", 120);
    expect(tripletDuration).toBeCloseTo(quarterDuration * (2 / 3), 4);
  });

  it("scales correctly with tempo (1/4 at 60 BPM = 1.0s)", () => {
    expect(parseBeatDuration("1/4", 60)).toBeCloseTo(1.0, 4);
  });

  it("handles whole note (1/1) at 120 BPM = 2.0s", () => {
    expect(parseBeatDuration("1/1", 120)).toBeCloseTo(2.0, 4);
  });

  it("parses numeric strings as seconds", () => {
    expect(parseBeatDuration("0.75", 120)).toBeCloseTo(0.75, 4);
  });

  it("returns 0.25 for unparseable strings", () => {
    expect(parseBeatDuration("invalid", 120)).toBe(0.25);
  });
});

// ── parseTimeMarker ──────────────────────────────────────────

describe("parseTimeMarker", () => {
  it("returns numeric values directly", () => {
    expect(parseTimeMarker(1.5)).toBe(1.5);
    expect(parseTimeMarker(0)).toBe(0);
  });

  it("parses bar.beat.sixteenth notation at 120 BPM", () => {
    // 1.1.1 = start of bar 1, beat 1, sixteenth 1 = 0.0s
    expect(parseTimeMarker("1.1.1", 120)).toBe(0.0);
  });

  it("parses 2.1.1 as start of second bar at 120 BPM", () => {
    // At 120 BPM, 4/4: one bar = 4 × 0.5s = 2.0s
    expect(parseTimeMarker("2.1.1", 120, 4)).toBeCloseTo(2.0, 4);
  });

  it("parses 1.2.1 as second beat at 120 BPM", () => {
    // Beat 2 of bar 1 = 0.5s
    expect(parseTimeMarker("1.2.1", 120, 4)).toBeCloseTo(0.5, 4);
  });

  it("parses 1.1.3 as third sixteenth of beat 1", () => {
    // Each sixteenth = 0.125s at 120 BPM, so 1.1.3 = 2 × 0.125 = 0.25s
    expect(parseTimeMarker("1.1.3", 120, 4)).toBeCloseTo(0.25, 4);
  });

  it("falls back to parseFloat for 2-part strings", () => {
    expect(parseTimeMarker("3.5", 120)).toBeCloseTo(3.5, 4);
  });

  it("returns 0 for unparseable strings", () => {
    expect(parseTimeMarker("abc", 120)).toBe(0.0);
  });

  it("returns 0 for empty string", () => {
    expect(parseTimeMarker("", 120)).toBe(0.0);
  });
});

// ── computeTimelineDuration ──────────────────────────────────

describe("computeTimelineDuration", () => {
  const standardNodes = {
    oscillator: { type: "oscillator" as const, waveform: "sine" as const },
    envelope: { type: "envelope" as const, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 },
  };

  it("computes correct duration for simple notes", () => {
    const duration = computeTimelineDuration(
      [{ nodeChain: ["oscillator", "envelope"], notes: [
        { time: 0, duration: 0.5, note: "C4" },
        { time: 0.5, duration: 0.5, note: "E4" },
      ] }],
      standardNodes,
      120,
      4,
    );

    // Last note ends at 0.5 + 0.5 = 1.0 + release(0.2) + buffer(0.1)
    expect(duration).toBeCloseTo(1.3, 1);
  });

  it("accounts for envelope release time", () => {
    const noReleaseNodes = {
      oscillator: { type: "oscillator" as const, waveform: "sine" as const },
      envelope: { type: "envelope" as const, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0 },
    };
    const longReleaseNodes = {
      oscillator: { type: "oscillator" as const, waveform: "sine" as const },
      envelope: { type: "envelope" as const, attack: 0.01, decay: 0.1, sustain: 0.5, release: 1.0 },
    };

    const shortDuration = computeTimelineDuration(
      [{ nodeChain: ["oscillator", "envelope"], notes: [{ time: 0, duration: 1.0, note: "C4" }] }],
      noReleaseNodes,
      120,
      4,
    );
    const longDuration = computeTimelineDuration(
      [{ nodeChain: ["oscillator", "envelope"], notes: [{ time: 0, duration: 1.0, note: "C4" }] }],
      longReleaseNodes,
      120,
      4,
    );

    expect(longDuration - shortDuration).toBeCloseTo(1.0, 1);
  });
});

// ── getVoiceReleaseTime ──────────────────────────────────────

describe("getVoiceReleaseTime", () => {
  it("extracts max release from envelope nodes", () => {
    const releaseTime = getVoiceReleaseTime({
      envelope1: { type: "envelope", release: 0.2 },
      envelope2: { type: "envelope", release: 0.5 },
      oscillator: { type: "oscillator" },
    });
    expect(releaseTime).toBe(0.5);
  });

  it("returns 0 when no envelope nodes exist", () => {
    expect(getVoiceReleaseTime({ oscillator: { type: "oscillator" } })).toBe(0);
  });
});

// ── applySwingOffset / computeSixteenthIndex ─────────────────

describe("applySwingOffset", () => {
  it("returns 0 for on-beat sixteenths", () => {
    expect(applySwingOffset(0, 0.5, 120)).toBe(0);
    expect(applySwingOffset(2, 0.5, 120)).toBe(0);
    expect(applySwingOffset(4, 0.5, 120)).toBe(0);
  });

  it("returns positive offset for off-beat sixteenths", () => {
    const offset = applySwingOffset(1, 0.5, 120);
    expect(offset).toBeGreaterThan(0);
  });

  it("returns 0 when swing amount is 0", () => {
    expect(applySwingOffset(1, 0, 120)).toBe(0);
  });

  it("scales with swing amount", () => {
    const lowSwing = applySwingOffset(1, 0.2, 120);
    const highSwing = applySwingOffset(1, 0.8, 120);
    expect(highSwing).toBeGreaterThan(lowSwing);
  });
});

describe("applyHumanizeOffset", () => {
  it("returns 0 when humanize is 0", () => {
    expect(applyHumanizeOffset(0)).toBe(0);
  });

  it("returns a value within ±0.02 * humanizeAmount", () => {
    for (let iteration = 0; iteration < 100; iteration++) {
      const offset = applyHumanizeOffset(1.0);
      expect(Math.abs(offset)).toBeLessThanOrEqual(0.02);
    }
  });
});

describe("computeSixteenthIndex", () => {
  it("returns 0 for time 0", () => {
    expect(computeSixteenthIndex(0, 120)).toBe(0);
  });

  it("computes correct index at 120 BPM (sixteenth = 0.125s)", () => {
    expect(computeSixteenthIndex(0.125, 120)).toBe(1);
    expect(computeSixteenthIndex(0.25, 120)).toBe(2);
    expect(computeSixteenthIndex(0.5, 120)).toBe(4);
  });
});

// ── expandTrackRepeats ───────────────────────────────────────

describe("expandTrackRepeats", () => {
  const singleNote = [{ time: 0 as number | string, duration: 0.5 as number | string, note: "C4" }];

  it("returns original notes when repeatCount <= 1", () => {
    expect(expandTrackRepeats(singleNote, 1, 120, 4)).toEqual(singleNote);
    expect(expandTrackRepeats(singleNote, 0, 120, 4)).toEqual(singleNote);
  });

  it("duplicates notes with time offsets for repeat > 1", () => {
    const expanded = expandTrackRepeats(singleNote, 2, 120, 4);
    expect(expanded).toHaveLength(2);
    expect(expanded[0].time).toBe(0);
    expect(expanded[1].time as number).toBeGreaterThan(0);
  });

  it("clamps repeat count to 64", () => {
    const expanded = expandTrackRepeats(singleNote, 100, 120, 4);
    expect(expanded).toHaveLength(64);
  });
});

// ── getEnvelopeValue ─────────────────────────────────────────

describe("getEnvelopeValue", () => {
  // Correct signature: getEnvelopeValue(time, totalDuration, adsr)
  const envelope = { attack: 0.1, decay: 0.2, sustain: 0.6, release: 0.3 };
  const totalDuration = 1.0;

  it("starts at 0 and rises during attack phase", () => {
    expect(getEnvelopeValue(0, totalDuration, envelope)).toBe(0);
    const midAttack = getEnvelopeValue(0.05, totalDuration, envelope);
    expect(midAttack).toBeGreaterThan(0);
    expect(midAttack).toBeLessThan(1);
  });

  it("peaks at 1.0 at end of attack", () => {
    expect(getEnvelopeValue(0.1, totalDuration, envelope)).toBeCloseTo(1.0, 1);
  });

  it("decays toward sustain level after attack", () => {
    const inDecay = getEnvelopeValue(0.2, totalDuration, envelope);
    expect(inDecay).toBeLessThanOrEqual(1.0);
    expect(inDecay).toBeGreaterThanOrEqual(0.6);
  });

  it("holds at sustain level during sustain phase", () => {
    const inSustain = getEnvelopeValue(0.5, totalDuration, envelope);
    expect(inSustain).toBeCloseTo(0.6, 1);
  });

  it("decays to 0 during release phase", () => {
    const afterRelease = getEnvelopeValue(totalDuration, totalDuration, envelope);
    expect(afterRelease).toBeCloseTo(0, 1);
  });
});

// ── BiquadFilter ─────────────────────────────────────────────

describe("BiquadFilter", () => {
  it("processes samples without NaN or Infinity", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(1000, 1.0);
    const samples = new Float32Array(1000).fill(0.5);

    for (const sample of samples) {
      const output = filter.process(sample);
      expect(isFinite(output)).toBe(true);
    }
  });

  it("lowpass filter attenuates high frequencies", () => {
    const filter = new BiquadFilter("lowpass", 44100);
    filter.updateCoefficients(200, 1.0);

    // Generate high frequency signal (5kHz) — long enough for filter to stabilize
    const sampleCount = 44100;
    const settlingSamples = 1000;

    let outputPower = 0;
    let inputPower = 0;

    for (let index = 0; index < sampleCount; index++) {
      const sample = Math.sin(2 * Math.PI * 5000 * (index / 44100));
      const output = filter.process(sample);

      // Only measure power after settling period
      if (index >= settlingSamples) {
        outputPower += output * output;
        inputPower += sample * sample;
      }
    }

    // With a 200Hz cutoff and 5kHz signal, attenuation should be significant
    expect(outputPower).toBeLessThan(inputPower * 0.5);
  });

  it("supports highpass and bandpass filter types", () => {
    const highpass = new BiquadFilter("highpass", 44100);
    highpass.updateCoefficients(1000, 1.0);
    expect(() => highpass.process(0.5)).not.toThrow();

    const bandpass = new BiquadFilter("bandpass", 44100);
    bandpass.updateCoefficients(1000, 1.0);
    expect(() => bandpass.process(0.5)).not.toThrow();
  });
});

// ── synthesizeSound ──────────────────────────────────────────

describe("synthesizeSound — Basic Waveform Generation", () => {
  it("generates a sine wave of correct duration", () => {
    const samples = synthesizeSound({
      waveform: "sine",
      frequency: 440,
      duration: 1.0,
      sampleRate: 44100,
    });

    expect(samples.length).toBeCloseTo(44100, -2);
  });

  it("generates square, triangle, and sawtooth waveforms", () => {
    for (const waveform of ["square", "triangle", "sawtooth"] as const) {
      const samples = synthesizeSound({
        waveform,
        frequency: 440,
        duration: 0.1,
        sampleRate: 44100,
      });
      expect(samples.length).toBeGreaterThan(0);

      // All samples should be in valid audio range
      for (const sample of samples) {
        expect(sample).toBeGreaterThanOrEqual(-1.5);
        expect(sample).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("applies ADSR envelope", () => {
    const samples = synthesizeSound({
      waveform: "sine",
      frequency: 440,
      duration: 0.5,
      sampleRate: 44100,
      envelope: { attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.1 },
    });

    // First samples should be near zero (attack phase)
    expect(Math.abs(samples[0])).toBeLessThan(0.01);
  });
});

// ── synthesizeSequence ───────────────────────────────────────

describe("synthesizeSequence — Melody Playback", () => {
  it("generates audio for a simple melody", () => {
    const samples = synthesizeSequence(
      [
        { note: "C4", duration: 0.25 },
        { note: "E4", duration: 0.25 },
        { note: "G4", duration: 0.25 },
      ],
      { sampleRate: 44100 },
    );

    // 3 notes × 0.25s = 0.75s → ~33,075 samples
    expect(samples.length).toBeGreaterThan(30000);
    expect(samples.length).toBeLessThan(40000);
  });

  it("handles REST notes as silence", () => {
    const samples = synthesizeSequence(
      [
        { note: "rest", duration: 0.5 },
      ],
      { sampleRate: 44100 },
    );

    expect(samples.length).toBeGreaterThan(0);

    // All samples should be near zero for rest
    const maxAmplitude = Math.max(...samples.map(Math.abs));
    expect(maxAmplitude).toBeLessThan(0.01);
  });
});

// ── createWavBuffer ──────────────────────────────────────────

describe("createWavBuffer", () => {
  it("produces a valid WAV header (RIFF + WAVE)", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const buffer = createWavBuffer(samples, 44100, 1);

    expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("encodes 16-bit PCM samples", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const buffer = createWavBuffer(samples, 44100, 1);

    // Bits per sample at byte offset 34
    expect(buffer.readUInt16LE(34)).toBe(16);
  });

  it("sets channel count correctly for stereo", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const buffer = createWavBuffer(samples, 44100, 2);

    // Channel count at byte offset 22
    expect(buffer.readUInt16LE(22)).toBe(2);
  });

  it("sets sample rate in the header", () => {
    const samples = new Float32Array([0, 0.5]);
    const buffer = createWavBuffer(samples, 22050, 1);

    // Sample rate at byte offset 24
    expect(buffer.readUInt32LE(24)).toBe(22050);
  });
});
