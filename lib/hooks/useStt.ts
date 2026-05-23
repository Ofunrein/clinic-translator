// Owned by Track B3.
// Owns the mic capture pipeline + WebSocket to `/api/stt`.
// Spec §4.2 / §5.1: 16kHz mono PCM, 100ms chunks, partials/finals.
// Reconnect with exponential backoff on drop (250ms→4s, 5x).
// Falls back to `MediaRecorder` when `AudioWorklet` is unavailable.
"use client";

import * as React from "react";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { useSessionStore } from "@/lib/session";

export interface UseSttOptions {
  /** WebSocket URL relative to the current origin (`ws://` is derived). */
  url?: string;
  /** Override the mic device id. */
  deviceId?: string;
  /** RMS threshold in dB below which we consider the mic muted. */
  mutedDb?: number;
  /** Window in ms over which the mic must stay below threshold. */
  mutedWindowMs?: number;
}

export interface UseSttResult {
  start: () => Promise<void>;
  stop: () => void;
  isStreaming: boolean;
  error: string | null;
  /** Exposed so PatientPane can drive the waveform off the live mic graph. */
  analyser: AnalyserNode | null;
  /** True once the muted heuristic fires. */
  micMuted: boolean;
  /** True if `getUserMedia` rejected with a permission error. */
  permissionDenied: boolean;
}

const TARGET_SR = 16000;
const CHUNK_MS = 100;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000];

