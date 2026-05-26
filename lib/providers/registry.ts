// Track C2. Hardcoded provider catalog. The registry is queried by the
// admin UI to populate dropdowns, by the zod schemas to reject invalid
// `(provider, model|voice)` pairs at write time, and by the cost estimator
// to compute per-call price previews.
//
// Costs are per the published vendor pricing as of 2026-05-20; tweak the
// numbers (not the keys) when re-checking pricing. baseLatencyMs is the
// observed p50 first-token / first-audio latency for the cheapest tier.

import type { ProviderRegistry, ProviderCatalogEntry } from "./types";
import {
  DEEPGRAM_AURA_ES_VOICES,
  deepgramEsVoiceLabel,
} from "./deepgram-voices";

// ----- STT catalog -----
const stt: Record<string, ProviderCatalogEntry> = {
  deepgram: {
    key: "deepgram",
    name: "Deepgram",
    models: [
      { id: "nova-3", label: "Nova-3 ES (default)", costPer1k: 0.0043, baseLatencyMs: 250 },
      { id: "nova-2", label: "Nova-2 ES", costPer1k: 0.0036, baseLatencyMs: 280 },
      {
        id: "flux-general-multi",
        label: "Flux General Multilingual (real-time turn detection)",
        costPer1k: 0.0043,
        baseLatencyMs: 220,
      },
    ],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["mx", "cen", "car", "all"],
    notes: "Streaming WebSocket. Default for all latency presets.",
  },
  "aws-transcribe": {
    key: "aws-transcribe",
    name: "AWS Transcribe",
    models: [{ id: "default", label: "Standard streaming", costPer1k: 0.024, baseLatencyMs: 600 }],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["mx", "cen", "car", "all"],
  },
  "google-speech": {
    key: "google-speech",
    name: "Google Speech-to-Text",
    models: [{ id: "chirp-2", label: "Chirp 2", costPer1k: 0.016, baseLatencyMs: 400 }],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["mx", "cen", "car", "all"],
  },
  "whisper-azure": {
    key: "whisper-azure",
    name: "Whisper (Azure)",
    models: [
      { id: "whisper-large-v3", label: "Whisper Large v3", costPer1k: 0.006, baseLatencyMs: 800 },
    ],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["all"],
    notes: "Batch oriented; higher latency than Deepgram on streaming.",
  },
  openai: {
    key: "openai",
    name: "OpenAI Whisper (dev)",
    // Whisper-1 is priced per minute, not per 1k tokens; we surface the
    // per-minute cost as the `costPer1k` field to keep the catalog shape
    // stable. Consumers that care about the unit read the model `notes`.
    models: [
      {
        id: "whisper-1",
        label: "Whisper-1 (chunked batch, $0.006/min)",
        costPer1k: 0.006,
        baseLatencyMs: 600,
      },
    ],
    voices: [],
    engines: [],
    baaTier: "enterprise-only",
    requiresBaa: false,
    dialect: ["mx", "cen", "car", "all"],
    notes: "Dev-mode only. No native streaming — route batches ~2s windows.",
  },
};

