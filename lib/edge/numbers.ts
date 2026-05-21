// Track C3 — Spanish numeral / date / time / phone normalizer.
//
// STT often emits Spanish numerics as words ("cinco uno dos") rather than
// digits. The friend then has to mentally compose the number, which is
// error-prone for callbacks, doses, DOBs. This module post-processes the
// transcript to surface structured forms the UI can overlay.
//
// Hand-rolled — no `numero-a-letras` dep.
//
// Coverage:
//   * cardinals 0..100 (uno..cien) + the obvious 200/500/1000 anchors
//   * ordinals primero..decimo (extending to vigesimo where useful)
//   * days of week, months
//   * times: "tres y media", "tres y cuarto", "tres menos cuarto",
//            "ocho y treinta", "a las quince horas", "diez de la noche"
//   * dates: "el quince de marzo", "el primero de enero del dos mil veintiseis"
//   * phone digit-runs spelled out
//   * dosage: "dos pastillas dos veces al dia"
//
// Returns annotation spans the UI can decorate. We never *replace* the
// transcript text — we only annotate so the friend can see both the raw
// utterance and the structured form.

export type AnnotationKind =
  | "number"
  | "date"
  | "time"
  | "phone"
  | "dose"
  | "ordinal";

export interface NumberAnnotation {
  kind: AnnotationKind;
  /** Original spoken span. */
  spoken: string;
  /** Structured normalization. Shape depends on `kind`. */
  normalized: NormalizedValue;
  /** Char offset in source. */
  start: number;
  end: number;
  /** [0,1]. Higher = more confident. */
  confidence: number;
}

export type NormalizedValue =
  | { type: "integer"; value: number }
  | { type: "ordinal"; value: number }
  | { type: "date"; iso: string; year?: number; month?: number; day?: number }
  | { type: "time"; hh: number; mm: number; iso: string }
  | { type: "phone"; e164: string | null; digits: string }
  | { type: "dose"; quantity: number; unit: string; frequency?: string };

// ---------------------------------------------------------------------------
// Word tables.
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  cero: 0,
  uno: 1, una: 1, un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16, "diez y seis": 16,
  diecisiete: 17, "diez y siete": 17,
  dieciocho: 18, "diez y ocho": 18,
  diecinueve: 19, "diez y nueve": 19,
  veinte: 20,
  veintiuno: 21, veintiun: 21, veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const TENS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200, doscientas: 200,
  trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

const ORDINALS: Record<string, number> = {
  primero: 1, primer: 1, primera: 1,
  segundo: 2, segunda: 2,
  tercero: 3, tercer: 3, tercera: 3,
  cuarto: 4, cuarta: 4,
  quinto: 5, quinta: 5,
  sexto: 6, sexta: 6,
  septimo: 7, septima: 7,
  octavo: 8, octava: 8,
  noveno: 9, novena: 9,
  decimo: 10, decima: 10,
};

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9, setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const DAY_PHRASES: Record<string, number> = {
  // 0 = Sunday in JS Date convention, but Spanish weeks start Monday;
  // we use ISO numbers (1=Mon..7=Sun).
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normWord(s: string): string {
  return stripDiacritics(s.toLowerCase()).replace(/[^a-z0-9 ]/g, "");
}

interface Token {
  raw: string;
  norm: string;
  start: number;
  end: number;
}

const TOKEN_RE = /[\p{L}\p{N}]+/gu;
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const start = m.index ?? 0;
    out.push({ raw, norm: normWord(raw), start, end: start + raw.length });
  }
  return out;
}

// Parse a contiguous run of cardinal-number words into an integer.
// Returns `{ value, consumed }` where `consumed` is # of tokens used, or
// `null` if the run isn't a valid number.
function parseCardinalRun(
  tokens: Token[],
  i: number,
): { value: number; consumed: number } | null {
  let value = 0;
  let consumed = 0;
  let any = false;

  // mil-prefix: "mil", "dos mil", "dos mil veintiseis"
  // Check for `<n> mil` first.
  const t0 = tokens[i]?.norm;
  if (t0 === "mil") {
    value += 1000;
    consumed += 1;
    any = true;
  } else if (t0 && (UNITS[t0] !== undefined || TENS[t0] !== undefined || HUNDREDS[t0] !== undefined)) {
    // Possibly "<n> mil ..."
    const peek = parseHundredsRun(tokens, i);
    if (peek && tokens[i + peek.consumed]?.norm === "mil") {
      value += peek.value * 1000;
      consumed += peek.consumed + 1;
      any = true;
    }
  }

  // Now parse hundreds part of remainder.
  const tail = parseHundredsRun(tokens, i + consumed);
  if (tail) {
    value += tail.value;
    consumed += tail.consumed;
    any = true;
  }
  if (!any) return null;
  return { value, consumed };
}

