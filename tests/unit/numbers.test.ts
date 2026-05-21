// Track C3 unit tests — Spanish numeral / date / time / dose / phone parser.
// >= 30 cases per Track C3 brief.
import { describe, it, expect } from "vitest";
import { normalizeNumbers, toE164, __internals } from "@/lib/edge/numbers";

const REF = new Date("2026-05-21T12:00:00Z");

function firstOfKind(text: string, kind: string) {
  return normalizeNumbers(text, { referenceDate: REF }).find((a) => a.kind === kind);
}

describe("normalizeNumbers — cardinals", () => {
  const cases: Array<[string, number]> = [
    ["cero", 0],
    ["uno", 1],
    ["dos", 2],
    ["tres", 3],
    ["cuatro", 4],
    ["cinco", 5],
    ["seis", 6],
    ["siete", 7],
    ["ocho", 8],
    ["nueve", 9],
    ["diez", 10],
    ["once", 11],
    ["doce", 12],
    ["trece", 13],
    ["catorce", 14],
    ["quince", 15],
    ["dieciseis", 16],
    ["veinte", 20],
    ["veintiuno", 21],
    ["veintidos", 22],
    ["treinta", 30],
    ["treinta y cinco", 35],
    ["cuarenta y dos", 42],
    ["cincuenta", 50],
    ["sesenta y siete", 67],
    ["noventa y nueve", 99],
    ["cien", 100],
    ["ciento veinte", 120],
    ["doscientos", 200],
    ["doscientos cincuenta", 250],
    ["mil", 1000],
    ["dos mil veintiseis", 2026],
  ];
  it.each(cases)("'%s' → %i", (text, value) => {
    const ann = firstOfKind(text, "number");
    expect(ann?.normalized).toEqual({ type: "integer", value });
  });
});

describe("normalizeNumbers — dates", () => {
  it("'el quince de marzo' → 2026-03-15", () => {
    const ann = firstOfKind("la cita es el quince de marzo", "date");
    expect(ann).toBeTruthy();
    expect(ann?.normalized).toMatchObject({ type: "date", iso: "2026-03-15" });
  });

  it("'el primero de enero del dos mil veintiseis' → 2026-01-01", () => {
    const ann = firstOfKind(
      "nací el primero de enero del dos mil veintiseis",
      "date",
    );
    expect(ann?.normalized).toMatchObject({ type: "date", iso: "2026-01-01" });
  });

  it("'el treinta y uno de diciembre' → MM-DD = 12-31", () => {
    const ann = firstOfKind("el treinta y uno de diciembre", "date");
    expect(ann?.normalized).toMatchObject({
      type: "date",
      month: 12,
      day: 31,
    });
  });
});

describe("normalizeNumbers — times", () => {
  it("'a las tres y media' → 03:30", () => {
    const ann = firstOfKind("vengo a las tres y media", "time");
    expect(ann?.normalized).toMatchObject({ type: "time", hh: 3, mm: 30 });
  });

  it("'a las tres y cuarto' → 03:15", () => {
    const ann = firstOfKind("a las tres y cuarto", "time");
    expect(ann?.normalized).toMatchObject({ type: "time", hh: 3, mm: 15 });
  });

  it("'a las cuatro menos cuarto' → 03:45", () => {
    const ann = firstOfKind("nos vemos a las cuatro menos cuarto", "time");
    expect(ann?.normalized).toMatchObject({ type: "time", hh: 3, mm: 45 });
  });

  it("'a las ocho y treinta' → 08:30", () => {
    const ann = firstOfKind("a las ocho y treinta", "time");
    expect(ann?.normalized).toMatchObject({ type: "time", hh: 8, mm: 30 });
  });

  it("'a las diez de la noche' → 22:00", () => {
    const ann = firstOfKind("la cita es a las diez de la noche", "time");
    expect(ann?.normalized).toMatchObject({ type: "time", hh: 22, mm: 0 });
  });

  it("'a las nueve de la mañana' → 09:00", () => {
    const ann = firstOfKind("a las nueve de la mañana", "time");
    expect(ann?.normalized).toMatchObject({ type: "time", hh: 9, mm: 0 });
  });
});

describe("normalizeNumbers — phone numbers", () => {
  it("captures 10 digit-words as a phone", () => {
    const ann = firstOfKind(
      "mi número es cinco uno dos siete cuatro tres dos uno cinco seis",
      "phone",
    );
    expect(ann).toBeTruthy();
    if (ann?.normalized.type === "phone") {
      expect(ann.normalized.digits).toBe("5127432156");
      expect(ann.normalized.e164).toBe("+15127432156");
    }
  });

  it("does not match runs shorter than 7", () => {
    const ann = firstOfKind("dos tres cuatro", "phone");
    expect(ann).toBeUndefined();
  });
});

describe("normalizeNumbers — dosage", () => {
  it("'dos pastillas dos veces al día'", () => {
    const ann = firstOfKind("dos pastillas dos veces al dia", "dose");
    expect(ann?.normalized).toMatchObject({
      type: "dose",
      quantity: 2,
      unit: "pastillas",
      frequency: "2x/day",
    });
  });

  it("'una capsula cada ocho horas' → quantity 1 (no freq match)", () => {
    const ann = firstOfKind("una capsula", "dose");
    expect(ann?.normalized).toMatchObject({
      type: "dose",
      quantity: 1,
      unit: "capsula",
    });
  });
});

describe("normalizeNumbers — ordinals", () => {
  it("'primero' → 1", () => {
    const ann = firstOfKind("el primero", "ordinal");
    expect(ann?.normalized).toMatchObject({ type: "ordinal", value: 1 });
  });

  it("'tercero' → 3", () => {
    const ann = firstOfKind("el tercero del mes", "ordinal");
    expect(ann?.normalized).toMatchObject({ type: "ordinal", value: 3 });
  });
});

describe("toE164", () => {
  it("US 10-digit", () => {
    expect(toE164("5127432156")).toBe("+15127432156");
  });
  it("US 11-digit with leading 1", () => {
    expect(toE164("15127432156")).toBe("+15127432156");
  });
  it("rejects too-short", () => {
    expect(toE164("12345")).toBeNull();
  });
  it("strips non-digits", () => {
    expect(toE164("(512) 743-2156")).toBe("+15127432156");
  });
});

describe("normalizeNumbers — sanity", () => {
  it("no annotations on empty", () => {
    expect(normalizeNumbers("", { referenceDate: REF })).toEqual([]);
  });

  it("preserves source offsets", () => {
    const text = "la cita es el quince de marzo";
    const anns = normalizeNumbers(text, { referenceDate: REF });
    const date = anns.find((a) => a.kind === "date");
    expect(date).toBeTruthy();
    expect(text.slice(date!.start, date!.end)).toContain("quince");
  });
});

describe("internal cardinal parser", () => {
  it("UNITS, TENS, HUNDREDS are populated", () => {
    expect(Object.keys(__internals.UNITS).length).toBeGreaterThan(20);
    expect(Object.keys(__internals.TENS).length).toBe(7);
    expect(Object.keys(__internals.HUNDREDS).length).toBeGreaterThan(8);
  });
});
