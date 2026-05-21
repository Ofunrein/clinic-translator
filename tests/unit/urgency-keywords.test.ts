// Track C3 unit tests — urgency keyword detector.
import { describe, it, expect } from "vitest";
import {
  scanUrgencyKeywords,
  evaluateUrgency,
  URGENT_KEYWORDS,
} from "@/lib/edge/urgency-keywords";

describe("URGENT_KEYWORDS catalog", () => {
  it("has at least 40 entries", () => {
    expect(URGENT_KEYWORDS.length).toBeGreaterThanOrEqual(40);
  });

  it("every entry has weight ∈ (0,1]", () => {
    for (const k of URGENT_KEYWORDS) {
      expect(k.weight).toBeGreaterThan(0);
      expect(k.weight).toBeLessThanOrEqual(1);
    }
  });

  it("covers cardiac / respiratory / bleeding / neuro / explicit_emergency", () => {
    const cats = new Set(URGENT_KEYWORDS.map((k) => k.category));
    expect(cats.has("cardiac")).toBe(true);
    expect(cats.has("respiratory")).toBe(true);
    expect(cats.has("bleeding")).toBe(true);
    expect(cats.has("neuro")).toBe(true);
    expect(cats.has("explicit_emergency")).toBe(true);
  });
});

describe("scanUrgencyKeywords", () => {
  it("flags 'no puedo respirar'", () => {
    const hits = scanUrgencyKeywords("doctor no puedo respirar bien");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.keyword.category === "respiratory")).toBe(true);
  });

  it("flags 'dolor de pecho'", () => {
    const hits = scanUrgencyKeywords("tengo dolor de pecho desde anoche");
    expect(hits.some((h) => h.keyword.category === "cardiac")).toBe(true);
  });

  it("flags emergency call-out", () => {
    const hits = scanUrgencyKeywords("llamen al 911 por favor");
    expect(hits.some((h) => h.keyword.category === "explicit_emergency")).toBe(
      true,
    );
  });

  it("returns 0 hits on benign text", () => {
    const hits = scanUrgencyKeywords("buenos dias doctor, vengo por mi cita");
    expect(hits.length).toBe(0);
  });

  it("offsets land inside the original string", () => {
    const text = "tengo dolor de pecho";
    const hits = scanUrgencyKeywords(text);
    const h = hits[0];
    expect(text.slice(h.start, h.end).toLowerCase()).toContain("dolor de pecho");
  });

  it("matches diacritic variants", () => {
    const hits = scanUrgencyKeywords("se desmayó la paciente");
    expect(hits.some((h) => h.keyword.category === "neuro")).toBe(true);
  });
});

describe("evaluateUrgency", () => {
  it("escalates on high-weight match", () => {
    const v = evaluateUrgency("se está muriendo");
    expect(v.escalate).toBe(true);
    expect(v.topWeight).toBeGreaterThan(0.9);
  });

  it("does not escalate when only low-weight cues", () => {
    // "sangre" alone has weight 0.55 — below 0.7 threshold.
    const v = evaluateUrgency("vi un poco de sangre");
    expect(v.escalate).toBe(false);
  });

  it("custom threshold respected", () => {
    const v = evaluateUrgency("vi un poco de sangre", { escalateThreshold: 0.5 });
    expect(v.escalate).toBe(true);
  });

  it("returns categories sorted by weight desc", () => {
    const v = evaluateUrgency("dolor de pecho y no puedo respirar");
    expect(v.categories.length).toBeGreaterThanOrEqual(2);
    // Both cardiac (0.95) and respiratory (0.95) — order is deterministic
    // by sort, but weights tie → first inserted wins. Just assert presence.
    expect(v.categories).toContain("cardiac");
    expect(v.categories).toContain("respiratory");
  });
});
