// Track C3 — urgent-medical keyword scanner for the patient transcript.
//
// Auto-elevates `calls.urgency` to `urgent` (Track B2 mapping) and:
//   * surfaces a banner in StaffPane: "URGENT KEYWORD DETECTED — call 911"
//   * plays a soft Web Audio oscillator alert (no audio file needed)
//   * calls Track C1's escalate path so AI-assist suggests a transfer
//
// ~40 phrases curated for clinical triage with dialect awareness:
//   * Mexican: "se desmayó", "no aguanto"
//   * Caribbean: "se está ahogando", "no le coge aire"
//   * Central American: "se me va el aire"
//
// All matching is case/diacritic-insensitive, with substring tolerance
// (so "duele el pecho" trips "dolor de pecho" via stem fallback).
//
// IMPORTANT: this list is conservative. Better to under-match than over-match —
// false alarms desensitize the friend.

import { scanNormalized } from "../text/scanner";

export type UrgencyKeywordCategory =
  | "cardiac"
  | "respiratory"
  | "bleeding"
  | "neuro"
  | "trauma"
  | "obstetric"
  | "explicit_emergency";

export interface UrgencyKeyword {
  pattern: string;
  category: UrgencyKeywordCategory;
  /** Optional dialect note for QA review only. */
  dialect?: "mx" | "cen" | "car" | "all";
  /** [0,1] — confidence that hitting this keyword is real urgency. */
  weight: number;
}

export const URGENT_KEYWORDS: ReadonlyArray<UrgencyKeyword> = [
  // Cardiac
  { pattern: "dolor de pecho",       category: "cardiac",            weight: 0.95 },
  { pattern: "me duele el pecho",    category: "cardiac",            weight: 0.95 },
  { pattern: "presion en el pecho",  category: "cardiac",            weight: 0.85 },
  { pattern: "ataque al corazon",    category: "cardiac",            weight: 0.95 },
  { pattern: "infarto",              category: "cardiac",            weight: 0.95 },
  { pattern: "el corazon le late",   category: "cardiac",            weight: 0.6, dialect: "all" },

  // Respiratory
  { pattern: "no puedo respirar",    category: "respiratory",        weight: 0.95 },
  { pattern: "no respira",           category: "respiratory",        weight: 0.95 },
  { pattern: "se ahoga",             category: "respiratory",        weight: 0.9, dialect: "car" },
  { pattern: "se esta ahogando",     category: "respiratory",        weight: 0.95, dialect: "car" },
  { pattern: "no le coge aire",      category: "respiratory",        weight: 0.85, dialect: "car" },
  { pattern: "se me va el aire",     category: "respiratory",        weight: 0.85, dialect: "cen" },
  { pattern: "falta de aire",        category: "respiratory",        weight: 0.85 },
  { pattern: "asfixia",              category: "respiratory",        weight: 0.9 },
  { pattern: "atragantado",          category: "respiratory",        weight: 0.85 },

  // Bleeding
  { pattern: "sangre",               category: "bleeding",           weight: 0.55 },
  { pattern: "esta sangrando",       category: "bleeding",           weight: 0.85 },
  { pattern: "mucha sangre",         category: "bleeding",           weight: 0.9 },
  { pattern: "sangrado",             category: "bleeding",           weight: 0.7 },
  { pattern: "vomito sangre",        category: "bleeding",           weight: 0.9 },
  { pattern: "tose sangre",          category: "bleeding",           weight: 0.9 },
  { pattern: "hemorragia",           category: "bleeding",           weight: 0.95 },

  // Neuro
  { pattern: "se desmayo",           category: "neuro",              weight: 0.9, dialect: "mx" },
  { pattern: "se desmayó",           category: "neuro",              weight: 0.9 },
  { pattern: "desmayo",              category: "neuro",              weight: 0.7 },
  { pattern: "perdio el conocimiento", category: "neuro",            weight: 0.95 },
  { pattern: "convulsion",           category: "neuro",              weight: 0.95 },
  { pattern: "convulsiones",         category: "neuro",              weight: 0.95 },
  { pattern: "esta convulsionando",  category: "neuro",              weight: 0.95 },
  { pattern: "no responde",          category: "neuro",              weight: 0.85 },
  { pattern: "esta inconsciente",    category: "neuro",              weight: 0.95 },
  { pattern: "derrame",              category: "neuro",              weight: 0.85 },
  { pattern: "no puede mover",       category: "neuro",              weight: 0.7 },

  // Trauma
  { pattern: "accidente",            category: "trauma",             weight: 0.5 },
  { pattern: "se cayo",              category: "trauma",             weight: 0.45 },
  { pattern: "no aguanto el dolor",  category: "trauma",             weight: 0.7, dialect: "mx" },

  // Obstetric
  { pattern: "esta sangrando embarazada", category: "obstetric",     weight: 0.95 },
  { pattern: "rompio fuente",        category: "obstetric",          weight: 0.85 },
  { pattern: "contracciones",        category: "obstetric",          weight: 0.55 },

  // Explicit emergency
  { pattern: "es una emergencia",    category: "explicit_emergency", weight: 0.95 },
  { pattern: "emergencia",           category: "explicit_emergency", weight: 0.7 },
  { pattern: "llamen al 911",        category: "explicit_emergency", weight: 0.99 },
  { pattern: "911",                  category: "explicit_emergency", weight: 0.6 },
  { pattern: "ayuda urgente",        category: "explicit_emergency", weight: 0.85 },
  { pattern: "se esta muriendo",     category: "explicit_emergency", weight: 0.99 },
  { pattern: "se va a morir",        category: "explicit_emergency", weight: 0.9 },
];

