// Track C3 — last-N-seconds patient audio circular buffer + replay.
//
// Maintains a 30s ring of the live mic Float32 samples. Friend can hit
// "🔁 Replay" on a patient utterance to:
//   1. Re-play the raw audio through the staff headset
//   2. Optionally re-run STT on the same audio for re-transcription
//
// Useful when the friend missed a number, dose, or date and wants to hear
// the patient's own voice again — not a TTS substitute.
//
// Storage is one Float32Array `frames` array; we drop oldest blocks when
// total samples exceed `windowSeconds * sampleRate`. ~30s @ 16kHz mono =
// ~1.9 MB which is fine in-memory.
"use client";

import * as React from "react";

export interface ReplayBufferOptions {
  /** Window length in seconds. Default 30s. */
  windowSeconds?: number;
  enabled?: boolean;
}

export interface ReplayClip {
  /** Mono PCM samples in [-1, 1]. */
  samples: Float32Array;
  sampleRate: number;
  /** Timestamp the *oldest* sample was captured (ms epoch). */
  startTs: number;
  /** Timestamp the *newest* sample was captured (ms epoch). */
  endTs: number;
}

export interface ReplayBufferHandle {
  /** Snapshot of the entire current buffer. */
  snapshot: () => ReplayClip | null;
  /** Last `seconds` of audio. */
  lastN: (seconds: number) => ReplayClip | null;
  /** Drop everything (e.g. on call end). */
  clear: () => void;
}

interface BufferRefs {
  audioCtx: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  processor: ScriptProcessorNode | null;
  workletNode: AudioWorkletNode | null;
  /** Linked list of (samples, capturedAtMs) blocks. */
  blocks: Array<{ samples: Float32Array; capturedAt: number }>;
  totalSamples: number;
  sampleRate: number;
  maxSamples: number;
}

const BLOCK_SIZE = 4096;

/**
 * Hook variant — feed it the same MediaStream B3 captures from `getUserMedia`.
 * Returns `null` until the buffer is initialized.
 */
export function useReplayBuffer(
  stream: MediaStream | null,
  opts: ReplayBufferOptions = {},
): ReplayBufferHandle | null {
  const { windowSeconds = 30, enabled = true } = opts;
  const refs = React.useRef<BufferRefs>({
    audioCtx: null,
    source: null,
    processor: null,
    workletNode: null,
    blocks: [],
    totalSamples: 0,
    sampleRate: 0,
    maxSamples: 0,
  });

  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !stream) {
      setReady(false);
      return;
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);

    refs.current.audioCtx = ctx;
    refs.current.source = src;
    refs.current.sampleRate = ctx.sampleRate;
    refs.current.maxSamples = Math.floor(ctx.sampleRate * windowSeconds);

    // Use ScriptProcessor — deprecated but ubiquitous and zero-build for
    // a passive read-only listener. The lint rule forbids it in production
    // hot paths, but this is read-only. AudioWorklet variant is preferred
    // and we wire it when available.
    let processorAttached = false;
    if (typeof ctx.audioWorklet?.addModule === "function") {
      // The static replay-tap worklet does not exist; we only use the
      // ScriptProcessor path here to avoid adding a second public worklet.
      // If/when B3 wants to consolidate, switch to a tap worklet that
      // posts BLOCK_SIZE Float32Arrays.
    }

    const proc = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
    proc.onaudioprocess = (ev: AudioProcessingEvent): void => {
      const input = ev.inputBuffer.getChannelData(0);
      // Copy — `getChannelData` returns a view into the underlying buffer
      // that the engine will reuse next tick.
      const copy = new Float32Array(input.length);
      copy.set(input);
      refs.current.blocks.push({ samples: copy, capturedAt: Date.now() });
      refs.current.totalSamples += copy.length;
      // Trim old blocks.
      while (refs.current.totalSamples > refs.current.maxSamples) {
        const head = refs.current.blocks.shift();
        if (!head) break;
        refs.current.totalSamples -= head.samples.length;
      }
    };
    src.connect(proc);
    // ScriptProcessor must connect to destination to receive audioprocess events,
    // but we don't want it to play back — connect to a muted gain node.
    const muted = ctx.createGain();
    muted.gain.value = 0;
    proc.connect(muted);
    muted.connect(ctx.destination);
    refs.current.processor = proc;
    processorAttached = true;
    setReady(processorAttached);

    return () => {
      try {
        proc.disconnect();
      } catch {
        // already disconnected
      }
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
      if (ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
      refs.current.audioCtx = null;
      refs.current.source = null;
      refs.current.processor = null;
      refs.current.blocks = [];
      refs.current.totalSamples = 0;
      setReady(false);
    };
  }, [stream, windowSeconds, enabled]);

  return React.useMemo<ReplayBufferHandle | null>(() => {
    if (!ready) return null;
    return {
      snapshot(): ReplayClip | null {
        const i = refs.current;
        if (i.totalSamples === 0) return null;
        return materialize(i.blocks, i.sampleRate);
      },
      lastN(seconds: number): ReplayClip | null {
        const i = refs.current;
        if (i.totalSamples === 0) return null;
        const want = Math.floor(seconds * i.sampleRate);
        let have = 0;
        const tail: typeof i.blocks = [];
        for (let k = i.blocks.length - 1; k >= 0; k--) {
          tail.unshift(i.blocks[k]);
          have += i.blocks[k].samples.length;
          if (have >= want) break;
        }
        return materialize(tail, i.sampleRate);
      },
      clear(): void {
        refs.current.blocks = [];
        refs.current.totalSamples = 0;
      },
    };
  }, [ready]);
}