// ----- Translate catalog -----
const translate: Record<string, ProviderCatalogEntry> = {
  bedrock: {
    key: "bedrock",
    name: "AWS Bedrock — Anthropic Claude",
    models: [
      {
        id: "anthropic.claude-haiku-4-5-v1:0",
        label: "Claude Haiku 4.5",
        costPer1k: 0.0008,
        baseLatencyMs: 350,
      },
      {
        id: "anthropic.claude-sonnet-4-6-v1:0",
        label: "Claude Sonnet 4.6",
        costPer1k: 0.003,
        baseLatencyMs: 600,
      },
      {
        id: "anthropic.claude-opus-4-7-v1:0",
        label: "Claude Opus 4.7",
        costPer1k: 0.015,
        baseLatencyMs: 1200,
      },
    ],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["all"],
  },
  "vertex-gemini": {
    key: "vertex-gemini",
    name: "Google Vertex AI — Gemini",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", costPer1k: 0.0003, baseLatencyMs: 320 },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", costPer1k: 0.0035, baseLatencyMs: 700 },
    ],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["all"],
  },
  "azure-openai": {
    key: "azure-openai",
    name: "Azure OpenAI",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", costPer1k: 0.00015, baseLatencyMs: 280 },
      { id: "gpt-4o", label: "GPT-4o", costPer1k: 0.0025, baseLatencyMs: 600 },
    ],
    voices: [],
    engines: [],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["all"],
  },
  deepl: {
    key: "deepl",
    name: "DeepL",
    models: [
      { id: "free", label: "Free", costPer1k: 0, baseLatencyMs: 250 },
      { id: "pro", label: "Pro", costPer1k: 0.02, baseLatencyMs: 200 },
    ],
    voices: [],
    engines: [],
    baaTier: "enterprise-only",
    requiresBaa: true,
    dialect: ["all"],
    notes: "BAA only on enterprise plan; warn before selection on free/pro.",
  },
  openai: {
    key: "openai",
    name: "OpenAI (dev)",
    models: [
      {
        id: "gpt-4o-mini",
        label: "GPT-4o mini (in $0.15 / out $0.60 per 1M tokens)",
        costPer1k: 0.00015,
        baseLatencyMs: 500,
      },
    ],
    voices: [],
    engines: [],
    baaTier: "enterprise-only",
    requiresBaa: false,
    dialect: ["all"],
    notes: "Dev-mode only. Direct OpenAI (no BAA); swap to Bedrock for prod.",
  },
  groq: {
    key: "groq",
    name: "Groq",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B Versatile",
        costPer1k: 0.00059,
        baseLatencyMs: 220,
      },
      {
        id: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B Instant",
        costPer1k: 0.00005,
        baseLatencyMs: 120,
      },
      // Verify exact model ID at console.groq.com/docs/models — free tier, ~500 tok/s.
      {
        id: "gpt-oss-120b",
        label: "OpenAI GPT-OSS 120B (MoE, 131K ctx, free tier)",
        costPer1k: 0,
        baseLatencyMs: 280,
      },
    ],
    voices: [],
    engines: [],
    baaTier: "enterprise-only",
    requiresBaa: false,
    dialect: ["all"],
    notes: "Translation and AI suggestions via GROQ_API_KEY.",
  },
};

