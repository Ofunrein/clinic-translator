// Track C2. Provider abstraction types.
// Each provider config is a discriminated union over the `provider` field.
// The registry (lib/providers/registry) is the source of truth for which
// provider/model/voice combinations are valid; the zod schemas in
// lib/api/zod-schemas validate write-time and reject anything not in the
// catalog.

// `LatencyMode` mirrors the DB `latency_mode` enum and is the value
// persisted on the `clinic_settings` row. The dev-only `dev-openai` preset
// (see lib/providers/presets) is keyed under `LatencyPresetKey` and lives
// purely in memory — it is never written to the DB column.
export type LatencyMode = "fast" | "balanced" | "accurate";
export type LatencyPresetKey = LatencyMode | "dev-openai";
export type RealtimeMode = "text-middleman" | "s2s";

// ----- STT -----
export type SttProvider =
  | { provider: "deepgram"; model: string; language?: string }
  | { provider: "aws-transcribe"; model: string; language?: string }
  | { provider: "google-speech"; model: string; language?: string }
  | { provider: "whisper-azure"; model: string; language?: string }
  | { provider: "openai"; model: string; language?: string };

// ----- Translate -----
export type TranslateProvider =
  | { provider: "bedrock"; model: string }
  | { provider: "vertex-gemini"; model: string }
  | { provider: "azure-openai"; model: string }
  | { provider: "deepl"; model: string }
  | { provider: "openai"; model: string };

// ----- TTS -----
export type TtsProvider =
  | { provider: "polly"; voice: string; engine: "neural" | "generative" | "long-form" | "standard" }
  | { provider: "google-tts"; voice: string; engine: "chirp-3-hd" | "standard" }
  | { provider: "cartesia"; voice: string; engine: "sonic-2" }
  | { provider: "openai-tts"; voice: string; engine: "tts-1" | "tts-1-hd" }
  | { provider: "elevenlabs"; voice: string; engine: "turbo-v2-5" }
  | { provider: "openai"; voice: string; engine: "tts-1" | "tts-1-hd" };

// ----- Suggest LLM (same shape as Translate) -----
export type SuggestProvider =
  | { provider: "bedrock"; model: string }
  | { provider: "vertex-gemini"; model: string }
  | { provider: "azure-openai"; model: string }
  | { provider: "openai"; model: string };

// ----- Composite per-clinic config blob -----
export interface ProviderConfig {
  stt: SttProvider;
  translate: TranslateProvider;
  tts: TtsProvider;
  suggest: SuggestProvider;
  latencyMode: LatencyMode;
  realtimeMode: RealtimeMode;
}

// ----- Catalog entry -----
export interface ProviderCatalogEntry {
  /** Stable provider key, matches the discriminator on *Provider unions. */
  key: string;
  /** Human-readable name shown in the admin UI. */
  name: string;
  /** Available model IDs (for STT / translate / suggest). */
  models: ReadonlyArray<{ id: string; label: string; costPer1k?: number; baseLatencyMs?: number }>;
  /** Available voice IDs (for TTS). */
  voices: ReadonlyArray<{
    id: string;
    label: string;
    engine: string;
    costPer1kChars?: number;
    baseLatencyMs?: number;
  }>;
  /** Available engines (for TTS providers that expose multiple). */
  engines: ReadonlyArray<{ id: string; label: string }>;
  /** BAA tier — describes whether this vendor will sign a HIPAA BAA. */
  baaTier: "covered" | "enterprise-only" | "none";
  /** Whether the catalog requires an existing BAA before selection. */
  requiresBaa: boolean;
  /** Supported dialects (for STT/TTS); empty list = N/A. */
  dialect: ReadonlyArray<"mx" | "cen" | "car" | "other" | "all">;
  /** Free-form notes for the UI tooltip. */
  notes?: string;
}

export type ProviderRegistry = Record<
  "stt" | "translate" | "tts" | "suggest",
  Record<string, ProviderCatalogEntry>
>;

// ----- Errors -----
export class ProviderNotImplementedError extends Error {
  readonly code = "provider_not_implemented" as const;
  readonly retryable = false;
  constructor(provider: string, kind: string) {
    super(`provider not yet wired: ${kind}/${provider} (Phase 2)`);
    this.name = "ProviderNotImplementedError";
  }
}

// ----- Clinic-level settings (mirror of clinic_settings row, with parsed jsonb) -----
export interface EscalationRules {
  /** Lowercased keyword fragments that, if matched, force `escalate=true`. */
  keywords: ReadonlyArray<string>;
  /** Force escalation when the suggestion confidence is below this. */
  confidenceFloor: number;
  /** Optional categories that always escalate (clinical, billing, etc). */
  categories?: ReadonlyArray<string>;
}

export interface AiAssistConfig {
  enabled: boolean;
  /** Max tokens for the suggestion model. */
  maxTokens: number;
  /** Confidence threshold below which the UI shows a warning. */
  confidenceThreshold: number;
}

export interface ClinicConfigBlob {
  providers: ProviderConfig;
  aiAssist: AiAssistConfig;
  recording: { enabled: boolean; retentionDaysTranscripts: number; retentionDaysAudio: number };
  clinic: {
    name: string;
    hours: string;
    dialect: "mx" | "cen" | "car" | "other";
    escalationRules: EscalationRules;
  };
}
