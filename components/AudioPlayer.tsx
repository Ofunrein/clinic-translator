// Owned by Track B3. Wraps `AudioContext` + an `<audio>` sink for `setSinkId`
// support, queues MP3 ArrayBuffers, and exposes `play` / `bargeIn`.
// Spec §6 (barge-in), §7 (autoplay policy banner).
"use client";

import * as React from "react";
import { useAudioContext } from "@/lib/audio-context";
import { useSessionStore } from "@/lib/session";
import { Button } from "@/components/ui/button";

export interface AudioPlayerHandle {
  /** Decode and enqueue an MP3 ArrayBuffer for sequential playback. */
  play: (buffer: ArrayBuffer) => Promise<void>;
  /** Cancel current and queued playback (barge-in). */
  bargeIn: () => void;
  /** Switch the output sink. Falls back silently if `setSinkId` is unsupported. */
  setOutputDevice: (deviceId: string) => Promise<void>;
}

interface AudioElWithSink extends HTMLAudioElement {
  setSinkId: (id: string) => Promise<void>;
}

export const AudioPlayer = React.forwardRef<AudioPlayerHandle>(function AudioPlayer(
  _props,
  ref,
) {
  const audio = useAudioContext();
  const setStatus = useSessionStore((s) => s.setStatus);

  const queueRef = React.useRef<AudioBuffer[]>([]);
  const sourceRef = React.useRef<AudioBufferSourceNode | null>(null);
  const isPlayingRef = React.useRef(false);

  // Hidden <audio> only used so we can route Web Audio output via `setSinkId`
  // by piping a MediaStreamDestination into it. When `setSinkId` is missing
  // we just play through the default device via destination.
  const sinkAudioRef = React.useRef<AudioElWithSink | null>(null);
  const sinkDestRef = React.useRef<MediaStreamAudioDestinationNode | null>(null);

  const playNext = React.useCallback((ctx?: AudioContext) => {
    const ac = ctx ?? audio.audioContext;
    if (!ac) return;
    if (isPlayingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    const src = ac.createBufferSource();
    src.buffer = next;
    if (sinkDestRef.current) {
      src.connect(sinkDestRef.current);
    } else {
      src.connect(ac.destination);
    }
    src.onended = () => {
      isPlayingRef.current = false;
      sourceRef.current = null;
      playNext(ac);
    };
    sourceRef.current = src;
    isPlayingRef.current = true;
    try {
      src.start();
    } catch (err: unknown) {
      isPlayingRef.current = false;
      sourceRef.current = null;
      setStatus("degraded", `audio start failed: ${errMsg(err)}`);
    }
  }, [audio.audioContext, setStatus]);

  const handle = React.useMemo<AudioPlayerHandle>(
    () => ({
      async play(buffer) {
        const ac = audio.ensure();
        if (ac.state === "suspended") {
          // Surface autoplay-blocked state — caller (StaffPane) shows a banner
          // via `useAudioContext().isSuspended`. We do NOT throw — buffer is
          // queued and will play once the user gesture resumes the context.
        }
        let decoded: AudioBuffer;
        try {
          // `decodeAudioData` of a copy — some browsers detach the original.
          decoded = await ac.decodeAudioData(buffer.slice(0));
        } catch (err: unknown) {
          setStatus("degraded", `decode failed: ${errMsg(err)}`);
          throw err;
        }
        queueRef.current.push(decoded);
        playNext(ac);
      },
      bargeIn() {
        queueRef.current = [];
        const cur = sourceRef.current;
        sourceRef.current = null;
        isPlayingRef.current = false;
        if (cur) {
          try {
            cur.stop();
          } catch {
            // already stopped
          }
        }
      },
      async setOutputDevice(deviceId) {
        audio.setOutputDeviceId(deviceId);
        const sink = sinkAudioRef.current;
        if (!sink || typeof sink.setSinkId !== "function") {
          // Browser doesn't support output-device routing — silent fallback.
          return;
        }
        try {
          await sink.setSinkId(deviceId);
        } catch (err: unknown) {
          setStatus("degraded", `output device switch failed: ${errMsg(err)}`);
        }
      },
    }),
    [audio, playNext, setStatus],
  );

  React.useImperativeHandle(ref, () => handle, [handle]);

  // Wire the <audio> sink once the AudioContext exists.
  React.useEffect(() => {
    const ac = audio.audioContext;
    const sink = sinkAudioRef.current;
    if (!ac || !sink) return;
    if (sinkDestRef.current) return;
    try {
      const dest = ac.createMediaStreamDestination();
      sinkDestRef.current = dest;
      sink.srcObject = dest.stream;
      void sink.play().catch(() => {
        // The hidden element will resume once the user clicks the
        // "click to enable audio" banner — non-fatal.
      });
    } catch (err: unknown) {
      setStatus("degraded", `audio sink wiring failed: ${errMsg(err)}`);
    }
  }, [audio.audioContext, setStatus]);

  return (
    <>
      {/* Off-screen sink — required for `setSinkId` on Web Audio output. */}
      <audio
        ref={sinkAudioRef as React.RefObject<HTMLAudioElement>}
        aria-hidden="true"
        className="hidden"
        // `playsInline` plus muted=false is required for output routing.
        playsInline
      />
      {audio.isSuspended ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <span>Click to enable audio playback.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void audio.resume();
            }}
          >
            Enable audio
          </Button>
        </div>
      ) : null}
    </>
  );
});

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}
