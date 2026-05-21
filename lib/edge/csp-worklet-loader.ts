// Track C3 — strict-CSP AudioWorklet loader.
// Replaces B3's Blob-URL worklet with a static `/worklets/stt-pcm.js` so
// a strict CSP can drop `worklet-src blob:`. Falls back to a Blob URL when
// the static file 404s (offline cache miss, dev server quirks).
//
// B3 must call `loadSttWorklet(audioCtx)` once before constructing the
// `AudioWorkletNode` for `stt-pcm-encoder`. Until B3 wires this up the
// existing Blob path stays in place — this is additive.
"use client";

const STATIC_URL = "/worklets/stt-pcm.js";

/** Source mirrored from `public/worklets/stt-pcm.js` for the Blob fallback. */
const FALLBACK_SOURCE = `
class SttPcmEncoder extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.targetSr = o.targetSr || 16000;
    this.chunkSamples = Math.floor((this.targetSr * (o.chunkMs || 100)) / 1000);
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
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = Math.max(-1, Math.min(1, input[i]));
        this.buffer[this.bufIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.bufIdx >= this.chunkSamples) {
          const out = this.buffer.slice().buffer;
          this.port.postMessage(out, [out]);
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

export type WorkletLoadStrategy = "static" | "blob";

export interface WorkletLoadResult {
  strategy: WorkletLoadStrategy;
  /** Reason the static path was abandoned, if any. Sanitized — no PHI. */
  reason?: string;
}

/**
 * Register the `stt-pcm-encoder` processor on `audioCtx`.
 *
 * Returns the strategy used so the caller (e.g. B3 useStt) can record it
 * in the status line. Throws if both paths fail — the caller decides how
 * to degrade (B3 falls back to MediaRecorder).
 */
export async function loadSttWorklet(
  audioCtx: AudioContext,
): Promise<WorkletLoadResult> {
  if (typeof audioCtx.audioWorklet?.addModule !== "function") {
    throw new Error("AudioWorklet API unavailable");
  }

  // Static-file path — preferred under strict CSP.
  try {
    await audioCtx.audioWorklet.addModule(STATIC_URL);
    return { strategy: "static" };
  } catch (err: unknown) {
    const reason = errMessage(err);
    // Blob fallback. Only used when the static asset is unreachable.
    try {
      const blob = new Blob([FALLBACK_SOURCE], {
        type: "application/javascript",
      });
      const url = URL.createObjectURL(blob);
      try {
        await audioCtx.audioWorklet.addModule(url);
      } finally {
        // Some browsers won't load the module if we revoke before the
        // network fetch resolves; revoke after addModule settles.
        URL.revokeObjectURL(url);
      }
      return { strategy: "blob", reason };
    } catch (blobErr: unknown) {
      throw new Error(
        `worklet load failed: static=${reason}; blob=${errMessage(blobErr)}`,
      );
    }
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown";
}