export interface UrgencyMatch {
  keyword: UrgencyKeyword;
  start: number;
  end: number;
  matched: string;
}

/**
 * Scan transcript text for urgency keywords. Returns offsets in the
 * *original* text (we walk a position-preserving stripped projection).
 */
export function scanUrgencyKeywords(text: string): UrgencyMatch[] {
  if (!text) return [];
  const raw = scanNormalized(text, URGENT_KEYWORDS, (k) => [k.pattern]);
  const hits: UrgencyMatch[] = raw.map((m) => ({
    keyword: m.item,
    start: m.start,
    end: m.end,
    matched: m.matched,
  }));
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

export interface UrgencyVerdict {
  /** True iff at least one match clears `escalateThreshold`. */
  escalate: boolean;
  /** Max weight across matches, [0,1]. */
  topWeight: number;
  /** Top categories present, sorted by weight desc. */
  categories: UrgencyKeywordCategory[];
  matches: UrgencyMatch[];
}

export interface UrgencyOptions {
  /** Min weight to trigger escalation. Default 0.7. */
  escalateThreshold?: number;
}

export function evaluateUrgency(
  text: string,
  opts: UrgencyOptions = {},
): UrgencyVerdict {
  const matches = scanUrgencyKeywords(text);
  const threshold = opts.escalateThreshold ?? 0.7;
  let topWeight = 0;
  for (const m of matches) {
    if (m.keyword.weight > topWeight) topWeight = m.keyword.weight;
  }
  const cats = new Map<UrgencyKeywordCategory, number>();
  for (const m of matches) {
    cats.set(
      m.keyword.category,
      Math.max(cats.get(m.keyword.category) ?? 0, m.keyword.weight),
    );
  }
  const categories = [...cats.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  return {
    escalate: topWeight >= threshold,
    topWeight,
    categories,
    matches,
  };
}

// ---------------------------------------------------------------------------
// Soft Web Audio alert tone (no audio file).
// Plays a short two-pitch chirp via OscillatorNode. Idempotent — multiple
// calls within `cooldownMs` are coalesced so a flurry of urgent finals
// doesn't pulse the headset to death.
// ---------------------------------------------------------------------------

interface AlertCtx {
  lastPlayedAt: number;
}
const alertCtx: AlertCtx = { lastPlayedAt: 0 };

export interface PlayAlertOptions {
  cooldownMs?: number;
  /** Volume gain 0..1. Default 0.15 — kept low so it cuts through speech but doesn't startle. */
  gain?: number;
}

export function playUrgencyAlert(
  audioCtx: AudioContext,
  opts: PlayAlertOptions = {},
): void {
  const { cooldownMs = 8_000, gain = 0.15 } = opts;
  const now = performance.now();
  if (now - alertCtx.lastPlayedAt < cooldownMs) return;
  alertCtx.lastPlayedAt = now;

  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc1.type = "sine";
  osc2.type = "sine";
  osc1.frequency.value = 880;
  osc2.frequency.value = 1320;
  g.gain.value = 0;

  const t = audioCtx.currentTime;
  // Envelope: quick attack, two-note chirp, decay.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.linearRampToValueAtTime(gain * 0.6, t + 0.18);
  g.gain.linearRampToValueAtTime(0, t + 0.45);

  osc1.frequency.setValueAtTime(880, t);
  osc1.frequency.setValueAtTime(0, t + 0.18);
  osc2.frequency.setValueAtTime(0, t);
  osc2.frequency.setValueAtTime(1320, t + 0.18);

  osc1.connect(g);
  osc2.connect(g);
  g.connect(audioCtx.destination);
  osc1.start(t);
  osc2.start(t);
  osc1.stop(t + 0.5);
  osc2.stop(t + 0.5);
}
