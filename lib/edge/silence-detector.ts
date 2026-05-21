// Track C3 — shared silence / dead-air detector built on the same
// AnalyserNode B3 already creates for the waveform. Replaces (eventually
// supersedes) the inline RMS loop in `lib/hooks/useStt.ts` so the same
// thresholds drive multiple UI banners.
//
// Events:
//   * `mic-muted`   — RMS < mutedDb for `mutedWindowMs` (default 8s).
//                      Mirrors B3 behavior. UI: "no audio detected".
//   * `long-silence` — `longSilenceMs` (default 15s) elapsed after the
//                      latest patient final. UI: "Patient still there?".
//   * `caller-quiet` — Rolling-average RMS < callerQuietDb for
//                      `callerQuietWindowMs` (default 10s). UI: "audio low —
//                      ask patient to speak up?" with a one-tap pre-translated
//                      ES prompt to send.
//
// All thresholds are toggleable via the C2 settings hook. The defaults
// below match the values agreed with C2 in the PR seam doc; if `useClinicSettings`
// is missing at import time we fall back to defaults-on.
"use client";

import * as React from "react";
import { useSessionStore } from "@/lib/session";

export const SILENCE_DEFAULTS = {
  mutedDb: -50,
  mutedWindowMs: 8_000,
  longSilenceMs: 15_000,
  callerQuietDb: -40,
  callerQuietWindowMs: 10_000,
} as const;

export interface SilenceDetectorOptions {
  mutedDb?: number;
  mutedWindowMs?: number;
  longSilenceMs?: number;
  callerQuietDb?: number;
  callerQuietWindowMs?: number;
  /** Master toggle — when false, the hook is inert. */
  enabled?: boolean;
}

export interface SilenceDetectorState {
  /** RMS dB this frame (smoothed). Useful for the waveform overlay. */
  rmsDb: number;
  micMuted: boolean;
  longSilence: boolean;
  callerQuiet: boolean;
  /** Average RMS dB over the caller-quiet window. */
  avgRmsDb: number;
}

/**
 * Pre-translated nudge sentence (ES). Hard-coded so it ships even if the
 * translate API is offline. Spec §7: degraded paths must still surface
 * usable patient-facing prompts.
 */
export const CALLER_QUIET_ES_PROMPT =
  "¿Me escucha bien? Por favor, hable un poco más alto.";

export const PATIENT_STILL_THERE_EN_PROMPT =
  "Patient may have stepped away — try a check-in greeting in Spanish.";

const INITIAL_STATE: SilenceDetectorState = {
  rmsDb: -120,
  micMuted: false,
  longSilence: false,
  callerQuiet: false,
  avgRmsDb: -120,
};

/**
 * Hook. Pass the live AnalyserNode from `useStt`. When it's null the hook
 * resets state — matches the lifecycle of the mic graph.
 */
export function useSilenceDetector(
  analyser: AnalyserNode | null,
  opts: SilenceDetectorOptions = {},
): SilenceDetectorState {
  const {
    mutedDb = SILENCE_DEFAULTS.mutedDb,
    mutedWindowMs = SILENCE_DEFAULTS.mutedWindowMs,
    longSilenceMs = SILENCE_DEFAULTS.longSilenceMs,
    callerQuietDb = SILENCE_DEFAULTS.callerQuietDb,
    callerQuietWindowMs = SILENCE_DEFAULTS.callerQuietWindowMs,
    enabled = true,
  } = opts;

  const transcript = useSessionStore((s) => s.transcript);

  // Most-recent patient *final* timestamp drives the long-silence clock.
  const lastPatientFinalTs = React.useMemo<number | null>(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const u = transcript[i];
      if (u.role === "patient" && !u.isPartial) return u.ts;
    }
    return null;
  }, [transcript]);

  const [state, setState] = React.useState<SilenceDetectorState>(INITIAL_STATE);

  const refs = React.useRef<{
    rafId: number | null;
    rmsLowSince: number | null;
    rolling: number[]; // last N RMS dB samples for caller-quiet average
    rollingMaxLen: number;
    lastFinalTs: number | null;
  }>({
    rafId: null,
    rmsLowSince: null,
    rolling: [],
    rollingMaxLen: 0,
    lastFinalTs: null,
  });
  refs.current.lastFinalTs = lastPatientFinalTs;

  React.useEffect(() => {
    if (!enabled || !analyser) {
      setState(INITIAL_STATE);
      return;
    }
    // Sample at ~60Hz; rolling window length is samples-per-second * window.
    const samplesPerSec = 60;
    refs.current.rollingMaxLen = Math.max(
      1,
      Math.floor((callerQuietWindowMs / 1000) * samplesPerSec),
    );
    const tdBuf = new Uint8Array(analyser.fftSize);

    const tick = (): void => {
      const i = refs.current;
      analyser.getByteTimeDomainData(tdBuf);
      let sumSq = 0;
      for (let k = 0; k < tdBuf.length; k++) {
        const v = (tdBuf[k] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / tdBuf.length);
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -120;
      const now = performance.now();

      // mic-muted heuristic — same shape B3 had inline.
      let micMuted = false;
      if (rmsDb < mutedDb) {
        if (i.rmsLowSince === null) i.rmsLowSince = now;
        if (now - i.rmsLowSince > mutedWindowMs) micMuted = true;
      } else {
        i.rmsLowSince = null;
      }

      // Rolling average for caller-quiet.
      i.rolling.push(rmsDb);
      if (i.rolling.length > i.rollingMaxLen) {
        i.rolling.splice(0, i.rolling.length - i.rollingMaxLen);
      }
      let sum = 0;
      for (const v of i.rolling) sum += v;
      const avgRmsDb = i.rolling.length > 0 ? sum / i.rolling.length : -120;
      const callerQuiet =
        i.rolling.length >= i.rollingMaxLen &&
        avgRmsDb < callerQuietDb &&
        // Only flag when not fully muted — caller-quiet means *some* signal.
        avgRmsDb > mutedDb - 10;

      // long-silence: time since last patient final.
      const tsMs = i.lastFinalTs;
      const longSilence =
        tsMs !== null && Date.now() - tsMs > longSilenceMs && !micMuted;

      setState((prev) => {
        if (
          Math.abs(prev.rmsDb - rmsDb) < 0.5 &&
          prev.micMuted === micMuted &&
          prev.longSilence === longSilence &&
          prev.callerQuiet === callerQuiet &&
          Math.abs(prev.avgRmsDb - avgRmsDb) < 0.5
        ) {
          return prev;
        }
        return { rmsDb, micMuted, longSilence, callerQuiet, avgRmsDb };
      });

      i.rafId = requestAnimationFrame(tick);
    };
    refs.current.rafId = requestAnimationFrame(tick);

    return () => {
      const id = refs.current.rafId;
      if (id !== null) cancelAnimationFrame(id);
      refs.current.rafId = null;
      refs.current.rmsLowSince = null;
      refs.current.rolling = [];
    };
  }, [
    analyser,
    enabled,
    mutedDb,
    mutedWindowMs,
    longSilenceMs,
    callerQuietDb,
    callerQuietWindowMs,
  ]);

  return state;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests + non-hook contexts (network monitor etc).
// ---------------------------------------------------------------------------

/** Convert linear-amplitude RMS (0..1) into dBFS. Returns -120 for silence. */
export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return -120;
  return 20 * Math.log10(rms);
}

/** Compute RMS over a Uint8 time-domain buffer (`AnalyserNode` output). */
export function timeDomainRms(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  let sumSq = 0;
  for (let k = 0; k < buf.length; k++) {
    const v = (buf[k] - 128) / 128;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / buf.length);
}
