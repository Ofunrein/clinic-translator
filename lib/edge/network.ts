// Track C3 — network health monitor.
//
// Tracks:
//   * last 10 fetch round-trip latencies (translate, glossary, sessions)
//   * last 10 STT WebSocket latencies (server → client roundtrip estimate)
//   * last 5 TTS first-byte times
//
// Computes rolling p95 across each. When latency degrades past spec
// thresholds we flip session status to `degraded` with a sanitized reason.
//
// If the user has opted-in (`auto-degrade-on-poor-network: true` from the
// C2 settings), we also auto-toggle to the `fast` latency preset by
// dispatching a custom event the C2 settings store listens to. We do NOT
// import C2's hook to avoid circular deps — see seam below.

import * as React from "react";
import { useSessionStore } from "@/lib/session";

// ---- Constants (spec-aligned thresholds) --------------------------------

const STT_P95_DEGRADE_MS = 1_000;
const TRANSLATE_P95_DEGRADE_MS = 2_000;
const TTS_FIRST_BYTE_DEGRADE_MS = 1_500;
const SUSTAINED_WINDOW_MS = 30_000;

// ---- Sample buffers ----------------------------------------------------

interface RingBuffer {
  values: number[];
  capacity: number;
}

function ringPush(buf: RingBuffer, v: number): void {
  buf.values.push(v);
  if (buf.values.length > buf.capacity) buf.values.shift();
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return sorted[idx];
}

// ---- Module-level monitor (singleton) -----------------------------------

interface MonitorState {
  fetchSamples: RingBuffer;
  sttSamples: RingBuffer;
  ttsSamples: RingBuffer;
  /** When p95 first crossed a degrade threshold. null if currently healthy. */
  degradedSince: number | null;
  /** Set of `*` event handlers — used by `useNetworkHealth`. */
  listeners: Set<() => void>;
}

const state: MonitorState = {
  fetchSamples: { values: [], capacity: 10 },
  sttSamples: { values: [], capacity: 10 },
  ttsSamples: { values: [], capacity: 5 },
  degradedSince: null,
  listeners: new Set(),
};

function emit(): void {
  for (const fn of state.listeners) fn();
}

export function recordFetchLatency(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  ringPush(state.fetchSamples, ms);
  reassess();
  emit();
}

export function recordSttLatency(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  ringPush(state.sttSamples, ms);
  reassess();
  emit();
}

export function recordTtsFirstByte(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  ringPush(state.ttsSamples, ms);
  reassess();
  emit();
}

function reassess(): void {
  const now = Date.now();
  const overSttBudget = p95(state.sttSamples.values) > STT_P95_DEGRADE_MS;
  const overTranslateBudget =
    p95(state.fetchSamples.values) > TRANSLATE_P95_DEGRADE_MS;
  const overTtsBudget = p95(state.ttsSamples.values) > TTS_FIRST_BYTE_DEGRADE_MS;
  const anyDegraded = overSttBudget || overTranslateBudget || overTtsBudget;

  if (anyDegraded) {
    if (state.degradedSince === null) {
      state.degradedSince = now;
    } else if (now - state.degradedSince > SUSTAINED_WINDOW_MS) {
      const reasonParts: string[] = [];
      if (overSttBudget) reasonParts.push(`stt-p95=${Math.round(p95(state.sttSamples.values))}ms`);
      if (overTranslateBudget) reasonParts.push(`translate-p95=${Math.round(p95(state.fetchSamples.values))}ms`);
      if (overTtsBudget) reasonParts.push(`tts-firstbyte-p95=${Math.round(p95(state.ttsSamples.values))}ms`);
      const reason = `network-degraded: ${reasonParts.join(", ")}`;
      const store = useSessionStore.getState();
      if (store.status !== "offline" && store.statusReason !== reason) {
        store.setStatus("degraded", reason);
      }
      // Auto-degrade event for C2 settings. C2 listens; if not present,
      // the event is harmless.
      // TODO C2 settings flag — gated by `auto-degrade-on-poor-network: true`.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("clinic:auto-degrade", {
            detail: { reason, suggested: "fast" },
          }),
        );
      }
    }
  } else {
    state.degradedSince = null;
  }
}

// ---- React hook --------------------------------------------------------

export interface NetworkHealth {
  fetchP95Ms: number;
  sttP95Ms: number;
  ttsP95Ms: number;
  degraded: boolean;
  /** ms — how long degraded for; 0 if healthy. */
  degradedForMs: number;
}

export function useNetworkHealth(): NetworkHealth {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const fn = (): void => force();
    state.listeners.add(fn);
    return () => {
      state.listeners.delete(fn);
    };
  }, []);

  return {
    fetchP95Ms: p95(state.fetchSamples.values),
    sttP95Ms: p95(state.sttSamples.values),
    ttsP95Ms: p95(state.ttsSamples.values),
    degraded: state.degradedSince !== null,
    degradedForMs:
      state.degradedSince === null ? 0 : Math.max(0, Date.now() - state.degradedSince),
  };
}

/**
 * Wrap `fetch` to auto-record latency. Drop-in replacement when callers
 * want network samples without each route having to instrument itself.
 */
export async function instrumentedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const start = performance.now();
  try {
    const res = await fetch(input, init);
    recordFetchLatency(performance.now() - start);
    return res;
  } catch (err) {
    // Failed requests count as "very slow" — but cap the sample so a single
    // network glitch doesn't permanently poison the rolling window.
    recordFetchLatency(Math.min(5_000, performance.now() - start));
    throw err;
  }
}

// Test-only seam.
export const __internals = {
  state,
  reassess,
  STT_P95_DEGRADE_MS,
  TRANSLATE_P95_DEGRADE_MS,
  TTS_FIRST_BYTE_DEGRADE_MS,
  SUSTAINED_WINDOW_MS,
};
