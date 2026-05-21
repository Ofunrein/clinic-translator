// Owned by Track B3. Wraps `POST /api/tts` and pipes the resulting MP3
// ArrayBuffer into the AudioPlayer via the AudioContext provider.
// Spec §5.2, §7 (TTS failure → fallback voice).
"use client";

import * as React from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/session";
import type { AudioPlayerHandle } from "@/components/AudioPlayer";

export interface TtsRequest {
  text: string;
  voice?: string;
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

async function ttsFetch(req: TtsRequest): Promise<ArrayBuffer> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
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
  raw: UseMutationResult<ArrayBuffer, TtsError, TtsRequest>;
}

export function useTts(
  playerRef: React.RefObject<AudioPlayerHandle | null>,
): UseTtsResult {
  const setStatus = useSessionStore((s) => s.setStatus);

  const mutation = useMutation<ArrayBuffer, TtsError, TtsRequest>({
    mutationKey: ["tts"],
    mutationFn: ttsFetch,
    onError: (err) => {
      setStatus("degraded", `tts: ${err.message}`);
    },
  });

  const speak = React.useCallback(
    async (req: TtsRequest): Promise<void> => {
      setStatus("speaking");
      try {
        const buf = await mutation.mutateAsync(req);
        const player = playerRef.current;
        if (!player) {
          setStatus("degraded", "audio player not mounted");
          return;
        }
        await player.play(buf);
        // Don't unconditionally flip to `ready` — STT may still be listening.
        setStatus("listening");
      } catch (err) {
        // mutation.onError already updated status; rethrow so caller can react.
        throw err;
      }
    },
    [mutation, playerRef, setStatus],
  );

  return {
    speak,
    isSpeaking: mutation.isPending,
    error: mutation.error,
    raw: mutation,
  };
}

export { TtsError };
