// Track C3 unit tests — session-local correction map (pure helpers only;
// the apply-to-utterance path requires the Zustand store + DOM and is
// covered by integration tests).
import { describe, it, expect, beforeEach } from "vitest";
import {
  addCorrection,
  applyCorrections,
  listCorrections,
  clearCorrections,
  __internals,
} from "@/lib/edge/correction";

describe("correction map", () => {
  beforeEach(() => {
    __internals.sessionMaps.clear();
  });

  it("addCorrection registers a wrong→right pair", () => {
    addCorrection({
      sessionId: "s1",
      utteranceId: "u1",
      wrong: "cita",
      right: "fecha",
    });
    expect(listCorrections("s1").length).toBe(1);
    expect(listCorrections("s1")[0].right).toBe("fecha");
  });

  it("applyCorrections replaces matched tokens", () => {
    addCorrection({
      sessionId: "s1",
      utteranceId: "u1",
      wrong: "cita",
      right: "fecha",
    });
    const out = applyCorrections("s1", "necesito cita para mañana");
    expect(out).toBe("necesito fecha para mañana");
  });

  it("applyCorrections is case-preserving", () => {
    addCorrection({
      sessionId: "s1",
      utteranceId: "u1",
      wrong: "doctor",
      right: "medico",
    });
    expect(applyCorrections("s1", "Doctor por favor")).toBe("Medico por favor");
    expect(applyCorrections("s1", "DOCTOR por favor")).toBe("MEDICO por favor");
  });

  it("applyCorrections is diacritic-insensitive on key", () => {
    addCorrection({
      sessionId: "s1",
      utteranceId: "u1",
      wrong: "doctora",
      right: "medica",
    });
    // "Doctorá" (artificial accent) should still hit.
    const out = applyCorrections("s1", "la Doctorá llega");
    expect(out).toContain("Medica");
  });

  it("isolates corrections per session", () => {
    addCorrection({
      sessionId: "s1",
      utteranceId: "u1",
      wrong: "x",
      right: "y",
    });
    expect(applyCorrections("s2", "x x x")).toBe("x x x");
    expect(applyCorrections("s1", "x x x")).toBe("y y y");
  });

  it("clearCorrections drops the map", () => {
    addCorrection({
      sessionId: "s1",
      utteranceId: "u1",
      wrong: "x",
      right: "y",
    });
    clearCorrections("s1");
    expect(listCorrections("s1").length).toBe(0);
  });

  it("strip helper normalizes lower + diacritics", () => {
    expect(__internals.strip("Médico")).toBe("medico");
  });

  it("listCorrections is sorted by ts ascending", async () => {
    addCorrection({ sessionId: "s1", utteranceId: "u1", wrong: "a", right: "1" });
    // Force a small ts gap.
    await new Promise((r) => setTimeout(r, 1));
    addCorrection({ sessionId: "s1", utteranceId: "u2", wrong: "b", right: "2" });
    const list = listCorrections("s1");
    expect(list.map((c) => c.right)).toEqual(["1", "2"]);
  });
});
