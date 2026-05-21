// Track C3 unit tests — light Spanish profanity scanner.
import { describe, it, expect } from "vitest";
import {
  scanProfanity,
  hasProfanity,
  buildProfanityNotes,
} from "@/lib/edge/profanity";

describe("scanProfanity", () => {
  it("flags common terms", () => {
    expect(hasProfanity("qué mierda está pasando")).toBe(true);
    expect(hasProfanity("este pendejo doctor")).toBe(true);
    expect(hasProfanity("no joda doctor")).toBe(false); // not in our small list
    expect(hasProfanity("hijo de puta")).toBe(true);
  });

  it("returns offsets that map back into the original text", () => {
    const text = "qué mierda está pasando";
    const hits = scanProfanity(text);
    expect(hits.length).toBeGreaterThan(0);
    expect(text.slice(hits[0].start, hits[0].end).toLowerCase()).toContain(
      "mierda",
    );
  });

  it("does not flag benign text", () => {
    expect(scanProfanity("buenos dias doctor").length).toBe(0);
    expect(scanProfanity("").length).toBe(0);
  });

  it("matches diacritic variants", () => {
    expect(hasProfanity("coño")).toBe(true);
    expect(hasProfanity("cono")).toBe(true);
  });

  it("dedupes overlapping hits", () => {
    const hits = scanProfanity("puta puta puta");
    expect(hits.length).toBe(3);
  });

  it("does not match inside larger words", () => {
    // Word-boundary should reject 'concha' partial inside 'conchabar'.
    expect(scanProfanity("conchabarme con el medico").length).toBe(0);
  });
});

describe("buildProfanityNotes", () => {
  it("returns null when no hits", () => {
    expect(buildProfanityNotes([])).toBeNull();
  });

  it("returns flagged blob with deduped terms", () => {
    const blob = buildProfanityNotes(scanProfanity("puta mierda puta"));
    expect(blob).toEqual({
      flagged: true,
      count: 3,
      terms: expect.arrayContaining(["puta", "mierda"]),
    });
  });
});