function parseHundredsRun(
  tokens: Token[],
  i: number,
): { value: number; consumed: number } | null {
  let value = 0;
  let consumed = 0;
  let any = false;

  // Hundreds chunk: cien | ciento <units?> | <doscientos..novecientos>
  const t0 = tokens[i]?.norm;
  if (t0 && HUNDREDS[t0] !== undefined) {
    value += HUNDREDS[t0];
    consumed += 1;
    any = true;
    if (t0 === "ciento") {
      // "ciento veinte" etc.
      const tens = parseTensUnits(tokens, i + consumed);
      if (tens) {
        value += tens.value;
        consumed += tens.consumed;
      }
      return { value, consumed };
    }
    // For doscientos..novecientos, also accept trailing tens/units.
    const tens = parseTensUnits(tokens, i + consumed);
    if (tens) {
      value += tens.value;
      consumed += tens.consumed;
    }
    return { value, consumed };
  }

  const tens = parseTensUnits(tokens, i + consumed);
  if (tens) {
    value += tens.value;
    consumed += tens.consumed;
    any = true;
  }
  return any ? { value, consumed } : null;
}

function parseTensUnits(
  tokens: Token[],
  i: number,
): { value: number; consumed: number } | null {
  const t0 = tokens[i]?.norm;
  if (!t0) return null;

  // Compound: "treinta y cinco"
  if (TENS[t0] !== undefined) {
    let value = TENS[t0];
    let consumed = 1;
    if (
      tokens[i + 1]?.norm === "y" &&
      tokens[i + 2]?.norm &&
      UNITS[tokens[i + 2].norm] !== undefined &&
      UNITS[tokens[i + 2].norm] < 10
    ) {
      value += UNITS[tokens[i + 2].norm];
      consumed += 2;
    }
    return { value, consumed };
  }

  if (UNITS[t0] !== undefined) {
    return { value: UNITS[t0], consumed: 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public scanner.
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  /** Reference date for date phrases like "manana"; default `new Date()`. */
  referenceDate?: Date;
}

export function normalizeNumbers(
  text: string,
  opts: NormalizeOptions = {},
): NumberAnnotation[] {
  const ref = opts.referenceDate ?? new Date();
  const tokens = tokenize(text);
  const out: NumberAnnotation[] = [];

  for (let i = 0; i < tokens.length; i++) {
    // Try date phrases first — they look like "(el) <day> de <month> (del <year>)".
    const dateMatch = tryDate(tokens, i, ref);
    if (dateMatch) {
      out.push(dateMatch.ann);
      i += dateMatch.consumed - 1;
      continue;
    }

    // Time phrases: "(a) las <hh> (y media | y cuarto | menos cuarto | y <mm>)"
    const timeMatch = tryTime(tokens, i);
    if (timeMatch) {
      out.push(timeMatch.ann);
      i += timeMatch.consumed - 1;
      continue;
    }

    // Dosage: "<n> pastilla(s) <freq>"
    const doseMatch = tryDose(tokens, i);
    if (doseMatch) {
      out.push(doseMatch.ann);
      i += doseMatch.consumed - 1;
      continue;
    }

    // Phone digit-runs: 7+ consecutive digit-words.
    const phoneMatch = tryPhone(tokens, i);
    if (phoneMatch) {
      out.push(phoneMatch.ann);
      i += phoneMatch.consumed - 1;
      continue;
    }

    // Ordinals.
    const ordMatch = tryOrdinal(tokens, i);
    if (ordMatch) {
      out.push(ordMatch.ann);
      i += ordMatch.consumed - 1;
      continue;
    }

    // Plain cardinal number.
    const num = parseCardinalRun(tokens, i);
    if (num && num.consumed >= 1) {
      const startTok = tokens[i];
      const endTok = tokens[i + num.consumed - 1];
      out.push({
        kind: "number",
        spoken: text.slice(startTok.start, endTok.end),
        normalized: { type: "integer", value: num.value },
        start: startTok.start,
        end: endTok.end,
        confidence: 0.85,
      });
      i += num.consumed - 1;
      continue;
    }
  }

  return out;
}

// ---- date ---------------------------------------------------------------

function tryDate(
  tokens: Token[],
  i: number,
  ref: Date,
): { ann: NumberAnnotation; consumed: number } | null {
  // Optional leading "el" / "este" / "el proximo".
  let cursor = i;
  if (tokens[cursor]?.norm === "el" || tokens[cursor]?.norm === "este") cursor += 1;

  // Day of month — either a cardinal or "primero" (the only ordinal day used in dates).
  let day: number | null = null;
  let dayConsumed = 0;
  if (tokens[cursor]?.norm === "primero" || tokens[cursor]?.norm === "primer") {
    day = 1;
    dayConsumed = 1;
  } else {
    const card = parseCardinalRun(tokens, cursor);
    if (card && card.value >= 1 && card.value <= 31) {
      day = card.value;
      dayConsumed = card.consumed;
    }
  }
  if (day === null) return null;
  cursor += dayConsumed;

  // "de"
  if (tokens[cursor]?.norm !== "de") return null;
  cursor += 1;

  // month word
  const monthWord = tokens[cursor]?.norm;
  if (!monthWord || MONTHS[monthWord] === undefined) return null;
  const month = MONTHS[monthWord];
  cursor += 1;

  // Optional " (de|del) <year>"
  let year = ref.getFullYear();
  let yearConsumed = 0;
  if (tokens[cursor]?.norm === "de" || tokens[cursor]?.norm === "del") {
    const card = parseCardinalRun(tokens, cursor + 1);
    if (card && card.value > 1900 && card.value < 2200) {
      year = card.value;
      yearConsumed = 1 + card.consumed;
    }
  }
  cursor += yearConsumed;

  const startTok = tokens[i];
  const endTok = tokens[cursor - 1];
  const iso = `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
  return {
    ann: {
      kind: "date",
      spoken: stringifyTokens(tokens, i, cursor),
      normalized: { type: "date", iso, year, month, day },
      start: startTok.start,
      end: endTok.end,
      confidence: 0.9,
    },
    consumed: cursor - i,
  };
}

// ---- time ---------------------------------------------------------------

function tryTime(
  tokens: Token[],
  i: number,
): { ann: NumberAnnotation; consumed: number } | null {
  let cursor = i;

  // Optional "a las" / "las".
  if (tokens[cursor]?.norm === "a") cursor += 1;
  if (tokens[cursor]?.norm === "las" || tokens[cursor]?.norm === "la") cursor += 1;

  if (cursor === i) {
    // No prefix → only accept if hour is followed by a clear time qualifier.
  }

  const hourCard = parseCardinalRun(tokens, cursor);
  if (!hourCard || hourCard.value < 0 || hourCard.value > 24) return null;
  let hour = hourCard.value;
  cursor += hourCard.consumed;

  // Need at least the prefix or a qualifier to count as time.
  let mm = 0;
  let qualifier = false;
  let pmHint: "am" | "pm" | null = null;

  if (tokens[cursor]?.norm === "y") {
    // "y media", "y cuarto", "y <mm>"
    const next = tokens[cursor + 1]?.norm;
    if (next === "media") {
      mm = 30;
      cursor += 2;
      qualifier = true;
    } else if (next === "cuarto") {
      mm = 15;
      cursor += 2;
      qualifier = true;
    } else {
      const minCard = parseCardinalRun(tokens, cursor + 1);
      if (minCard && minCard.value < 60) {
        mm = minCard.value;
        cursor += 1 + minCard.consumed;
        qualifier = true;
      }
    }
  } else if (tokens[cursor]?.norm === "menos") {
    const next = tokens[cursor + 1]?.norm;
    if (next === "cuarto") {
      mm = 45;
      hour = (hour + 23) % 24; // "tres menos cuarto" → 02:45
      cursor += 2;
      qualifier = true;
    } else {
      const minCard = parseCardinalRun(tokens, cursor + 1);
      if (minCard && minCard.value < 60) {
        mm = 60 - minCard.value;
        hour = (hour + 23) % 24;
        cursor += 1 + minCard.consumed;
        qualifier = true;
      }
    }
  }

  // PM / AM hints — "de la tarde", "de la noche", "de la manana", "horas".
  if (tokens[cursor]?.norm === "de" && tokens[cursor + 1]?.norm === "la") {
    const next2 = tokens[cursor + 2]?.norm;
    if (next2 === "tarde" || next2 === "noche") {
      pmHint = "pm";
      cursor += 3;
      qualifier = true;
    } else if (next2 === "manana") {
      pmHint = "am";
      cursor += 3;
      qualifier = true;
    }
  } else if (tokens[cursor]?.norm === "horas") {
    cursor += 1;
    qualifier = true;
  }

  if (!qualifier && !(tokens[i]?.norm === "a" || tokens[i]?.norm === "las")) {
    return null;
  }

  if (pmHint === "pm" && hour < 12) hour += 12;
  if (pmHint === "am" && hour === 12) hour = 0;
  hour = ((hour % 24) + 24) % 24;
  mm = ((mm % 60) + 60) % 60;

  const startTok = tokens[i];
  const endTok = tokens[cursor - 1];
  return {
    ann: {
      kind: "time",
      spoken: stringifyTokens(tokens, i, cursor),
      normalized: {
        type: "time",
        hh: hour,
        mm,
        iso: `${pad2(hour)}:${pad2(mm)}`,
      },
      start: startTok.start,
      end: endTok.end,
      confidence: pmHint || qualifier ? 0.9 : 0.7,
    },
    consumed: cursor - i,
  };
}

// ---- ordinal ------------------------------------------------------------

function tryOrdinal(
  tokens: Token[],
  i: number,
): { ann: NumberAnnotation; consumed: number } | null {
  const t = tokens[i]?.norm;
  if (!t || ORDINALS[t] === undefined) return null;
  return {
    ann: {
      kind: "ordinal",
      spoken: tokens[i].raw,
      normalized: { type: "ordinal", value: ORDINALS[t] },
      start: tokens[i].start,
      end: tokens[i].end,
      confidence: 0.9,
    },
    consumed: 1,
  };
}

// ---- phone --------------------------------------------------------------

function tryPhone(
  tokens: Token[],
  i: number,
): { ann: NumberAnnotation; consumed: number } | null {
  // 7+ consecutive single-digit words → phone number.
  let consumed = 0;
  const digits: number[] = [];
  while (i + consumed < tokens.length) {
    const norm = tokens[i + consumed].norm;
    const v = UNITS[norm];
    // Only accept 0..9.
    if (v === undefined || v > 9) break;
    digits.push(v);
    consumed += 1;
  }
  if (digits.length < 7) return null;

  const digitsStr = digits.join("");
  const startTok = tokens[i];
  const endTok = tokens[i + consumed - 1];
  return {
    ann: {
      kind: "phone",
      spoken: stringifyTokens(tokens, i, i + consumed),
      normalized: {
        type: "phone",
        e164: toE164(digitsStr),
        digits: digitsStr,
      },
      start: startTok.start,
      end: endTok.end,
      confidence: digits.length >= 10 ? 0.95 : 0.7,
    },
    consumed,
  };
}

/**
 * Convert a digit string to E.164 with US default. Pure helper, exported
 * for `callback-verify.ts`.
 */
export function toE164(digits: string): string | null {
  const clean = digits.replace(/\D/g, "");
  if (clean.length === 10) return `+1${clean}`;
  if (clean.length === 11 && clean.startsWith("1")) return `+${clean}`;
  if (clean.length >= 8 && clean.length <= 15) return `+${clean}`;
  return null;
}

// ---- dose ---------------------------------------------------------------

const DOSE_UNITS = new Set([
  "pastilla",
  "pastillas",
  "tableta",
  "tabletas",
  "capsula",
  "capsulas",
  "gota",
  "gotas",
  "cucharada",
  "cucharadas",
  "ml",
  "mililitros",
  "mg",
  "miligramos",
]);

function tryDose(
  tokens: Token[],
  i: number,
): { ann: NumberAnnotation; consumed: number } | null {
  const card = parseCardinalRun(tokens, i);
  if (!card) return null;
  const unitTok = tokens[i + card.consumed];
  if (!unitTok || !DOSE_UNITS.has(unitTok.norm)) return null;

  let consumed = card.consumed + 1;
  let frequency: string | undefined;

  // "<n> veces al dia" — capture freq if present.
  const freqStart = i + consumed;
  const freqCard = parseCardinalRun(tokens, freqStart);
  if (
    freqCard &&
    tokens[freqStart + freqCard.consumed]?.norm === "veces" &&
    tokens[freqStart + freqCard.consumed + 1]?.norm === "al" &&
    tokens[freqStart + freqCard.consumed + 2]?.norm === "dia"
  ) {
    frequency = `${freqCard.value}x/day`;
    consumed += freqCard.consumed + 3;
  }

  const startTok = tokens[i];
  const endTok = tokens[i + consumed - 1];
  return {
    ann: {
      kind: "dose",
      spoken: stringifyTokens(tokens, i, i + consumed),
      normalized: {
        type: "dose",
        quantity: card.value,
        unit: unitTok.norm,
        frequency,
      },
      start: startTok.start,
      end: endTok.end,
      confidence: 0.85,
    },
    consumed,
  };
}

// ---- misc ---------------------------------------------------------------

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

function stringifyTokens(tokens: Token[], i: number, end: number): string {
  if (i >= tokens.length) return "";
  return tokens.slice(i, end).map((t) => t.raw).join(" ");
}

// Re-export for tests + callback-verify integration.
export const __internals = {
  UNITS,
  TENS,
  HUNDREDS,
  ORDINALS,
  MONTHS,
  DAY_PHRASES,
  parseCardinalRun,
  parseHundredsRun,
  parseTensUnits,
  tokenize,
};
