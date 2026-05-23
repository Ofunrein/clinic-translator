// Track C1. Custom hook driving the AI reply suggestion stream.
//
// On each new patient `final` utterance, fires SSE to /api/suggest. Streams
// tokens into the Zustand `suggestion` state. Cancels any in-flight stream
// when a fresher patient utterance arrives. Exposes accept/dismiss/edit
// actions that POST /api/suggest/outcome.
"use client";

import * as React from "react";
import { useSessionStore } from "@/lib/session";

export type SuggestOutcome = "accepted" | "edited" | "dismissed";

export interface UseSuggestResult {
  suggestion: string;
  confidence: number;
  escalate: boolean;
  isStreaming: boolean;
  /** True until at least one final has arrived for the current utterance. */
  utteranceId: string | null;
  dismiss: () => Promise<void>;
  accept: () => Promise<void>;
  recordEdit: () => Promise<void>;
}

interface FinalShape {
  suggestion: string;
  confidence: number;
  escalate: boolean;
  reasoning?: string;
}

interface SuggestSseFrame {
  token?: string;
  final?: FinalShape;
  done?: boolean;
  // error envelope mirrors errors.ts
  code?: string;
  message?: string;
  retryable?: boolean;
  trace_id?: string;
}

function findLastPatientFinal(
  transcript: ReadonlyArray<{
    id: string;
    role: "patient" | "staff";
    isPartial?: boolean;
    translation?: string;
  }>,
): string | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const u = transcript[i];
    // Wait until ES→EN translate finishes and the utterance is persisted
    // (id reconciled to the server row) before requesting a suggestion.
    if (!u.isPartial && u.role === "patient" && u.translation) return u.id;
  }
  return null;
}

async function postOutcome(
  utteranceId: string,
  outcome: SuggestOutcome,
): Promise<void> {
  try {
    await fetch("/api/suggest/outcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utteranceId, outcome }),
    });
  } catch {
    // Outcome reporting is advisory; never throw to the UI.
  }
}

export function useSuggest(opts: { enabled?: boolean } = {}): UseSuggestResult {
  const enabled = opts.enabled ?? true;
  const sessionId = useSessionStore((s) => s.sessionId);
  const transcript = useSessionStore((s) => s.transcript);
  const suggestion = useSessionStore((s) => s.suggestion);
  const setSuggestion = useSessionStore((s) => s.setSuggestion);
  const clearSuggestion = useSessionStore((s) => s.clearSuggestion);

  const lastPatientId = React.useMemo(
    () => findLastPatientFinal(transcript),
    [transcript],
  );

  // Track the abort controller for the in-flight stream so we can cancel.
  const abortRef = React.useRef<AbortController | null>(null);
  const lastDispatchedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    if (!sessionId || !lastPatientId) return;
    // Don't re-stream a suggestion we already have for this utterance.
    if (lastDispatchedRef.current === lastPatientId) return;

    // Cancel any prior in-flight stream + reset draft.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    lastDispatchedRef.current = lastPatientId;

    setSuggestion({
      text: "",
      confidence: 0,
      escalate: false,
      isStreaming: true,
      utteranceId: lastPatientId,
    });

    void streamSuggest({
      sessionId,
      utteranceId: lastPatientId,
      signal: ac.signal,
      onToken: (tok) => {
        // Append tokens to the live draft. We don't trust per-token JSON —
        // the server emits a `final` envelope with the canonical text.
        const cur = useSessionStore.getState().suggestion;
        if (cur.utteranceId !== lastPatientId) return;
        setSuggestion({ text: cur.text + tok });
      },
      onFinal: (f) => {
        const cur = useSessionStore.getState().suggestion;
        if (cur.utteranceId !== lastPatientId) return;
        setSuggestion({
          text: f.suggestion,
          confidence: f.confidence,
          escalate: f.escalate,
          isStreaming: false,
          utteranceId: lastPatientId,
        });
      },
      onError: () => {
        const cur = useSessionStore.getState().suggestion;
        if (cur.utteranceId !== lastPatientId) return;
        setSuggestion({ isStreaming: false });
      },
    }).catch(() => {
      // streamSuggest already routed errors through onError; nothing else
      // to do — never surface PHI / stack traces to the console.
    });

    return () => {
      ac.abort();
    };
  }, [enabled, sessionId, lastPatientId, setSuggestion]);

  const accept = React.useCallback(async (): Promise<void> => {
    const id = useSessionStore.getState().suggestion.utteranceId;
    if (id) await postOutcome(id, "accepted");
    clearSuggestion();
  }, [clearSuggestion]);

  const dismiss = React.useCallback(async (): Promise<void> => {
    const id = useSessionStore.getState().suggestion.utteranceId;
    abortRef.current?.abort();
    if (id) await postOutcome(id, "dismissed");
    clearSuggestion();
  }, [clearSuggestion]);

  const recordEdit = React.useCallback(async (): Promise<void> => {
    const id = useSessionStore.getState().suggestion.utteranceId;
    if (id) await postOutcome(id, "edited");
    clearSuggestion();
  }, [clearSuggestion]);

  return {
    suggestion: suggestion.text,
    confidence: suggestion.confidence,
    escalate: suggestion.escalate,
    isStreaming: suggestion.isStreaming,
    utteranceId: suggestion.utteranceId,
    dismiss,
    accept,
    recordEdit,
  };
}

interface StreamArgs {
  sessionId: string;
  utteranceId: string;
  signal: AbortSignal;
  onToken: (t: string) => void;
  onFinal: (f: FinalShape) => void;
  onError: () => void;
}

async function streamSuggest(args: StreamArgs): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: args.sessionId,
        lastUtteranceId: args.utteranceId,
      }),
      signal: args.signal,
    });
  } catch {
    args.onError();
    return;
  }
  if (!res.ok || !res.body) {
    args.onError();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (!args.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Split on the SSE frame boundary (\n\n).
      let idx = buf.indexOf("\n\n");
      while (idx !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseSseFrame(frame);
        if (parsed) {
          if (parsed.token) args.onToken(parsed.token);
          else if (parsed.final) args.onFinal(parsed.final);
        }
        idx = buf.indexOf("\n\n");
      }
    }
  } catch {
    args.onError();
  }
}

function parseSseFrame(frame: string): SuggestSseFrame | null {
  // Each frame is one or more lines like `event: x` and `data: {...}`.
  let dataLine: string | null = null;
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      dataLine = line.slice(5).trim();
    }
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as SuggestSseFrame;
  } catch {
    return null;
  }
}