// ----- TTS catalog -----
const tts: Record<string, ProviderCatalogEntry> = {
  deepgram: {
    key: "deepgram",
    name: "Deepgram Aura",
    models: [],
    voices: DEEPGRAM_AURA_ES_VOICES.map((v) => ({
      id: v.id,
      label: deepgramEsVoiceLabel(v),
      engine: "aura-2",
      costPer1kChars: 0.030,
      baseLatencyMs: 180,
    })),
    engines: [{ id: "aura-2", label: "Aura 2" }],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["mx", "cen", "car", "all"],
    notes: "Same DEEPGRAM_API_KEY as Nova STT. Sub-200ms streaming TTS.",
  },
  polly: {
    key: "polly",
    name: "AWS Polly",
    models: [],
    voices: [
      {
        id: "Lupe",
        label: "Lupe (es-US, generative)",
        engine: "generative",
        costPer1kChars: 0.030,
        baseLatencyMs: 320,
      },
      {
        id: "Lupe",
        label: "Lupe (es-US, neural)",
        engine: "neural",
        costPer1kChars: 0.016,
        baseLatencyMs: 250,
      },
      {
        id: "Lupe",
        label: "Lupe (es-US, long-form)",
        engine: "long-form",
        costPer1kChars: 0.100,
        baseLatencyMs: 500,
      },
      {
        id: "Mia",
        label: "Mia (es-MX, neural)",
        engine: "neural",
        costPer1kChars: 0.016,
        baseLatencyMs: 260,
      },
    ],
    engines: [
      { id: "generative", label: "Generative" },
      { id: "neural", label: "Neural" },
      { id: "long-form", label: "Long-form" },
      { id: "standard", label: "Standard" },
    ],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["mx", "all"],
  },
  "google-tts": {
    key: "google-tts",
    name: "Google Cloud TTS",
    models: [],
    voices: [
      {
        id: "es-US-Chirp3-HD-Achernar",
        label: "Achernar (Chirp 3 HD, es-US)",
        engine: "chirp-3-hd",
        costPer1kChars: 0.030,
        baseLatencyMs: 380,
      },
      {
        id: "es-US-Chirp3-HD-Algenib",
        label: "Algenib (Chirp 3 HD, es-US)",
        engine: "chirp-3-hd",
        costPer1kChars: 0.030,
        baseLatencyMs: 380,
      },
      {
        id: "es-US-Standard-A",
        label: "Standard A (es-US)",
        engine: "standard",
        costPer1kChars: 0.004,
        baseLatencyMs: 250,
      },
    ],
    engines: [
      { id: "chirp-3-hd", label: "Chirp 3 HD" },
      { id: "standard", label: "Standard" },
    ],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["mx", "cen", "car", "all"],
  },
  cartesia: {
    key: "cartesia",
    name: "Cartesia",
    models: [],
    voices: [
      {
        id: "sonic-2-es-female",
        label: "Sonic-2 ES (female)",
        engine: "sonic-2",
        costPer1kChars: 0.030,
        baseLatencyMs: 90,
      },
    ],
    engines: [{ id: "sonic-2", label: "Sonic 2" }],
    baaTier: "enterprise-only",
    requiresBaa: true,
    dialect: ["all"],
    notes: "Lowest latency. BAA only on enterprise plan — warn before selection.",
  },
  "openai-tts": {
    key: "openai-tts",
    name: "OpenAI TTS",
    models: [],
    voices: [
      { id: "nova", label: "Nova (tts-1)", engine: "tts-1", costPer1kChars: 0.015, baseLatencyMs: 280 },
      { id: "nova", label: "Nova (tts-1-hd)", engine: "tts-1-hd", costPer1kChars: 0.030, baseLatencyMs: 420 },
    ],
    engines: [
      { id: "tts-1", label: "tts-1" },
      { id: "tts-1-hd", label: "tts-1-hd" },
    ],
    baaTier: "covered",
    requiresBaa: true,
    dialect: ["all"],
  },
  elevenlabs: {
    key: "elevenlabs",
    name: "ElevenLabs",
    models: [],
    voices: [
      {
        id: "turbo-v2-5-es",
        label: "Spanish Female (turbo-v2-5)",
        engine: "turbo-v2-5",
        costPer1kChars: 0.090,
        baseLatencyMs: 250,
      },
    ],
    engines: [{ id: "turbo-v2-5", label: "Turbo v2.5" }],
    baaTier: "none",
    requiresBaa: true,
    dialect: ["all"],
    notes: "No BAA available — selection blocked unless clinic acknowledges risk.",
  },
  openai: {
    key: "openai",
    name: "OpenAI TTS (dev)",
    models: [],
    voices: [
      {
        id: "nova",
        label: "Nova (tts-1, dev — best ES of the OpenAI voices)",
        engine: "tts-1",
        costPer1kChars: 0.015,
        baseLatencyMs: 500,
      },
    ],
    engines: [{ id: "tts-1", label: "tts-1" }],
    baaTier: "enterprise-only",
    requiresBaa: false,
    dialect: ["all"],
    notes: "Dev-mode only. No BAA on default OpenAI; for prod use Google or Polly.",
  },
};

// ----- Suggest LLM catalog (same shape as translate) -----
const suggest: Record<string, ProviderCatalogEntry> = {
  bedrock: translate.bedrock,
  "vertex-gemini": translate["vertex-gemini"],
  "azure-openai": translate["azure-openai"],
  groq: translate.groq,
  openai: translate.openai,
};

export const PROVIDER_REGISTRY: ProviderRegistry = {
  stt,
  translate,
  tts,
  suggest,
};

/** Lookup helper — returns null if the entry is missing. */
export function getCatalogEntry(
  kind: keyof ProviderRegistry,
  provider: string,
): ProviderCatalogEntry | null {
  return PROVIDER_REGISTRY[kind][provider] ?? null;
}

/** Validate a model id is in the catalog under provider. */
export function isValidModel(
  kind: "stt" | "translate" | "suggest",
  provider: string,
  model: string,
): boolean {
  const entry = getCatalogEntry(kind, provider);
  if (!entry) return false;
  return entry.models.some((m) => m.id === model);
}

/** Validate a voice id + engine pair is in the catalog under provider. */
export function isValidVoice(provider: string, voice: string, engine: string): boolean {
  const entry = getCatalogEntry("tts", provider);
  if (!entry) return false;
  return entry.voices.some((v) => v.id === voice && v.engine === engine);
}
