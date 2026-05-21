// Owned by Track B3.
import { describe, it, expect } from "vitest";
import {
  findGlossaryHits,
  MEDICAL_GLOSSARY,
  type GlossaryHit,
} from "../../lib/medical-glossary";

describe("MEDICAL_GLOSSARY seed", () => {
  it("has at least 35 terms", () => {
    expect(MEDICAL_GLOSSARY.length).toBeGreaterThanOrEqual(35);
  });

  it("every term has both EN and ES strings", () => {
    for (const t of MEDICAL_GLOSSARY) {
      expect(t.en.length).toBeGreaterThan(0);
      expect(t.es.length).toBeGreaterThan(0);
    }
  });
});

describe("findGlossaryHits", () => {
  it("returns [] for empty text", () => {
    expect(findGlossaryHits("", "all")).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(findGlossaryHits("the quick brown fox", "all")).toEqual([]);
  });

  it("matches case-insensitively on EN side", () => {
    const hits = findGlossaryHits("Take IBUPROFEN twice daily", "all");
    expect(hits.length).toBe(1);
    expect(hits[0].term.en).toBe("ibuprofen");
    expect(hits[0].matched).toBe("IBUPROFEN");
  });

  it("matches case-insensitively on ES side", () => {
    const hits = findGlossaryHits("tome ibuprofeno con la comida", "all");
    expect(hits.length).toBe(1);
    expect(hits[0].term.en).toBe("ibuprofen");
    expect(hits[0].matched).toBe("ibuprofeno");
  });

  it("supports substring matching (not whole-word)", () => {
    // "metformina" contains "metformin" as a prefix when scanning EN side.
    const hits = findGlossaryHits("metformina 500mg", "all");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const term = hits[0].term;
    expect(["metformin"]).toContain(term.en);
  });

  it("dialect-specific term wins over `all` fallback", () => {
    // "gripa" is MX. When dialect=mx, it should map to the MX flu term.
    const mx = findGlossaryHits("tengo gripa", "mx");
    expect(mx.length).toBeGreaterThanOrEqual(1);
    const flu = mx.find((h) => h.term.en === "flu");
    expect(flu).toBeTruthy();
    expect(flu?.term.dialect).toBe("mx");
  });

  it("non-matching dialect still falls back to `all`", () => {
    // The Caribbean term for "flu" is "catarro"; "gripa" is MX-only.
    // With dialect=car, "gripa" must NOT hit (no `all` entry for "gripa").
    const car = findGlossaryHits("tengo gripa hoy", "car");
    const fluHit = car.find((h) => h.term.en === "flu");
    expect(fluHit).toBeUndefined();
  });

  it("dialect priority: MX-specific refill term beats `all` overlap", () => {
    const hits = findGlossaryHits("necesito resurtir mi receta", "mx");
    const refill = hits.find((h) => h.term.en === "refill");
    expect(refill?.term.dialect).toBe("mx");
    expect(refill?.term.es).toBe("resurtir");
  });

  it("returns hits sorted by start index", () => {
    const hits: GlossaryHit[] = findGlossaryHits(
      "fever and cough then headache",
      "all",
    );
    const starts = hits.map((h) => h.start);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("does not double-count overlapping spans", () => {
    // "blood pressure" overlaps "blood" — ensure only one claim per range.
    const hits = findGlossaryHits("check blood pressure", "all");
    const bp = hits.find((h) => h.term.en === "blood pressure");
    expect(bp).toBeTruthy();
    // No additional `blood test` / `blood draw` overlap on the same text.
    const overlapping = hits.filter(
      (h) =>
        h !== bp &&
        bp &&
        h.start < bp.end &&
        h.end > bp.start,
    );
    expect(overlapping).toHaveLength(0);
  });

  it("preserves the matched substring's original casing", () => {
    const hits = findGlossaryHits("Tylenol every 6 hours", "all");
    expect(hits.length).toBe(1);
    expect(hits[0].matched).toBe("Tylenol");
  });
});
