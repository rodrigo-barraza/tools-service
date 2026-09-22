import { describe, it, expect } from "vitest";
import { validateSynthesizerInput } from "../SoundSynthesizerValidation.ts";

// ═══════════════════════════════════════════════════════════════
// ADVERSARIAL TESTS — SoundSynthesizerValidation
//
// Hand-crafted edge cases targeting validation bypass, boundary
// exploitation at min/max limits, type coercion tricks, and
// modular mode node resolution attacks.
// ═══════════════════════════════════════════════════════════════

describe("SoundSynthesizerValidation adversarial — soundType bypass", () => {
  it("valid soundType should pass", () => {
    expect(validateSynthesizerInput({ soundType: "synthesizer" })).toBeNull();
  });

  it("undefined soundType should pass (optional)", () => {
    expect(validateSynthesizerInput({})).toBeNull();
  });

  it("invalid soundType should be rejected", () => {
    const result = validateSynthesizerInput({ soundType: "hack" as any });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid soundType");
  });

  it("empty string soundType should pass (falsy, skipped)", () => {
    // "" is falsy, so the `if (config.soundType && ...)` guard skips it
    expect(validateSynthesizerInput({ soundType: "" as any })).toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — frequency boundaries", () => {
  it("frequency of 1 should be valid (lower bound)", () => {
    expect(validateSynthesizerInput({ frequency: 1 })).toBeNull();
  });

  it("frequency of 22050 should be valid (upper bound)", () => {
    expect(validateSynthesizerInput({ frequency: 22050 })).toBeNull();
  });

  it("frequency of 0 should be rejected (below minimum)", () => {
    const result = validateSynthesizerInput({ frequency: 0 });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid frequency");
  });

  it("frequency of 22051 should be rejected (above Nyquist)", () => {
    const result = validateSynthesizerInput({ frequency: 22051 });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid frequency");
  });

  it("frequency of NaN should be rejected", () => {
    const result = validateSynthesizerInput({ frequency: NaN });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid frequency");
  });

  it("string frequency should bypass numeric validation (treated as note name)", () => {
    // The validation code: if typeof === "string" → null (skipped)
    expect(validateSynthesizerInput({ frequency: "C4" as any })).toBeNull();
  });

  it("null frequency should be skipped (guard check)", () => {
    expect(validateSynthesizerInput({ frequency: null as any })).toBeNull();
  });

  it("undefined frequency should be skipped", () => {
    expect(validateSynthesizerInput({ frequency: undefined })).toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — duration boundaries", () => {
  it("duration of 0.01 should be valid (lower bound)", () => {
    expect(validateSynthesizerInput({ duration: 0.01 })).toBeNull();
  });

  it("duration of 60.0 should be valid (upper bound)", () => {
    expect(validateSynthesizerInput({ duration: 60.0 })).toBeNull();
  });

  it("duration of 0.009 should be rejected (below minimum)", () => {
    const result = validateSynthesizerInput({ duration: 0.009 });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid duration");
  });

  it("duration of 60.1 should be rejected (above maximum)", () => {
    const result = validateSynthesizerInput({ duration: 60.1 });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid duration");
  });

  it("duration of NaN should be rejected", () => {
    const result = validateSynthesizerInput({ duration: NaN });
    expect(result).not.toBeNull();
  });

  it("duration of 0 should be rejected", () => {
    const result = validateSynthesizerInput({ duration: 0 });
    expect(result).not.toBeNull();
  });

  it("negative duration should be rejected", () => {
    const result = validateSynthesizerInput({ duration: -1 });
    expect(result).not.toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — sampleRate boundaries", () => {
  it("sampleRate of 8000 should be valid (lower bound)", () => {
    expect(validateSynthesizerInput({ sampleRate: 8000 })).toBeNull();
  });

  it("sampleRate of 48000 should be valid (upper bound)", () => {
    expect(validateSynthesizerInput({ sampleRate: 48000 })).toBeNull();
  });

  it("sampleRate of 7999 should be rejected", () => {
    const result = validateSynthesizerInput({ sampleRate: 7999 });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid sampleRate");
  });

  it("sampleRate of 48001 should be rejected", () => {
    const result = validateSynthesizerInput({ sampleRate: 48001 });
    expect(result).not.toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — tempo boundaries", () => {
  it("tempo of 20 should be valid (lower bound)", () => {
    expect(validateSynthesizerInput({ tempo: 20 })).toBeNull();
  });

  it("tempo of 999 should be valid (upper bound)", () => {
    expect(validateSynthesizerInput({ tempo: 999 })).toBeNull();
  });

  it("tempo of 19 should be rejected", () => {
    const result = validateSynthesizerInput({ tempo: 19 });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid tempo");
  });

  it("tempo of 1000 should be rejected", () => {
    const result = validateSynthesizerInput({ tempo: 1000 });
    expect(result).not.toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — waveform validation", () => {
  it("valid waveforms should pass", () => {
    for (const waveform of ["sine", "triangle", "sawtooth", "square", "noise"]) {
      expect(validateSynthesizerInput({ waveform: waveform as any })).toBeNull();
    }
  });

  it("invalid waveform should be rejected", () => {
    const result = validateSynthesizerInput({ waveform: "custom" as any });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid waveform");
  });
});

describe("SoundSynthesizerValidation adversarial — modular mode node resolution", () => {
  it("tracks with no nodes should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      tracks: [{ nodeChain: ["osc"], notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }] }],
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("'nodes' object");
  });

  it("nodes with no tracks should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: { type: "oscillator" } },
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("'tracks' array");
  });

  it("nodeChain referencing undefined node should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: { type: "oscillator" } },
      tracks: [{
        nodeChain: ["osc", "missing_filter"],
        notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }],
      }],
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("missing_filter");
  });

  it("'destination' in nodeChain should be exempt from resolution", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: { type: "oscillator" } },
      tracks: [{
        nodeChain: ["osc", "destination"],
        notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }],
      }],
    } as any);
    expect(result).toBeNull();
  });

  it("invalid node type should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: { type: "invalid_type" } },
      tracks: [{
        nodeChain: ["osc"],
        notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }],
      }],
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("invalid type");
  });

  it("node without type property should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: {} },
      tracks: [{
        nodeChain: ["osc"],
        notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }],
      }],
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("missing its 'type'");
  });

  it("track without nodeChain should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: { type: "oscillator" } },
      tracks: [{ notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }] }],
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("nodeChain");
  });

  it("track without notes should be rejected", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: { osc: { type: "oscillator" } },
      tracks: [{ nodeChain: ["osc"] }],
    } as any);
    expect(result).not.toBeNull();
    expect(result).toContain("notes");
  });

  it("valid modular config should pass", () => {
    const result = validateSynthesizerInput({
      soundType: "modular",
      nodes: {
        osc: { type: "oscillator", waveform: "sine" },
        env: { type: "envelope", attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.15 },
      },
      tracks: [{
        nodeChain: ["osc", "env", "destination"],
        notes: [{ time: "1.1.1", duration: "1/4", note: "C4" }],
      }],
    } as any);
    expect(result).toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — implicit modular detection", () => {
  it("tracks without soundType should trigger modular validation", () => {
    const result = validateSynthesizerInput({
      tracks: [{ nodeChain: ["osc"], notes: [{ time: 0, duration: 0.5, note: "C4" }] }],
    } as any);
    // Has tracks but no nodes → should fail modular validation
    expect(result).not.toBeNull();
    expect(result).toContain("nodes");
  });

  it("nodes without soundType should trigger modular validation", () => {
    const result = validateSynthesizerInput({
      nodes: { osc: { type: "oscillator" } },
    } as any);
    // Has nodes but no tracks → should fail modular validation
    expect(result).not.toBeNull();
    expect(result).toContain("tracks");
  });
});

describe("SoundSynthesizerValidation adversarial — instrument preset", () => {
  it("valid instrument preset should pass", () => {
    expect(validateSynthesizerInput({ instrument: "piano" })).toBeNull();
  });

  it("invalid instrument should be rejected", () => {
    const result = validateSynthesizerInput({ instrument: "nonexistent_instrument" });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid instrument");
  });

  it("empty string instrument should pass (falsy, skipped)", () => {
    expect(validateSynthesizerInput({ instrument: "" })).toBeNull();
  });
});

describe("SoundSynthesizerValidation adversarial — presetEffect", () => {
  it("valid preset effects should pass", () => {
    for (const effect of ["laser", "coin", "powerup", "jump", "explosion"]) {
      expect(validateSynthesizerInput({ presetEffect: effect as any })).toBeNull();
    }
  });

  it("invalid preset effect should be rejected", () => {
    const result = validateSynthesizerInput({ presetEffect: "hacked_effect" as any });
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid presetEffect");
  });
});
