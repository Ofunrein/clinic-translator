// Track C3 — heuristic ES↔EN code-switch detector.
//
// Real clinic patients mix Spanish and English mid-sentence:
//   "tengo un appointment mañana"
//   "the doctor said I need pastillas"
//
// We classify each token by membership in stopword + frequent-word lists,
// then return the dominant `primary` language, the secondary, and the
// switch indices. The route handler can pass `code_switched: true` to the
// translate prompt so Claude preserves the mixed segments instead of
// over-translating English back into Spanish.
//
// Hand-rolled stopword sets — NO new deps (`franc`, `cld`, etc).
// Spec §7: degraded paths must still ship; this works fully offline.

export type Lang = "es" | "en";

export interface CodeSwitchToken {
  /** Original surface form. */
  text: string;
  /** Detected language, or `null` for tokens we can't classify (numbers, names). */
  lang: Lang | null;
  /** Char offset in the source string. */
  start: number;
  end: number;
}

export interface CodeSwitchResult {
  primary: Lang;
  secondary: Lang | null;
  /** True when both langs cleared the `mixThreshold`. */
  mixed: boolean;
  /** Token indices where the language flipped from the previous classified token. */
  switchPoints: number[];
  tokens: CodeSwitchToken[];
  /** Confidence in `primary` ∈ [0,1] — fraction of classified tokens. */
  confidence: number;
}

// ---- Word lists ---------------------------------------------------------

// Spanish stopwords + medical-call frequent words.
const ES_WORDS = new Set<string>([
  "el","la","los","las","un","una","unos","unas",
  "de","del","al","a","y","o","u","e","ni","pero","aunque",
  "que","quien","cuyo","cual","cuales","cuanto","cuanta","cuantos","cuantas",
  "es","son","fue","era","esta","estan","estaba","estoy","estamos","estaban",
  "soy","eres","somos","sois","sea","ser","estar","ha","han","hay","habia","hubo",
  "me","te","se","nos","os","le","les","mi","tu","su","sus","nuestro","nuestra",
  "yo","tu","el","ella","nosotros","ustedes","ellos","ellas",
  "no","si","muy","mas","menos","tan","tanto","mucho","poco","poca","pocos","pocas",
  "para","por","con","sin","sobre","entre","hasta","desde","hacia","bajo",
  "este","esta","esto","ese","esa","aquel","aquella",
  "cuando","donde","como","porque","mientras",
  "buenos","buenas","dias","tardes","noches","gracias","favor","por favor",
  "doctor","doctora","medico","clinica","cita","receta","pastilla","pastillas",
  "dolor","duele","enfermo","enferma","fiebre","tos","sangre","embarazada",
  "manana","ayer","hoy","semana","mes","ano","hora","minuto",
  "necesito","quiero","puedo","debo","tengo","tiene","tenemos","tenia",
  "donde","cuando","cuanto","quien","que",
  "perdon","disculpe","entiendo","entiende","habla","hablo",
  "hijo","hija","esposo","esposa","madre","padre","mama","papa","nino","nina",
]);

// English stopwords + medical-call frequent words.
// Words spelled identically in both languages (doctor, clinic, hospital,
// no, ok) are duplicated in both sets. The classifier handles dual hits
// by returning a special "either" tag and a second pass binds them to
// the majority language so they don't pull toward the minority.
const EN_WORDS = new Set<string>([
  "the","a","an","of","and","or","but","if","then","so","because","while",
  "is","are","was","were","be","been","being","am",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their",
  "this","that","these","those",
  "to","from","with","without","on","off","over","under","between","through",
  "at","by","for","into","onto","up","down","out","in",
  "no","yes","not","very","more","less","much","many","some","any","all",
  "do","does","did","done","have","has","had","can","could","will","would","should",
  "what","when","where","who","why","how","which",
  "good","morning","afternoon","evening","night","please","thanks","thank",
  "doctor","appointment","clinic","prescription","pill","pills","hospital",
  "pain","hurts","sick","fever","cough","blood","pregnant",
  "tomorrow","yesterday","today","week","month","year","hour","minute",
  "need","want","may","must","got","get","take","took","feel",
  "okay","ok","sorry","excuse","understand","speak","english",
  "son","daughter","husband","wife","mother","father","mom","dad","child","kid",
]);

// ASCII characters that always remain ASCII in Spanish even with diacritics.
const SPANISH_DIACRITICS = /[áéíóúüñ¿¡]/i;
// English-leaning patterns we use as tie-breakers (uniquely English: contractions like "you're").
const EN_CONTRACTION = /'(re|ve|ll|s|d|m|t)$/i;

// ---- Tokenizer ----------------------------------------------------------

