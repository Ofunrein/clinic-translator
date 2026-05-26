// Owned by Track B3. Wraps `POST /api/tts` and pipes the resulting MP3
// ArrayBuffer into the AudioPlayer via the AudioContext provider.
// Spec §5.2, §7 (TTS failure → fallback voice).
"use client";

import * as React from "react";
import { useSessionStore } from "@/lib/session";
import type { AudioPlayerHandle } from "@/components/AudioPlayer";

export interface TtsRequest {
  text: string;
  voice?: string;
  speed?: number;
  sessionId?: string;
}

interface ApiError {
  code: string;
  message: string;
  retryable?: boolean;
  traceId?: string;
}

class TtsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function ttsFetch(req: TtsRequest, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = null;
    }
    throw new TtsError(
      body?.code ?? `http_${res.status}`,
      body?.message ?? `tts failed: ${res.status}`,
      res.status,
    );
  }
  return await res.arrayBuffer();
}

export interface UseTtsResult {
  /** Synthesize and immediately enqueue playback through the supplied player. */
  speak: (req: TtsRequest) => Promise<void>;
  isSpeaking: boolean;
  error: TtsError | null;
}

export function useTts(
  playerRef: React.RefObject<AudioPlayerHandle | null>,
): UseTtsResult {
  const setStatus = useSessionStore((s) => s.setStatus);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const [error, setError] = React.useState<TtsError | null>(null);

  // One AbortController per in-flight fetch — cancelled when a new speak starts.
  const abortRef = React.useRef<AbortController | null>(null);

  const speak = React.useCallback(
    async (req: TtsRequest): Promise<void> => {
      // Cancel any in-flight fetch from a previous speak call.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setStatus("speaking");
      setIsSpeaking(true);
      setError(null);
      try {
        const buf = await ttsFetch(req, ac.signal);

        // Bail out silently if a newer speak call already aborted us.
        if (ac.signal.aborted) return;

        const player = playerRef.current;
        if (!player) {
          setStatus("degraded", "audio player not mounted");
          return;
        }
        await player.play(buf);
        setStatus("listening");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const ttsErr =
          err instanceof TtsError
            ? err
            : new TtsError("tts_failed", String(err), 0);
        setError(ttsErr);
        setStatus("degraded", `tts: ${ttsErr.message}`);
        throw ttsErr;
      } finally {
        if (!ac.signal.aborted) setIsSpeaking(false);
      }
    },
    [playerRef, setStatus],
  );

  return { speak, isSpeaking, error };
}

export { TtsError };