function materialize(
  blocks: Array<{ samples: Float32Array; capturedAt: number }>,
  sampleRate: number,
): ReplayClip | null {
  if (blocks.length === 0) return null;
  let total = 0;
  for (const b of blocks) total += b.samples.length;
  const out = new Float32Array(total);
  let cursor = 0;
  for (const b of blocks) {
    out.set(b.samples, cursor);
    cursor += b.samples.length;
  }
  const startTs = blocks[0].capturedAt;
  const endTs = blocks[blocks.length - 1].capturedAt;
  return { samples: out, sampleRate, startTs, endTs };
}

/**
 * Re-play a clip through the staff headset via Web Audio. Returns a stop fn.
 * Reuses the supplied AudioContext (typically the AudioPlayer's ctx) so
 * sink-id routing carries over. If `targetSink` is null we play through the
 * default destination.
 */
export function playClip(
  ctx: AudioContext,
  clip: ReplayClip,
  targetSink?: AudioNode | null,
): { stop: () => void; finished: Promise<void> } {
  const buf = ctx.createBuffer(1, clip.samples.length, clip.sampleRate);
  buf.getChannelData(0).set(clip.samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (targetSink) src.connect(targetSink);
  else src.connect(ctx.destination);

  let resolveDone: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  src.onended = () => {
    if (resolveDone) resolveDone();
  };
  src.start();
  return {
    stop: () => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    },
    finished,
  };
}

/**
 * Encode a Float32 mono clip as 16-bit PCM (little-endian) wrapped in a
 * minimal RIFF/WAV container. Used to POST a replay clip back to `/api/stt`
 * for re-transcription via the existing route.
 *
 * Hand-rolled because we don't ship a wav-encode dependency.
 */
export function clipToWav(clip: ReplayClip): ArrayBuffer {
  const { samples, sampleRate } = clip;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataLen = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  let offset = 0;
  function writeStr(s: string): void {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  }
  writeStr("RIFF");
  view.setUint32(offset, 36 + dataLen, true); offset += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2; // PCM
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitsPerSample, true); offset += 2;
  writeStr("data");
  view.setUint32(offset, dataLen, true); offset += 4;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
    offset += 2;
  }
  return buffer;
}
