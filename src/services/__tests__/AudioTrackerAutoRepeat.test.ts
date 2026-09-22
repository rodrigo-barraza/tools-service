import { describe, it, expect, afterEach } from "vitest";
import {
  createTrackerSession,
  addTrackerChannel,
  writeTrackerPattern,
  toSynthesizerConfig,
  deleteTrackerSession,
} from "../AudioTrackerSessionManager.ts";
import {
  generateAudioWav,
  computeTimelineDuration,
} from "../SoundSynthesizerService.ts";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const sessionIdsToCleanup: string[] = [];

afterEach(() => {
  for (const sessionId of sessionIdsToCleanup) {
    deleteTrackerSession(sessionId);
  }
  sessionIdsToCleanup.length = 0;
});

function trackSession(sessionId: string): string {
  sessionIdsToCleanup.push(sessionId);
  return sessionId;
}

/**
 * Build a "quarter note" row group: 1 note trigger + (LPB-1) sustain rows.
 * At LPB=4, this produces 4 rows = 1 quarter note.
 */
function quarterNoteRows(note: string, linesPerBeat: number, velocity?: number): { note: string; velocity?: number }[] {
  const rows: { note: string; velocity?: number }[] = [{ note, velocity }];
  for (let index = 1; index < linesPerBeat; index++) {
    rows.push({ note: "---" });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────
// 1. Auto-Repeat Count Computation
// ────────────────────────────────────────────────────────────

describe("toSynthesizerConfig — Auto-Repeat Pattern Fill", () => {
  it("sets repeat count when pattern is shorter than target duration", () => {
    // LPB=4, 128 BPM: rowDuration = 60/128/4 = 0.1171875s
    // 4 quarter notes = 16 rows × 0.1171875 = 1.875s
    const linesPerBeat = 4;
    const session = createTrackerSession({ duration: 10, tempo: 128, linesPerBeat });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "bass" });

    const pattern = [
      ...quarterNoteRows("C2", linesPerBeat),
      ...quarterNoteRows("E2", linesPerBeat),
      ...quarterNoteRows("C2", linesPerBeat),
      ...quarterNoteRows("E2", linesPerBeat),
    ];
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "bass",
      rows: pattern,
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    // Pattern is ~1.875s, target is 10s → ceil(10 / 1.875) = 6 repeats
    expect(track.repeat).toBeDefined();
    expect(track.repeat).toBeGreaterThanOrEqual(5);
    expect(track.repeat).toBeLessThanOrEqual(7);
  });

  it("does not set repeat when pattern already fills the target duration", () => {
    // LPB=4, 120 BPM: rowDuration = 0.125s
    // 80 rows × 0.125 = 10s > 5s target
    const session = createTrackerSession({ duration: 5, tempo: 120, linesPerBeat: 4 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "lead" });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "lead",
      rows: Array.from({ length: 80 }, () => ({ note: "C4" })),
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    expect(track.repeat).toBeUndefined();
  });

  it("does not set repeat when no target duration is configured", () => {
    const session = createTrackerSession({ tempo: 120 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "lead" });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "lead",
      rows: [{ note: "C4" }],
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    expect(track.repeat).toBeUndefined();
  });

  it("clamps repeat count to maximum of 64", () => {
    // Very short pattern (1 row), very long target → repeat should be capped at 64
    // LPB=4, 120 BPM: 1 row = 0.125s → 60 / 0.125 = 480, clamped to 64
    const session = createTrackerSession({ duration: 60, tempo: 120, linesPerBeat: 4 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "tick" });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "tick",
      rows: [{ note: "C5" }],
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    expect(track.repeat).toBe(64);
  });

  it("computes independent repeat counts for each channel", () => {
    // LPB=4, 120 BPM: rowDuration = 0.125s
    const linesPerBeat = 4;
    const session = createTrackerSession({ duration: 10, tempo: 120, linesPerBeat });
    trackSession(session.sessionId);

    // Channel 1: 2 quarter notes = 8 rows × 0.125 = 1s
    addTrackerChannel(session.sessionId, { channelId: "bass" });
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "bass",
      rows: [
        ...quarterNoteRows("C2", linesPerBeat),
        ...quarterNoteRows("G2", linesPerBeat),
      ],
    });

    // Channel 2: 8 quarter notes = 32 rows × 0.125 = 4s
    addTrackerChannel(session.sessionId, { channelId: "melody" });
    const melodyRows = [];
    for (let index = 0; index < 8; index++) {
      melodyRows.push(...quarterNoteRows("E4", linesPerBeat));
    }
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "melody",
      rows: melodyRows,
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const bassTrack = result.config!.tracks![0];
    const melodyTrack = result.config!.tracks![1];

    // Bass: 1s pattern → ceil(10/1) = 10 repeats
    // Melody: 4s pattern → ceil(10/4) = 3 repeats
    expect(bassTrack.repeat).toBeGreaterThan(melodyTrack.repeat!);
    expect(bassTrack.repeat).toBeGreaterThanOrEqual(9);
    expect(melodyTrack.repeat).toBeGreaterThanOrEqual(2);
    expect(melodyTrack.repeat).toBeLessThanOrEqual(4);
  });

  it("handles patterns with REST rows correctly in duration computation", () => {
    // LPB=4, 120 BPM
    const linesPerBeat = 4;
    const session = createTrackerSession({ duration: 10, tempo: 120, linesPerBeat });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "rhythm" });

    // Pattern with notes and rests (silence gaps):
    // C4 (quarter) → REST (quarter) → E4 (quarter) → REST (quarter) = 4 beats = 2s
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "rhythm",
      rows: [
        ...quarterNoteRows("C4", linesPerBeat),
        { note: "REST" }, { note: "---" }, { note: "---" }, { note: "---" },
        ...quarterNoteRows("E4", linesPerBeat),
        { note: "REST" }, { note: "---" }, { note: "---" }, { note: "---" },
      ],
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    // Pattern spans 16 rows × 0.125 = 2s, so repeat should fill 10s
    expect(track.repeat).toBeDefined();
    expect(track.repeat).toBeGreaterThanOrEqual(3);
  });
});

