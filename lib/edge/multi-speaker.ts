// Track C3 — heuristic multi-speaker hint for the patient channel.
//
// Real calls often have a family member translating, a child speaking for
// a parent, or two voices fighting for the phone. Diarization-grade
// accuracy is out of scope (would require WebRTC voice-print). We flag
// "looks like multiple speakers" using cheap signals:
//   1. Pause length pattern — abrupt < 500ms turn-taking is suspicious.
//   2. Pitch shift (estimated via zero-crossing rate of recent audio).
//
// The output is a hint stored on the utterance via `notes_enc` JSON
// (to avoid a schema change — see B1 schema). Format:
//   { speaker: 'a' | 'b', confidence: number }
//
// Confidence is a soft 0..1 — the UI just shows a banner when sustained.

export interface SpeakerHint {
  /** Channel label. We don't know who's who, so we just alternate. */
  speaker: "a" | "b";
  /** [0,1]. */
  confidence: number;
}

export interface MultiSpeakerSnapshot {
  /** Pauses between recent finals, in ms. */
  pauses: number[];
  /** Zero-crossing rate per recent utterance window. */
  zcr: number[];
}

export interface MultiSpeakerVerdict {
  multiSpeaker: boolean;
  /** [0,1] — confidence the call has > 1 speaker. */
  confidence: number;
  reason: string;
  hints: SpeakerHint[];
}

/**
 * Detect a multi-speaker situation from a sliding window of utterance
 * metadata. `pauses` is the inter-utterance gap in ms (always positive);
 * `zcr` is the zero-crossing rate per utterance window — a cheap proxy
 * for pitch. We flag a multi-speaker situation when:
 *   - At least one short pause (<500ms) AND
 *   - ZCR varies > 30% peak-to-peak across recent windows
 *
 * The hint vector alternates 'a'/'b' starting from the assumed primary
 * speaker; the UI uses it to color-code rows. We do NOT claim to know
 * which is which.
 */
export function detectMultiSpeaker(
  snap: MultiSpeakerSnapshot,
): MultiSpeakerVerdict {
  const pauses = snap.pauses;
  const zcr = snap.zcr;
  if (pauses.length < 2 || zcr.length < 2) {
    return {
      multiSpeaker: false,
      confidence: 0,
      reason: "insufficient samples",
      hints: defaultHints(Math.max(pauses.length, zcr.length)),
    };
  }

  let shortPauses = 0;
  for (const p of pauses) if (p < 500) shortPauses += 1;
  const shortPauseFrac = shortPauses / pauses.length;

  const zMin = Math.min(...zcr);
  const zMax = Math.max(...zcr);
  const zSpread = zMax > 0 ? (zMax - zMin) / zMax : 0;

  const score = 0.6 * shortPauseFrac + 0.4 * Math.min(1, zSpread / 0.3);
  const multiSpeaker = score >= 0.45;

  const hints: SpeakerHint[] = [];
  let cur: "a" | "b" = "a";
  for (let i = 0; i < zcr.length; i++) {
    if (i > 0) {
      const prev = zcr[i - 1];
      const ratio = prev > 0 ? Math.abs(zcr[i] - prev) / prev : 0;
      if (ratio > 0.2) cur = cur === "a" ? "b" : "a";
    }
    hints.push({ speaker: cur, confidence: Math.max(0.4, score) });
  }

  return {
    multiSpeaker,
    confidence: score,
    reason: multiSpeaker
      ? `short-pauses=${shortPauseFrac.toFixed(2)} zcr-spread=${zSpread.toFixed(2)}`
      : "below threshold",
    hints,
  };
}

function defaultHints(n: number): SpeakerHint[] {
  return new Array(n).fill(null).map(() => ({ speaker: "a" as const, confidence: 0 }));
}

/**
 * Compute zero-crossing rate of a Float32 mono buffer. Cheap pitch proxy.
 * Returns crossings-per-sample ∈ [0,1].
 */
export function zeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) crossings += 1;
  }
  return crossings / samples.length;
}

/**
 * Build the JSON blob to stuff into `utterance.notes_enc`. Coordinated with
 * B1's schema seam — we DO NOT add a column. Server encrypts via
 * `encryptPHI(JSON.stringify(blob))` before write.
 */
export function buildNotesEncBlob(hint: SpeakerHint): { speaker: "a" | "b"; confidence: number } {
  return { speaker: hint.speaker, confidence: hint.confidence };
}
