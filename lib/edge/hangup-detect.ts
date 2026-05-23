// Track C3 — auto-detect hangup without explicit "End Call".
//
// Rule: 60s of total silence + no audio in/out → soft prompt
//   "Did the call end?" with default-yes after another 30s.
// On confirm, auto-saves session via the existing `/api/sessions/[id]/end`
// endpoint and clears the UI store.
//
// Prevents orphan sessions when the friend forgets to click "End Call"
// or the patient just hangs up.
"use client";

import * as React from "react";
import { useSessionStore } from "@/lib/session";

export interface HangupDetectorOptions {
  /** Total silence (no patient audio + no staff TTS) before soft prompt. */
  silenceMs?: number;
  /** Wait after prompt before auto-confirm yes. */
  autoConfirmMs?: number;
  /** Master toggle. */
  enabled?: boolean;
}

export const HANGUP_DEFAULTS = {
  silenceMs: 300_000,   // 5 min silence before prompt
  autoConfirmMs: 300_000, // 5 more min before auto-end
} as const;

export interface HangupDetectorState {
  /** True once the silence threshold trips. */
  prompting: boolean;
  /** True once auto-confirm fires (or user clicks Yes). */
  ended: boolean;
  /** ms remaining until auto-confirm. 0 when not prompting. */
  remainingMs: number;
}

export interface HangupDetectorHandle extends HangupDetectorState {
  /** Friend clicks "yes — call ended". */
  confirm: () => void;
  /** Friend clicks "no — keep going". Resets the silence clock. */
  dismiss: () => void;
  /** Caller pings this whenever audio activity occurs (mic input, TTS playback). */
  bumpActivity: () => void;
}

/**
 * Hook. The caller (PatientPane) is responsible for calling `bumpActivity`
 * on each:
 *   * STT partial / final
 *   * mic RMS-above-threshold tick
 *   * TTS speak start
 * The hook starts the timer when `bumpActivity` hasn't been called for
 * `silenceMs`.
 */
export function useHangupDetector(
  opts: HangupDetectorOptions = {},
): HangupDetectorHandle {
  const {
    silenceMs = HANGUP_DEFAULTS.silenceMs,
    autoConfirmMs = HANGUP_DEFAULTS.autoConfirmMs,
    enabled = true,
  } = opts;

  const sessionId = useSessionStore((s) => s.sessionId);
  const reset = useSessionStore((s) => s.reset);

  const [state, setState] = React.useState<HangupDetectorState>({
    prompting: false,
    ended: false,
    remainingMs: 0,
  });

  const refs = React.useRef<{
    lastActivity: number;
    promptStart: number | null;
    rafId: number | null;
  }>({
    lastActivity: Date.now(),
    promptStart: null,
    rafId: null,
  });

  const tick = React.useCallback((): void => {
    if (!enabled) return;
    const now = Date.now();
    const i = refs.current;
    const sinceActivity = now - i.lastActivity;

    if (i.promptStart !== null) {
      const remaining = autoConfirmMs - (now - i.promptStart);
      if (remaining <= 0) {
        // Auto-confirm.
        confirmEnd();
        return;
      }
      setState((prev) =>
        prev.prompting && Math.abs(prev.remainingMs - remaining) > 250
          ? { ...prev, remainingMs: remaining }
          : prev,
      );
    } else if (sinceActivity > silenceMs) {
      i.promptStart = now;
      setState({ prompting: true, ended: false, remainingMs: autoConfirmMs });
    }

    i.rafId = requestAnimationFrame(tick);
  }, [autoConfirmMs, enabled, silenceMs]);

  const confirmEnd = React.useCallback((): void => {
    setState({ prompting: false, ended: true, remainingMs: 0 });
    refs.current.promptStart = null;
    if (sessionId && typeof window !== "undefined") {
      void fetch(`/api/sessions/${sessionId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "completed", auto: true }),
      })
        .catch(() => {
          // Non-fatal — friend can retry End Call manually.
        })
        .finally(() => {
          reset();
        });
    } else {
      reset();
    }
  }, [reset, sessionId]);

  React.useEffect(() => {
    if (!enabled) return;
    refs.current.rafId = requestAnimationFrame(tick);
    return () => {
      const id = refs.current.rafId;
      if (id !== null) cancelAnimationFrame(id);
      refs.current.rafId = null;
    };
  }, [enabled, tick]);

  const bumpActivity = React.useCallback((): void => {
    refs.current.lastActivity = Date.now();
    refs.current.promptStart = null;
    setState((prev) =>
      prev.prompting || prev.remainingMs > 0
        ? { prompting: false, ended: prev.ended, remainingMs: 0 }
        : prev,
    );
  }, []);

  const dismiss = React.useCallback((): void => {
    refs.current.lastActivity = Date.now();
    refs.current.promptStart = null;
    setState({ prompting: false, ended: false, remainingMs: 0 });
  }, []);

  return {
    ...state,
    confirm: confirmEnd,
    dismiss,
    bumpActivity,
  };
}
