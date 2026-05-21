// Track C3 — light Spanish profanity scan.
//
// Medical-call rule: NEVER censor or replace. Cursing can convey distress
// (pain, fear, frustration with the system). We just flag the term so
// QA review can spot it later — the UI shows a small ⚠ icon and stores
// a `profanity` entry in the utterance notes JSON.
//
// Curated ~30 entries — common Mexican / Caribbean / Central-American.
// We accept obvious diacritic variants and `*`/`x` masking.
//
// This is a *signal*, not a filter. Don't tighten the list past mild
// usefulness — false positives here are worse than false negatives.

const PROFANITY: ReadonlyArray<string> = [
  "mierda",
  "puta",
  "puto",
  "putada",
  "cabron",
  "cabrona",
  "carajo",
  "joder",
  "jodido",
  "jodida",
  "coño",
  "cono",
  "pendejo",
  "pendeja",
  "chingar",
  "chingada",
  "chingado",
  "chingadera",
  "verga",
  "vergon",
  "culero",
  "culera",
  "marica",
  "maricon",
  "hijueputa",
  "hijoeputa",
  "hijo de puta",
  "concha",
  "conchudo",
  "conchudo",
  "boludo",
  "pelotudo",
  "gilipollas",
  "mamon",
  "mamona",
];

function strip(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Treat * / x / @ as wildcards to a single letter. Keep simple: replace
    // common masking chars with `.` for regex.
    .replace(/[\*x@]/g, ".");
}

const PATTERNS: Array<{ word: string; re: RegExp }> = PROFANITY.map((w) => {
  const stripped = strip(w);
  // Word-boundary regex over the stripped string. Allow non-letter chars
  // between letters (catch "p u t a" and "p*ta").
  const escaped = stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    word: w,
    re: new RegExp(`\\b${escaped}\\b`, "i"),
  };
});

export interface ProfanityHit {
  /** The dictionary entry that matched. */
  term: string;
  /** Char start in the *normalized* text — same length as the original under NFD strip. */
  start: number;
  end: number;
  /** Surface form from the original text. */
  matched: string;
}

/**
 * Scan a piece of transcript text. Returns offsets relative to the *original*
 * input text. We keep diacritics in the original — the matching is on the
 * stripped form but offsets re-mapped using the position-preserving NFD
 * decomposition we apply.
 */
export function scanProfanity(text: string): ProfanityHit[] {
  if (!text) return [];
  // Position-preserving lower + diacritic strip. Replace combining marks
  // with empty string changes length, so we walk char-by-char.
  const lower = text.toLowerCase();
  const stripped: string[] = [];
  const offsetMap: number[] = []; // stripped[i] came from lower[offsetMap[i]]
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const decomp = ch.normalize("NFD");
    for (const c of decomp) {
      const code = c.charCodeAt(0);
      // Skip combining marks 0x0300-0x036F.
      if (code >= 0x0300 && code <= 0x036f) continue;
      stripped.push(c === "*" || c === "x" || c === "@" ? "." : c);
      offsetMap.push(i);
    }
  }
  const haystack = stripped.join("");
  const hits: ProfanityHit[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    const re = new RegExp(p.re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      const startStripped = m.index;
      const endStripped = m.index + m[0].length - 1;
      const startOrig = offsetMap[startStripped] ?? startStripped;
      const endOrig = (offsetMap[endStripped] ?? endStripped) + 1;
      hits.push({
        term: p.word,
        start: startOrig,
        end: endOrig,
        matched: text.slice(startOrig, endOrig),
      });
    }
  }
  // Dedupe overlapping hits — keep the longest.
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: ProfanityHit[] = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      out.push(h);
      lastEnd = h.end;
    }
  }
  return out;
}

export interface ProfanityNotesBlob {
  flagged: true;
  count: number;
  terms: string[];
}

/** Build the JSON to merge into `utterance.notes_enc`. */
export function buildProfanityNotes(hits: ProfanityHit[]): ProfanityNotesBlob | null {
  if (hits.length === 0) return null;
  const terms = Array.from(new Set(hits.map((h) => h.term)));
  return { flagged: true, count: hits.length, terms };
}

/** Convenience: just "did anything trip?". */
export function hasProfanity(text: string): boolean {
  return scanProfanity(text).length > 0;
}
