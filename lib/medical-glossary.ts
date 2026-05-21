// Owned by Track B3.
// Static seed glossary. The DB-backed `glossary_terms` table (Track B1) is the
// source of truth in production; this module backs offline rendering of
// glossary hits in the live transcript before the server response arrives.

export type Dialect = "mx" | "cen" | "car" | "all";
export type GlossaryCategory = "drug" | "procedure" | "intake" | "other";

export interface GlossaryTerm {
  en: string;
  es: string;
  dialect: Dialect;
  category: GlossaryCategory;
}

export interface GlossaryHit {
  term: GlossaryTerm;
  /** Inclusive start index into the source text (lower-cased match). */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** The matched substring as it appeared in the source. */
  matched: string;
}

// ~40 terms covering common drug names, intake phrases, dialect splits.
export const MEDICAL_GLOSSARY: GlossaryTerm[] = [
  // --- Drugs (canonical brand/generic, language-neutral) ---
  { en: "metformin", es: "metformina", dialect: "all", category: "drug" },
  { en: "ibuprofen", es: "ibuprofeno", dialect: "all", category: "drug" },
  { en: "acetaminophen", es: "acetaminofén", dialect: "all", category: "drug" },
  { en: "tylenol", es: "tylenol", dialect: "all", category: "drug" },
  { en: "advil", es: "advil", dialect: "all", category: "drug" },
  { en: "amoxicillin", es: "amoxicilina", dialect: "all", category: "drug" },
  { en: "lisinopril", es: "lisinopril", dialect: "all", category: "drug" },
  { en: "atorvastatin", es: "atorvastatina", dialect: "all", category: "drug" },
  { en: "albuterol", es: "albuterol", dialect: "all", category: "drug" },
  { en: "insulin", es: "insulina", dialect: "all", category: "drug" },
  { en: "amlodipine", es: "amlodipino", dialect: "all", category: "drug" },
  { en: "prednisone", es: "prednisona", dialect: "all", category: "drug" },

  // --- Procedures ---
  { en: "blood test", es: "análisis de sangre", dialect: "all", category: "procedure" },
  { en: "blood draw", es: "extracción de sangre", dialect: "all", category: "procedure" },
  { en: "x-ray", es: "radiografía", dialect: "all", category: "procedure" },
  { en: "ultrasound", es: "ultrasonido", dialect: "all", category: "procedure" },
  { en: "vaccine", es: "vacuna", dialect: "all", category: "procedure" },
  { en: "flu shot", es: "vacuna contra la gripe", dialect: "all", category: "procedure" },
  // Caribbean uses "gripa" less; "catarro" / "gripe" both common — keep dialect splits below.
  { en: "blood pressure", es: "presión arterial", dialect: "all", category: "procedure" },
  { en: "ekg", es: "electrocardiograma", dialect: "all", category: "procedure" },

  // --- Intake / scheduling phrases ---
  { en: "appointment", es: "cita", dialect: "all", category: "intake" },
  { en: "refill", es: "resurtir", dialect: "mx", category: "intake" },
  { en: "refill", es: "renovar receta", dialect: "cen", category: "intake" },
  { en: "refill", es: "repetir la receta", dialect: "car", category: "intake" },
  { en: "prescription", es: "receta médica", dialect: "all", category: "intake" },
  { en: "insurance", es: "seguro médico", dialect: "all", category: "intake" },
  { en: "copay", es: "copago", dialect: "all", category: "intake" },
  { en: "referral", es: "referencia médica", dialect: "all", category: "intake" },
  { en: "test results", es: "resultados de los exámenes", dialect: "all", category: "intake" },
  { en: "fasting", es: "en ayunas", dialect: "all", category: "intake" },

  // --- Symptom / general ---
  { en: "flu", es: "gripa", dialect: "mx", category: "other" },
  { en: "flu", es: "gripe", dialect: "cen", category: "other" },
  { en: "flu", es: "catarro", dialect: "car", category: "other" },
  { en: "cold", es: "resfriado", dialect: "all", category: "other" },
  { en: "fever", es: "fiebre", dialect: "all", category: "other" },
  { en: "cough", es: "tos", dialect: "all", category: "other" },
  { en: "headache", es: "dolor de cabeza", dialect: "all", category: "other" },
  { en: "stomach ache", es: "dolor de estómago", dialect: "all", category: "other" },
  { en: "pain", es: "dolor", dialect: "all", category: "other" },
  { en: "pregnant", es: "embarazada", dialect: "all", category: "other" },
  { en: "diabetes", es: "diabetes", dialect: "all", category: "other" },
  { en: "high blood pressure", es: "hipertensión", dialect: "all", category: "other" },
];

/**
 * Case-insensitive substring scan across both EN and ES sides of every term.
 * Dialect priority: a specific match (`mx`/`cen`/`car`) wins over `all`,
 * and the more specific match wins on overlap. Stable ordering by `start`.
 *
 * Substring (not whole-word) per spec — Spanish prefixes / clitic forms make
 * whole-word matching too brittle for the live transcript glossary highlight.
 */
export function findGlossaryHits(text: string, dialect: Dialect = "all"): GlossaryHit[] {
  if (!text) return [];
  const lower = text.toLowerCase();

  // Prioritize: dialect-specific terms first, then `all`.
  const specific = dialect === "all"
    ? []
    : MEDICAL_GLOSSARY.filter((t) => t.dialect === dialect);
  const fallback = MEDICAL_GLOSSARY.filter((t) => t.dialect === "all");
  const ordered = [...specific, ...fallback];

  const hits: GlossaryHit[] = [];
  // Track claimed character ranges so dialect-specific wins over `all` on overlap.
  const claimed: Array<[number, number]> = [];
  const overlaps = (a: number, b: number): boolean =>
    claimed.some(([s, e]) => a < e && b > s);

  for (const term of ordered) {
    for (const needle of [term.en, term.es]) {
      const n = needle.toLowerCase();
      if (!n) continue;
      let from = 0;
      // Find every occurrence — long terms can repeat in the same utterance.
      while (from <= lower.length - n.length) {
        const idx = lower.indexOf(n, from);
        if (idx === -1) break;
        const end = idx + n.length;
        if (!overlaps(idx, end)) {
          hits.push({
            term,
            start: idx,
            end,
            matched: text.slice(idx, end),
          });
          claimed.push([idx, end]);
        }
        from = end;
      }
    }
  }

  hits.sort((a, b) => a.start - b.start);
  return hits;
}
