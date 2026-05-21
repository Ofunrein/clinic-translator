// Track C2. Latency-mode presets that snap the four provider blobs to a
// known-good combination. UI shows these as the "Fast / Balanced / Accurate"
// radio cards on the settings page; saving a preset writes the underlying
// `stt`/`translate`/`tts`/`suggest` jsonb columns + sets `latencyMode`.

import type { LatencyPresetKey, ProviderConfig } from "./types";

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

// Dev-only preset: runs the whole stack off a single OPENAI_API_KEY so the
// app boots without AWS / Google / Deepgram credentials. STT is chunked
// batch (Whisper has no streaming endpoint). NOT for production use — see
// `notes` in registry entries.
//
// The persisted `latencyMode` is `"balanced"` because the DB `latency_mode`
// enum does not include `dev-openai`; the preset key (`dev-openai`) lives
// in memory only, accessed via `LATENCY_PRESETS["dev-openai"]`.
const DEV_OPENAI: ProviderConfig = {
  stt: { provider: "openai", model: "whisper-1", language: "es" },
  translate: { provider: "openai", model: "gpt-4o-mini" },
  tts: { provider: "openai", voice: "nova", engine: "tts-1" },
  suggest: { provider: "openai", model: "gpt-4o-mini" },
  latencyMode: "balanced",
  realtimeMode: "text-middleman",
};

export const LATENCY_PRESETS: Record<LatencyPresetKey, ProviderConfig> = {
  fast: FAST,
  balanced: BALANCED,
  accurate: ACCURATE,
  "dev-openai": DEV_OPENAI,
};

export function applyPreset(mode: LatencyPresetKey): ProviderConfig {
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