// ────────────────────────────────────────────────────────────
// 2. Audio Content Verification — The Actual Bug Fix
// ────────────────────────────────────────────────────────────

describe("Auto-Repeat — Audio Content Fills Target Duration", () => {
  it("short pattern at 128 BPM fills the full 10-second duration with actual audio", () => {
    // LPB=4, 128 BPM: rowDuration = 0.1171875s
    // 8 quarter notes = 32 rows ≈ 3.75s
    const linesPerBeat = 4;
    const session = createTrackerSession({ duration: 10, tempo: 128, linesPerBeat });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "bass" });

    const pattern = [];
    for (let index = 0; index < 8; index++) {
      pattern.push(...quarterNoteRows(index % 2 === 0 ? "G1" : "A1", linesPerBeat, 1.0));
    }
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "bass",
      rows: pattern,
    });

    const configResult = toSynthesizerConfig(session.sessionId);
    expect(configResult.config).not.toBeNull();

    const audioResult = generateAudioWav(configResult.config!);
    const reportedDuration = audioResult.sampleCount / 44100;

    // Buffer should be at least 10 seconds
    expect(reportedDuration).toBeGreaterThanOrEqual(9.9);

    // Decode the WAV and verify audio content exists in the second half
    const audioBuffer = Buffer.from(audioResult.audioBase64, "base64");
    const headerSize = 44;
    const bytesPerSample = 2;
    const channelCount = 2;
    const totalAudioFrames = (audioBuffer.length - headerSize) / (bytesPerSample * channelCount);

    // Check the last 30% of the track for non-silence
    const startCheckFrame = Math.floor(totalAudioFrames * 0.7);
    let maximumAmplitudeInLastThird = 0;

    for (let frame = startCheckFrame; frame < totalAudioFrames; frame++) {
      const byteOffset = headerSize + frame * bytesPerSample * channelCount;
      if (byteOffset + 1 < audioBuffer.length) {
        const sampleValue = audioBuffer.readInt16LE(byteOffset);
        maximumAmplitudeInLastThird = Math.max(
          maximumAmplitudeInLastThird,
          Math.abs(sampleValue),
        );
      }
    }

    // With auto-repeat, the last 30% should have actual audio content (not silence)
    expect(maximumAmplitudeInLastThird).toBeGreaterThan(100);
  });

  it("pattern with step-grid notes fills the full target duration", () => {
    // LPB=4, 100 BPM: rowDuration = 60/100/4 = 0.15s
    // 4 notes (each 1 step) = 4 × 0.15 = 0.6s
    const session = createTrackerSession({ duration: 8, tempo: 100, linesPerBeat: 4 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, {
      channelId: "mixed",
      instrument: "synth_bass",
    });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "mixed",
      rows: [
        { note: "C3" },
        { note: "E3" },
        { note: "G3" },
        { note: "C4" },
      ],
    });

    const configResult = toSynthesizerConfig(session.sessionId);
    expect(configResult.config).not.toBeNull();

    const track = configResult.config!.tracks![0];
    expect(track.repeat).toBeDefined();
    expect(track.repeat).toBeGreaterThanOrEqual(2);

    const audioResult = generateAudioWav(configResult.config!);
    const reportedDuration = audioResult.sampleCount / 44100;

    expect(reportedDuration).toBeGreaterThanOrEqual(7.9);
  });

  it("multi-channel auto-repeat produces correct timeline duration", () => {
    // LPB=4, 128 BPM: rowDuration = 0.1171875s
    const linesPerBeat = 4;
    const session = createTrackerSession({ duration: 10, tempo: 128, linesPerBeat });
    trackSession(session.sessionId);

    // Bass: 4 quarter notes = 16 rows ≈ 1.875s
    addTrackerChannel(session.sessionId, { channelId: "bass" });
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "bass",
      rows: [
        ...quarterNoteRows("C2", linesPerBeat),
        ...quarterNoteRows("C2", linesPerBeat),
        ...quarterNoteRows("C2", linesPerBeat),
        ...quarterNoteRows("C2", linesPerBeat),
      ],
    });

    // Drums: 16 rows of 16th notes ≈ 1.875s
    addTrackerChannel(session.sessionId, { channelId: "drums" });
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "drums",
      rows: Array.from({ length: 16 }, () => ({ note: "C4" })),
    });

    const configResult = toSynthesizerConfig(session.sessionId);
    expect(configResult.config).not.toBeNull();

    // Both tracks should have repeat counts set
    for (const track of configResult.config!.tracks!) {
      expect(track.repeat).toBeDefined();
      expect(track.repeat).toBeGreaterThanOrEqual(2);
    }

    // The expanded timeline should be at least the target duration
    const timelineDuration = computeTimelineDuration(
      configResult.config!.tracks!,
      configResult.config!.nodes!,
      configResult.config!.tempo!,
      configResult.config!.timeSignature![0],
    );

    expect(timelineDuration).toBeGreaterThanOrEqual(9.5);
  });
});

