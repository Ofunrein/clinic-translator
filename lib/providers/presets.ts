// Track C2. Latency-mode presets that snap the four provider blobs to a
// known-good combination. UI shows these as the "Fast / Balanced / Accurate"
// radio cards on the settings page; saving a preset writes the underlying
// `stt`/`translate`/`tts`/`suggest` jsonb columns + sets `latencyMode`.

import type { LatencyMode, ProviderConfig } from "./types";

const FAST: ProviderConfig = {
  stt: { provider: "deepgram", model: "nova-3", language: "es" },
  translate: { provider: "bedrock", model: "anthropic.claude-haiku-4-5-v1:0" },
  tts: { provider: "cartesia", voice: "sonic-2-es-female", engine: "sonic-2" },
  suggest: { provider: "bedrock", model: "anthropic.claude-haiku-4-5-v1:0" },
  latencyMode: "fast",
  realtimeMode: "text-middleman",
};

const BALANCED: ProviderConfig = {
  stt: { provider: "deepgram", model: "nova-3", language: "es" },
  translate: { provider: "bedrock", model: "anthropic.claude-haiku-4-5-v1:0" },
  tts: { provider: "polly", voice: "Lupe", engine: "generative" },
  suggest: { provider: "bedrock", model: "anthropic.claude-haiku-4-5-v1:0" },
  latencyMode: "balanced",
  realtimeMode: "text-middleman",
};

const ACCURATE: ProviderConfig = {
  stt: { provider: "deepgram", model: "nova-3", language: "es" },
  translate: { provider: "bedrock", model: "anthropic.claude-sonnet-4-6-v1:0" },
  tts: {
    provider: "google-tts",
    voice: "es-US-Chirp3-HD-Achernar",
    engine: "chirp-3-hd",
  },
  suggest: { provider: "bedrock", model: "anthropic.claude-sonnet-4-6-v1:0" },
  latencyMode: "accurate",
  realtimeMode: "text-middleman",
};

export const LATENCY_PRESETS: Record<LatencyMode, ProviderConfig> = {
  fast: FAST,
  balanced: BALANCED,
  accurate: ACCURATE,
};

export function applyPreset(mode: LatencyMode): ProviderConfig {
  // Return a deep clone so callers can mutate freely.
  const src = LATENCY_PRESETS[mode];
  return {
    stt: { ...src.stt },
    translate: { ...src.translate },
    tts: { ...src.tts },
    suggest: { ...src.suggest },
    latencyMode: src.latencyMode,
    realtimeMode: src.realtimeMode,
  };
}
