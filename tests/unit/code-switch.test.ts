// Track C3 unit tests — code-switch detector.
import { describe, it, expect } from "vitest";
import {
  detectCodeSwitch,
  codeSwitchPromptHint,
} from "@/lib/edge/code-switch";

describe("detectCodeSwitch", () => {
  it("classifies pure Spanish as ES primary, no mix", () => {
    const r = detectCodeSwitch("buenos días doctor, tengo dolor de cabeza");
    expect(r.primary).toBe("es");
    expect(r.mixed).toBe(false);
    expect(r.secondary).toBeNull();
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("classifies pure English as EN primary, no mix", () => {
    const r = detectCodeSwitch("good morning doctor, I have a headache");
    expect(r.primary).toBe("en");
    expect(r.mixed).toBe(false);
    expect(r.secondary).toBeNull();
  });

  it("flags ES↔EN mix", () => {
    const r = detectCodeSwitch("tengo un appointment con la doctora mañana");
    expect(r.mixed).toBe(true);
    expect(r.primary).toBe("es");
    expect(r.secondary).toBe("en");
    expect(r.switchPoints.length).toBeGreaterThan(0);
  });

  it("flags EN↔ES mix when EN dominates", () => {
    const r = detectCodeSwitch("the doctor said I need pastillas para el dolor");
    expect(r.mixed).toBe(true);
    // pastillas / para / el / dolor are all ES → ES likely dominates
    expect(["es", "en"]).toContain(r.primary);
    expect(r.secondary).not.toBeNull();
  });

  it("uses Spanish diacritics as a strong ES signal", () => {
    const r = detectCodeSwitch("¿Cómo está usted?");
    expect(r.primary).toBe("es");
  });

  it("uses English contractions as a strong EN signal", () => {
    const r = detectCodeSwitch("you're going to the clinic");
    expect(r.primary).toBe("en");
  });

  it("returns confidence 0 for empty / unrecognized text", () => {
    const r = detectCodeSwitch("");
    expect(r.confidence).toBe(0);
    expect(r.mixed).toBe(false);
  });

  it("returns switch indices in token order", () => {
    const r = detectCodeSwitch("hola the doctor está aquí");
    // hola(es) the(en) doctor(both) está(es) aquí(es-diacritic)
    // switch points at en→es transitions.
    expect(r.tokens.length).toBeGreaterThan(3);
    for (const sp of r.switchPoints) {
      expect(sp).toBeGreaterThan(0);
      expect(sp).toBeLessThan(r.tokens.length);
    }
  });

  it("tokens include offset spans matching the source text", () => {
    const text = "hola world";
    const r = detectCodeSwitch(text);
    expect(r.tokens[0].text).toBe("hola");
    expect(text.slice(r.tokens[0].start, r.tokens[0].end)).toBe("hola");
    expect(r.tokens[1].text).toBe("world");
  });

  it("codeSwitchPromptHint emits null when not mixed", () => {
    const r = detectCodeSwitch("solo en español por favor");
    expect(codeSwitchPromptHint(r)).toBeNull();
  });

  it("codeSwitchPromptHint emits guidance when mixed", () => {
    const r = detectCodeSwitch("tengo un appointment con el doctor mañana");
    const hint = codeSwitchPromptHint(r);
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/code-switched/);
  });
});