// ────────────────────────────────────────────────────────────
// 3. Edge Cases
// ────────────────────────────────────────────────────────────

describe("Auto-Repeat — Edge Cases", () => {
  it("pattern that exactly matches target duration gets no repeat", () => {
    // LPB=4, 120 BPM: rowDuration = 0.125s
    // 32 rows × 0.125 = 4.0s — exactly matches target
    const session = createTrackerSession({ duration: 4, tempo: 120, linesPerBeat: 4 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "exact" });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "exact",
      rows: Array.from({ length: 32 }, () => ({ note: "C4" })),
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    // Pattern duration (4s) is NOT less than target (4s), so no repeat
    expect(track.repeat).toBeUndefined();
  });

  it("single-note pattern repeats correctly", () => {
    // LPB=4, 120 BPM: 1 row = 0.125s
    // Target 5s → ceil(5 / 0.125) = 40 repeats
    const session = createTrackerSession({ duration: 5, tempo: 120, linesPerBeat: 4 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "single" });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "single",
      rows: [{ note: "A4" }],
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    // 0.125s pattern → ceil(5 / 0.125) = 40 repeats
    expect(track.repeat).toBe(40);
  });

  it("empty channel (no notes) does not get a repeat and does not crash", () => {
    const session = createTrackerSession({ duration: 10, tempo: 120 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "silent" });
    addTrackerChannel(session.sessionId, { channelId: "active" });

    // Only write to active channel
    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "active",
      rows: [{ note: "C4" }],
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    // Only the active channel should produce a track
    // (empty channels are skipped by toSynthesizerConfig)
    expect(result.config!.tracks!.length).toBe(1);
  });

  it("patterns with different step densities repeat correctly", () => {
    // LPB=4, 120 BPM: rowDuration = 0.125s
    // 2 rows = 0.25s → ceil(10 / 0.25) = 40, clamped to 40
    const session = createTrackerSession({ duration: 10, tempo: 120, linesPerBeat: 4 });
    trackSession(session.sessionId);

    addTrackerChannel(session.sessionId, { channelId: "sparse" });

    writeTrackerPattern({
      sessionId: session.sessionId,
      channelId: "sparse",
      rows: [
        { note: "C4" },
        { note: "E4" },
      ],
    });

    const result = toSynthesizerConfig(session.sessionId);
    expect(result.config).not.toBeNull();

    const track = result.config!.tracks![0];
    expect(track.repeat).toBeDefined();
    expect(track.repeat).toBeGreaterThanOrEqual(38);
    expect(track.repeat).toBeLessThanOrEqual(42);
  });
});
