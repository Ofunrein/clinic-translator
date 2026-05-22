// Track C3 — callback-number extraction and read-back verification.
//
// Patient says their callback number; STT emits Spanish digit-words
// ("cinco uno dos siete cuatro tres ..."). `numbers.ts` converts that to
// digits + E.164. This module wraps it for the UI:
//   * extractCallbackNumber(text) — returns the *most likely* callback number
//   * spanishReadback(digits)     — produces the ES read-back sentence the
//                                    UI synthesizes via TTS
//   * persistCallbackNumber       — see `lib/edge/callback-persist.ts` (server)
//
// The widget itself lives in `components/CallbackVerifyCard.tsx`.

import { normalizeNumbers, toE164, type NumberAnnotation } from "./numbers";

export interface ExtractedCallback {
  digits: string;
  e164: string | null;
  /** Original spoken span. */
  spoken: string;
  /** [0,1]. Higher = more confident this is *the* callback number. */
  confidence: number;
}

/**
 * Pull the highest-confidence phone annotation from a transcript chunk.
 * If multiple candidates are present (rare) we prefer the longest digit-run,
 * tie-broken by confidence.
 */
export function extractCallbackNumber(text: string): ExtractedCallback | null {
  const anns = normalizeNumbers(text).filter(
    (a): a is NumberAnnotation & { normalized: { type: "phone"; e164: string | null; digits: string } } =>
      a.kind === "phone" && a.normalized.type === "phone",
  );
  if (anns.length === 0) return null;
  anns.sort((a, b) => {
    const lenA = a.normalized.type === "phone" ? a.normalized.digits.length : 0;
    const lenB = b.normalized.type === "phone" ? b.normalized.digits.length : 0;
    if (lenB !== lenA) return lenB - lenA;
    return b.confidence - a.confidence;
  });
  const best = anns[0];
  if (best.normalized.type !== "phone") return null;
  return {
    digits: best.normalized.digits,
    e164: best.normalized.e164,
    spoken: best.spoken,
    confidence: best.confidence,
  };
}

/** Group a digit string for visual display: "5127432156" → "512-743-2156". */
export function formatDigitsForDisplay(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length === 10) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
  }
  if (clean.length === 11 && clean.startsWith("1")) {
    return `+1 ${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
  }
  // Fallback: chunk every 3 digits.
  return clean.replace(/(\d{3})(?=\d)/g, "$1-");
}

const ES_DIGIT_WORDS: Record<string, string> = {
  "0": "cero",
  "1": "uno",
  "2": "dos",
  "3": "tres",
  "4": "cuatro",
  "5": "cinco",
  "6": "seis",
  "7": "siete",
  "8": "ocho",
  "9": "nueve",
};

/**
 * Build the ES read-back sentence the staff TTS will speak. We spell digits
 * one-by-one so the patient hears each one distinctly.
 */
export function spanishReadback(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length === 0) return "";
  // Group as 3-3-4 for US numbers; otherwise just space the digits.
  const isUs = clean.length === 10 || (clean.length === 11 && clean.startsWith("1"));
  let groups: string[];
  if (isUs) {
    const c = clean.length === 11 ? clean.slice(1) : clean;
    groups = [c.slice(0, 3), c.slice(3, 6), c.slice(6)];
  } else {
    // chunks of 3
    groups = [];
    for (let i = 0; i < clean.length; i += 3) {
      groups.push(clean.slice(i, i + 3));
    }
  }
  const spoken = groups
    .map((g) =>
      g
        .split("")
        .map((d) => ES_DIGIT_WORDS[d] ?? d)
        .join(" "),
    )
    .join(", ");
  return `Su número de teléfono es ${spoken}, ¿es correcto?`;
}

// Re-export for tests and the verify card.
export { toE164 };
