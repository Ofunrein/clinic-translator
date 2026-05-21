// Track C3 unit tests — silence detector pure helpers.
// We test the pure dB / RMS math + the React hook in jsdom isn't easy
// without a fake AnalyserNode; that path is exercised via integration.
import { describe, it, expect } from "vitest";
import {
  rmsToDb,
  timeDomainRms,
  SILENCE_DEFAULTS,
  CALLER_QUIET_ES_PROMPT,
  PATIENT_STILL_THERE_EN_PROMPT,
} from "@/lib/edge/silence-detector";

describe("rmsToDb", () => {
  it("returns -120 for silence", () => {
    expect(rmsToDb(0)).toBe(-120);
    expect(rmsToDb(-1)).toBe(-120);
    expect(rmsToDb(NaN)).toBe(-120);
  });

  it("returns 0 dB for full-scale (rms=1)", () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 5);
  });

  it("returns -20 dB for rms=0.1", () => {
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 5);
  });

  it("monotonic in rms", () => {
    expect(rmsToDb(0.01)).toBeLessThan(rmsToDb(0.1));
    expect(rmsToDb(0.1)).toBeLessThan(rmsToDb(0.5));
  });
});

describe("timeDomainRms", () => {
  it("returns 0 for empty", () => {
    expect(timeDomainRms(new Uint8Array(0))).toBe(0);
  });

  it("returns 0 for centered DC (all 128)", () => {
    const buf = new Uint8Array(64).fill(128);
    expect(timeDomainRms(buf)).toBe(0);
  });

  it("returns ~1 for full-amplitude alternation", () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < 64; i++) buf[i] = i % 2 === 0 ? 0 : 255;
    expect(timeDomainRms(buf)).toBeGreaterThan(0.99);
  });

  it("returns ~0.5 for half-amplitude", () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < 64; i++) buf[i] = i % 2 === 0 ? 64 : 192;
    // (128 - 64)/128 = 0.5; rms over alternating ±0.5 = 0.5
    expect(timeDomainRms(buf)).toBeCloseTo(0.5, 2);
  });
});

describe("SILENCE_DEFAULTS", () => {
  it("has stable contract values", () => {
    expect(SILENCE_DEFAULTS.mutedDb).toBe(-50);
    expect(SILENCE_DEFAULTS.mutedWindowMs).toBe(8_000);
    expect(SILENCE_DEFAULTS.longSilenceMs).toBe(15_000);
    expect(SILENCE_DEFAULTS.callerQuietDb).toBe(-40);
  });
});

describe("pre-translated prompts", () => {
  it("ES prompt is non-empty Spanish", () => {
    expect(CALLER_QUIET_ES_PROMPT.length).toBeGreaterThan(10);
    expect(CALLER_QUIET_ES_PROMPT).toMatch(/escucha|hable/i);
  });

  it("EN long-silence prompt is non-empty", () => {
    expect(PATIENT_STILL_THERE_EN_PROMPT.length).toBeGreaterThan(5);
  });
});
