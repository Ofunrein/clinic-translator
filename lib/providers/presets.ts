// Track C2. Latency-mode presets — Deepgram voice + Groq text (translate + suggest).

import type { LatencyPresetKey, ProviderConfig } from "./types";
import { DEFAULT_DEEPGRAM_TTS_VOICE } from "./deepgram-voices";

const DEFAULT_TTS = {
  provider: "deepgram" as const,
  voice: DEFAULT_DEEPGRAM_TTS_VOICE,
  engine: "aura-2" as const,
};

const FAST: ProviderConfig = {
  stt: { provider: "deepgram", model: "nova-3", language: "es" },
  translate: { provider: "groq", model: "llama-3.1-8b-instant" },
  tts: DEFAULT_TTS,
  suggest: { provider: "groq", model: "llama-3.1-8b-instant" },
  latencyMode: "fast",
  realtimeMode: "text-middleman",
};

const BALANCED: ProviderConfig = {
  stt: { provider: "deepgram", model: "nova-3", language: "es" },
  translate: { provider: "groq", model: "llama-3.3-70b-versatile" },
  tts: DEFAULT_TTS,
  suggest: { provider: "groq", model: "llama-3.3-70b-versatile" },
  latencyMode: "balanced",
  realtimeMode: "text-middleman",
};

const ACCURATE: ProviderConfig = {
  stt: { provider: "deepgram", model: "nova-3", language: "es" },
  // GPT-OSS 120B: MoE model, best reasoning on Groq free tier — verify model ID
  // at console.groq.com/docs/models if Groq updates their catalog.
  translate: { provider: "groq", model: "openai/gpt-oss-120b" },
  tts: DEFAULT_TTS,
  suggest: { provider: "groq", model: "openai/gpt-oss-120b" },
  latencyMode: "accurate",
  realtimeMode: "text-middleman",
};

// Legacy key — same stack as balanced (Deepgram + Groq only).
const DEV_OPENAI: ProviderConfig = {
  ...BALANCED,
  latencyMode: "balanced",
};

export const LATENCY_PRESETS: Record<LatencyPresetKey, ProviderConfig> = {
  fast: FAST,
  balanced: BALANCED,
  accurate: ACCURATE,
  "dev-openai": DEV_OPENAI,
};

export function applyPreset(mode: LatencyPresetKey): ProviderConfig {
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
