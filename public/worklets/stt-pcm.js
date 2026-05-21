// Track C3 — static AudioWorklet processor for the STT pipeline.
// Extracted from the B3 Blob-URL worklet so a strict CSP can ban
// `worklet-src blob:`. Intentionally framework-free; runs in the
// AudioWorkletGlobalScope which has its own globals (`registerProcessor`,
// `sampleRate`, `currentTime`, etc).
//
// Behavior matches B3:
//   - downsample input mono channel to `targetSr` (default 16kHz)
//   - emit Int16 PCM chunks of `chunkMs` (default 100ms)
//   - posts ArrayBuffers via this.port — the main thread forwards to the WS
class SttPcmEncoder extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.targetSr = o.targetSr || 16000;
    this.chunkSamples = Math.floor((this.targetSr * (o.chunkMs || 100)) / 1000);
    this.buffer = new Int16Array(this.chunkSamples);
    this.bufIdx = 0;
    // sampleRate is the AudioWorkletGlobalScope's input rate.
    this.ratio = sampleRate / this.targetSr;
    this.acc = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let i = 0;
    while (i < input.length) {
      // Naive linear-resample to targetSr.
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = Math.max(-1, Math.min(1, input[i]));
        this.buffer[this.bufIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.bufIdx >= this.chunkSamples) {
          // Slice so we don't share memory with the next chunk.
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

registerProcessor("stt-pcm-encoder", SttPcmEncoder);