export function useStt(opts: UseSttOptions = {}): UseSttResult {
  const {
    deviceId,
    mutedDb = -50,
    mutedWindowMs = 8000,
  } = opts;

  const addPartial = useSessionStore((s) => s.addPartial);
  const promotePartial = useSessionStore((s) => s.promotePartialToFinal);
  const setTranslation = useSessionStore((s) => s.setTranslation);
  const reconcileUtteranceId = useSessionStore((s) => s.reconcileUtteranceId);
  const sessionId = useSessionStore((s) => s.sessionId);
  const setStatus = useSessionStore((s) => s.setStatus);

  const [isStreaming, setIsStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = React.useState(false);
  const [micMuted, setMicMuted] = React.useState(false);
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null);

  // All long-lived refs go in one ref so cleanup is total.
  const internals = React.useRef<{
    ws: WebSocket | null;
    dgConnection: ReturnType<ReturnType<typeof createClient>["listen"]["live"]> | null;
    stream: MediaStream | null;
    audioCtx: AudioContext | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    workletNode: AudioWorkletNode | null;
    analyserNode: AnalyserNode | null;
    recorder: MediaRecorder | null;
    backoffIdx: number;
    rmsLowSince: number | null;
    rafId: number | null;
    teardown: () => void;
    closing: boolean;
  }>({
    ws: null,
    dgConnection: null,
    stream: null,
    audioCtx: null,
    sourceNode: null,
    workletNode: null,
    analyserNode: null,
    recorder: null,
    backoffIdx: 0,
    rmsLowSince: null,
    rafId: null,
    teardown: () => {},
    closing: false,
  });

  const stop = React.useCallback(() => {
    const i = internals.current;
    i.closing = true;
    i.teardown();
    i.closing = false;
    setIsStreaming(false);
    setStatus("ready");
  }, [setStatus]);

  const connectDg = React.useCallback(
    async (sendRef: { current: ((chunk: ArrayBuffer) => void) | null }): Promise<ReturnType<ReturnType<typeof createClient>["listen"]["live"]>> => {
      // Fetch short-lived key from our authenticated endpoint.
      let key = "";
      try {
        const res = await fetch("/api/stt/token");
        if (res.ok) {
          const json = (await res.json()) as { key?: string };
          key = json.key ?? "";
        }
      } catch {
        // Fall through — Deepgram will reject with an auth error and we'll surface it.
      }

      const deepgram = createClient(key);
      const connection = deepgram.listen.live({
        language: "es",
        model: "nova-3",
        interim_results: true,
        endpointing: 500,
        smart_format: true,
        encoding: "linear16",
        sample_rate: 16000,
      });

      connection.on(LiveTranscriptionEvents.Open, () => {
        internals.current.backoffIdx = 0;
        setError(null);
        setStatus("listening");
        // Wire audio now that the connection is open.
        sendRef.current = (chunk: ArrayBuffer) => {
          connection.send(chunk);
        };
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data: unknown) => {
        try {
          const d = data as {
            channel: { alternatives: Array<{ transcript: string }> };
            is_final: boolean;
            speech_final: boolean;
          };
          const text = d.channel.alternatives[0]?.transcript ?? "";
          if (!text.trim()) return;
          if (d.speech_final) {
            promotePartial(text, "");
            // Async translate ES→EN, then backfill the utterance.
            const latestPatient = useSessionStore
              .getState()
              .transcript.filter((u) => u.role === "patient" && !u.isPartial)
              .at(-1);
            const uttId = latestPatient?.id;
            if (uttId) {
              fetch("/api/translate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  text,
                  src: "es",
                  dst: "en",
                  ...(sessionId ? { sessionId } : {}),
                }),
              })
                .then((r) => (r.ok ? r.json() : null))
                .then(
                  (data: { translation?: string; utterance_id?: string } | null) => {
                    if (!data?.translation) return;
                    const serverId = data.utterance_id;
                    if (serverId && serverId !== uttId) {
                      reconcileUtteranceId(uttId, serverId);
                      setTranslation(serverId, data.translation);
                    } else {
                      setTranslation(uttId, data.translation);
                    }
                  },
                )
                .catch(() => {});
            }
          } else if (!d.is_final) {
            addPartial(text);
          }
        } catch {
          // Malformed frame — ignore.
        }
      });

      connection.on(LiveTranscriptionEvents.Error, () => {
        setError("STT connection error");
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        sendRef.current = null;
        if (internals.current.closing) return;
        // Backoff reconnect.
        const delay = BACKOFF_MS[Math.min(internals.current.backoffIdx, BACKOFF_MS.length - 1)];
        internals.current.backoffIdx += 1;
        if (internals.current.backoffIdx > BACKOFF_MS.length) {
          setStatus("offline", "STT reconnect exhausted");
          return;
        }
        setStatus("degraded", `STT reconnecting in ${delay}ms`);
        window.setTimeout(() => {
          if (internals.current.closing) return;
          void connectDg(sendRef).then((next) => {
            internals.current.dgConnection = next;
          });
        }, delay);
      });

      return connection;
    },
    [addPartial, promotePartial, reconcileUtteranceId, sessionId, setStatus, setTranslation],
  );

  const start = React.useCallback(async (): Promise<void> => {
    setError(null);
    setPermissionDenied(false);
    setMicMuted(false);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setPermissionDenied(true);
        setError("Microphone permission denied");
        setStatus("degraded", "mic permission denied");
      } else {
        setError(`Mic capture failed: ${errMsg(err)}`);
        setStatus("offline", `mic capture failed: ${errMsg(err)}`);
      }
      return;
    }

    const i = internals.current;
    i.stream = stream;

    // Build the audio graph.
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      setStatus("offline", "AudioContext unsupported");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    // Some browsers (Safari) ignore the requested `sampleRate`; we resample
    // in the worklet anyway, so any rate the browser hands us is fine.
    let audioCtx: AudioContext;
    try {
      audioCtx = new AC({ sampleRate: TARGET_SR });
    } catch {
      audioCtx = new AC();
    }
    i.audioCtx = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    i.sourceNode = source;
    const an = audioCtx.createAnalyser();
    an.fftSize = 1024;
    source.connect(an);
    i.analyserNode = an;
    setAnalyser(an);

    // RMS / muted-mic monitor via the analyser. Cheaper than a worklet.
    const tdBuf = new Uint8Array(an.fftSize);
    const tickRms = (): void => {
      an.getByteTimeDomainData(tdBuf);
      let sumSq = 0;
      for (let k = 0; k < tdBuf.length; k++) {
        const v = (tdBuf[k] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / tdBuf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -120;
      const now = performance.now();
      if (db < mutedDb) {
        if (i.rmsLowSince === null) i.rmsLowSince = now;
        if (now - i.rmsLowSince > mutedWindowMs) setMicMuted(true);
      } else {
        i.rmsLowSince = null;
        setMicMuted(false);
      }
      i.rafId = requestAnimationFrame(tickRms);
    };
    i.rafId = requestAnimationFrame(tickRms);

    // Build encoder: prefer AudioWorklet, fall back to MediaRecorder.
    // sendRef is populated once the Deepgram connection opens.
    const sendRef: { current: ((chunk: ArrayBuffer) => void) | null } = { current: null };
    const sendChunk = (chunk: ArrayBuffer): void => {
      if (sendRef.current) sendRef.current(chunk);
      // Else: drop. The reconnect loop will pick up the next chunks.
    };

    let usedWorklet = false;
    if (typeof audioCtx.audioWorklet?.addModule === "function") {
      try {
        await audioCtx.audioWorklet.addModule(workletModuleUrl());
        const node = new AudioWorkletNode(audioCtx, "stt-pcm-encoder", {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          processorOptions: { targetSr: TARGET_SR, chunkMs: CHUNK_MS },
        });
        node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
          sendChunk(ev.data);
        };
        source.connect(node);
        i.workletNode = node;
        usedWorklet = true;
      } catch (err: unknown) {
        // Fall through to MediaRecorder.
        setStatus("degraded", `worklet load failed: ${errMsg(err)}`);
      }
    }

    if (!usedWorklet) {
      // MediaRecorder fallback — server must accept opus/webm.
      try {
        const mime =
          MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm";
        const rec = new MediaRecorder(stream, { mimeType: mime });
        rec.ondataavailable = async (e) => {
          if (e.data.size > 0) {
            const buf = await e.data.arrayBuffer();
            sendChunk(buf);
          }
        };
        rec.start(CHUNK_MS);
        i.recorder = rec;
      } catch (err: unknown) {
        setError(`Recorder init failed: ${errMsg(err)}`);
        setStatus("offline", `recorder init failed: ${errMsg(err)}`);
        return;
      }
    }

    i.dgConnection = await connectDg(sendRef);
    setIsStreaming(true);

    i.teardown = (): void => {
      if (i.rafId !== null) {
        cancelAnimationFrame(i.rafId);
        i.rafId = null;
      }
      if (i.recorder && i.recorder.state !== "inactive") {
        try {
          i.recorder.stop();
        } catch { /* noop */ }
      }
      i.recorder = null;
      if (i.workletNode) {
        try {
          i.workletNode.port.onmessage = null;
          i.workletNode.disconnect();
        } catch { /* noop */ }
      }
      i.workletNode = null;
      if (i.sourceNode) {
        try { i.sourceNode.disconnect(); } catch { /* noop */ }
      }
      i.sourceNode = null;
      if (i.analyserNode) {
        try { i.analyserNode.disconnect(); } catch { /* noop */ }
      }
      i.analyserNode = null;
      setAnalyser(null);
      if (i.audioCtx && i.audioCtx.state !== "closed") {
        void i.audioCtx.close().catch(() => {});
      }
      i.audioCtx = null;
      if (i.stream) {
        i.stream.getTracks().forEach((t) => t.stop());
      }
      i.stream = null;
      if (i.dgConnection) {
        try { i.dgConnection.requestClose(); } catch { /* noop */ }
      }
      i.dgConnection = null;
      i.ws = null;
    };
  }, [connectDg, deviceId, mutedDb, mutedWindowMs, setStatus]);

  React.useEffect(() => {
    return () => {
      // Component unmount cleanup.
      const i = internals.current;
      i.closing = true;
      i.teardown();
    };
  }, []);

  return {
    start,
    stop,
    isStreaming,
    error,
    analyser,
    micMuted,
    permissionDenied,
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

/**
 * AudioWorklet processor sourced as a Blob so we don't need a separate
 * `public/` file. Track B4 may move this to `public/worklets/stt-pcm.js`
 * for SRI / CSP-strict deployments.
 */
function workletModuleUrl(): string {
  const code = `
class SttPcmEncoder extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.targetSr = o.targetSr || 16000;
    this.chunkSamples = Math.floor(this.targetSr * (o.chunkMs || 100) / 1000);
    this.buffer = new Int16Array(this.chunkSamples);
    this.bufIdx = 0;
    this.ratio = sampleRate / this.targetSr;
    this.acc = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let i = 0;
    while (i < input.length) {
      // Naive linear-resample to 16kHz mono.
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = Math.max(-1, Math.min(1, input[i]));
        this.buffer[this.bufIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.bufIdx >= this.chunkSamples) {
          this.port.postMessage(this.buffer.slice().buffer, [this.buffer.slice().buffer]);
          this.bufIdx = 0;
        }
      }
      i++;
    }
    return true;
  }
}
registerProcessor('stt-pcm-encoder', SttPcmEncoder);
`;
  const blob = new Blob([code], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}