const WORD_RE = /[\p{L}\p{N}'’]+/gu;

function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(/['’]/g, "'")
    // Strip diacritics for set lookup. We retain the un-stripped form for
    // diacritic-based ES tagging below.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ---- Classifier ---------------------------------------------------------

interface InternalToken extends CodeSwitchToken {
  /** Pre-strip form, for diacritic detection. */
  raw: string;
  norm: string;
  /** True iff the token's surface form matched both ES and EN word lists. */
  either: boolean;
}

function classifyOne(t: InternalToken): { lang: Lang | null; either: boolean } {
  // Punctuation-stripped numerics → unclassifiable.
  if (/^[0-9]+$/.test(t.norm)) return { lang: null, either: false };

  // Diacritics or Spanish punctuation → ES.
  if (SPANISH_DIACRITICS.test(t.raw)) return { lang: "es", either: false };

  // Contractions → EN.
  if (EN_CONTRACTION.test(t.raw)) return { lang: "en", either: false };

  const inEs = ES_WORDS.has(t.norm);
  const inEn = EN_WORDS.has(t.norm);
  if (inEs && inEn) return { lang: null, either: true };
  if (inEs) return { lang: "es", either: false };
  if (inEn) return { lang: "en", either: false };
  return { lang: null, either: false };
}

export interface DetectOptions {
  /** Minimum fraction of classified tokens for a language to count as mixed. */
  mixThreshold?: number;
}

export function detectCodeSwitch(
  text: string,
  opts: DetectOptions = {},
): CodeSwitchResult {
  // 0.12 — even a single foreign content word in a short utterance counts.
  // We then guard with a `classified >= 3` floor so very short fragments
  // ("hola world") don't get flagged on noise.
  const mixThreshold = opts.mixThreshold ?? 0.12;
  const internal: InternalToken[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const end = start + raw.length;
    const norm = normalize(raw);
    const tok: InternalToken = {
      text: raw,
      raw,
      norm,
      start,
      end,
      lang: null,
      either: false,
    };
    const { lang, either } = classifyOne(tok);
    tok.lang = lang;
    tok.either = either;
    internal.push(tok);
  }

  // First pass: count strictly-classified tokens.
  let esCount = 0;
  let enCount = 0;
  for (const t of internal) {
    if (t.either) continue;
    if (t.lang === "es") esCount++;
    else if (t.lang === "en") enCount++;
  }

  // Determine majority from strict counts; bind dual-listed tokens to it.
  const strictClassified = esCount + enCount;
  let majority: Lang = "es";
  if (strictClassified > 0) {
    majority = esCount >= enCount ? "es" : "en";
  } else {
    // No strict signal — leave dual tokens unclassified.
    majority = "es";
  }
  for (const t of internal) {
    if (t.either && strictClassified > 0) {
      t.lang = majority;
      // Don't tally either tokens — they only ever bind, never push.
    }
  }

  const classified = esCount + enCount;

  const tokens: CodeSwitchToken[] = internal.map((t) => ({
    text: t.text,
    lang: t.lang,
    start: t.start,
    end: t.end,
  }));

  // Switch points — only between *classified* tokens.
  const switchPoints: number[] = [];
  let lastLang: Lang | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const l = tokens[i].lang;
    if (!l) continue;
    if (lastLang !== null && l !== lastLang) {
      switchPoints.push(i);
    }
    lastLang = l;
  }

  if (classified === 0) {
    // Default to ES — patient pane is ES-primary. Confidence 0 signals
    // "no idea, don't make decisions on this".
    return {
      primary: "es",
      secondary: null,
      mixed: false,
      switchPoints,
      tokens,
      confidence: 0,
    };
  }

  const esFrac = esCount / classified;
  const enFrac = enCount / classified;
  const primary: Lang = esFrac >= enFrac ? "es" : "en";
  const secondary: Lang = primary === "es" ? "en" : "es";
  const minorityFrac = Math.min(esFrac, enFrac);
  const mixed = minorityFrac >= mixThreshold && classified >= 3;
  const confidence = primary === "es" ? esFrac : enFrac;

  return {
    primary,
    secondary: mixed ? secondary : null,
    mixed,
    switchPoints,
    tokens,
    confidence,
  };
}

/**
 * Build the prompt-augmentation string for the translate route. Returned
 * verbatim so Track B2's `/api/translate` can append it to the system prompt.
 * Only emits guidance when a real mix is detected.
 */
export function codeSwitchPromptHint(r: CodeSwitchResult): string | null {
  if (!r.mixed) return null;
  return `the speaker code-switched between ${r.primary} and ${r.secondary}; preserve mixed segments naturally without re-translating already-target-language words`;
}
