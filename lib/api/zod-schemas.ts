// Track B2. Zod schemas for every route body. Frontend urgency vocabulary
// is enforced here; the DB-side enum lives in lib/db/schema and is mapped
// via lib/api/urgency.

import { z } from "zod";

// ---- Urgency / outcome (frontend vocabulary) ----

export const feUrgencySchema = z.enum(["info", "routine", "urgent", "emergency"]);
export type FeUrgencyInput = z.infer<typeof feUrgencySchema>;

// Spec §4.3 db enum: completed|transferred|voicemail|dropped|fallback.
// Track B3 frontend says "handled" / "abandoned" — map at the boundary
// (route handlers) per Track B2 contract: handled→completed, abandoned→dropped.
export const feOutcomeSchema = z.enum([
  "handled",
  "abandoned",
  "transferred",
  "voicemail",
  "fallback",
]);
export type FeOutcomeInput = z.infer<typeof feOutcomeSchema>;

// ---- /api/translate ----

export const translateBodySchema = z.object({
  text: z.string().min(1).max(4000),
  src: z.enum(["es", "en"]),
  dst: z.enum(["es", "en"]),
  sessionId: z.string().uuid().optional(),
});
export type TranslateBody = z.infer<typeof translateBodySchema>;

// ---- /api/tts ----

export const ttsBodySchema = z.object({
  text: z.string().min(1).max(4000),
  voice: z.string().min(1).max(64).optional(),
  sessionId: z.string().uuid().optional(),
});
export type TtsBody = z.infer<typeof ttsBodySchema>;

// ---- /api/sessions ----

export const createSessionBodySchema = z.object({
  urgency: feUrgencySchema.optional(),
  patientId: z.string().uuid().optional(),
});
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

export const patchSessionBodySchema = z
  .object({
    urgency: feUrgencySchema.optional(),
    outcome: feOutcomeSchema.optional(),
    endedAt: z.string().datetime().optional(),
  })
  .refine(
    (v) => v.urgency !== undefined || v.outcome !== undefined || v.endedAt !== undefined,
    { message: "must include at least one of urgency, outcome, endedAt" },
  );
export type PatchSessionBody = z.infer<typeof patchSessionBodySchema>;

// ---- /api/sessions/:id/utterances ----

export const createUtteranceBodySchema = z.object({
  role: z.enum(["patient", "staff"]),
  lang: z.enum(["es", "en"]),
  text: z.string().min(1).max(4000),
  translation: z.string().max(4000).optional(),
  audioStorageKey: z.string().max(512).optional(),
});
export type CreateUtteranceBody = z.infer<typeof createUtteranceBodySchema>;

export const utterancesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(),
});
export type UtterancesQuery = z.infer<typeof utterancesQuerySchema>;

// ---- /api/glossary ----

export const glossaryQuerySchema = z.object({
  dialect: z.enum(["mx", "cen", "car", "all"]).optional(),
});
export type GlossaryQuery = z.infer<typeof glossaryQuerySchema>;

export const createGlossaryBodySchema = z.object({
  en: z.string().min(1).max(200),
  es: z.string().min(1).max(200),
  dialect: z.string().max(16).optional(),
  category: z
    .enum(["medication", "symptom", "procedure", "billing", "scheduling", "general"])
    .default("general"),
});
export type CreateGlossaryBody = z.infer<typeof createGlossaryBodySchema>;

// ---- /api/suggest (Track C1) ----

export const suggestContextTurnSchema = z.object({
  role: z.enum(["patient", "staff"]),
  text: z.string().min(1).max(8000),
});

export const suggestRequestSchema = z.object({
  sessionId: z.string().uuid(),
  lastUtteranceId: z.string().uuid(),
  /** Client transcript fallback when DB persist/encrypt failed. */
  contextTurns: z.array(suggestContextTurnSchema).max(24).optional(),
});
export type SuggestRequest = z.infer<typeof suggestRequestSchema>;

export const suggestOutcomeSchema = z.object({
  utteranceId: z.string().uuid(),
  outcome: z.enum(["accepted", "edited", "dismissed"]),
});
export type SuggestOutcome = z.infer<typeof suggestOutcomeSchema>;

// ---- /api/settings (Track C2) ----
//
// Provider configs are validated as discriminated unions at the type level
// then cross-checked against the catalog at the route layer (lib/providers/
// registry). The catalog check rejects models/voices the registry doesn't
// list.

export const latencyModeSchema = z.enum(["fast", "balanced", "accurate"]);
export const realtimeModeSchema = z.enum(["text-middleman", "s2s"]);
export const clinicDialectSchema = z.enum(["mx", "cen", "car", "other"]);

export const sttProviderSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("deepgram"),
    model: z.string().min(1).max(64),
    language: z.string().min(2).max(8).optional(),
  }),
  z.object({
    provider: z.literal("aws-transcribe"),
    model: z.string().min(1).max(64),
    language: z.string().min(2).max(8).optional(),
  }),
  z.object({
    provider: z.literal("google-speech"),
    model: z.string().min(1).max(64),
    language: z.string().min(2).max(8).optional(),
  }),
  z.object({
    provider: z.literal("whisper-azure"),
    model: z.string().min(1).max(64),
    language: z.string().min(2).max(8).optional(),
  }),
]);

export const translateProviderSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("bedrock"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("vertex-gemini"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("azure-openai"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("deepl"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("openai"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("groq"), model: z.string().min(1).max(128) }),
]);

export const ttsProviderSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("deepgram"),
    voice: z.string().min(1).max(64),
    engine: z.literal("aura-2"),
  }),
  z.object({
    provider: z.literal("polly"),
    voice: z.string().min(1).max(64),
    engine: z.enum(["neural", "generative", "long-form", "standard"]),
  }),
  z.object({
    provider: z.literal("google-tts"),
    voice: z.string().min(1).max(64),
    engine: z.enum(["chirp-3-hd", "standard"]),
  }),
  z.object({
    provider: z.literal("cartesia"),
    voice: z.string().min(1).max(64),
    engine: z.literal("sonic-2"),
  }),
  z.object({
    provider: z.literal("openai-tts"),
    voice: z.string().min(1).max(64),
    engine: z.enum(["tts-1", "tts-1-hd"]),
  }),
  z.object({
    provider: z.literal("elevenlabs"),
    voice: z.string().min(1).max(64),
    engine: z.literal("turbo-v2-5"),
  }),
]);

export const suggestProviderSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("bedrock"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("vertex-gemini"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("azure-openai"), model: z.string().min(1).max(128) }),
  z.object({ provider: z.literal("groq"), model: z.string().min(1).max(128) }),
]);

export const providerConfigSchema = z.object({
  stt: sttProviderSchema,
  translate: translateProviderSchema,
  tts: ttsProviderSchema,
  suggest: suggestProviderSchema,
  latencyMode: latencyModeSchema,
  realtimeMode: realtimeModeSchema,
});
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;

export const escalationRulesSchema = z.object({
  keywords: z.array(z.string().min(1).max(64)).max(64),
  confidenceFloor: z.number().min(0).max(1),
  categories: z.array(z.string().min(1).max(32)).max(16).optional(),
  previewHoldSec: z.number().min(0).max(60).optional(),
  autoSendPreview: z.boolean().optional(),
});

export const clinicSettingsSchema = z.object({
  stt: sttProviderSchema,
  translate: translateProviderSchema,
  tts: ttsProviderSchema,
  suggest: suggestProviderSchema,
  latencyMode: latencyModeSchema,
  realtimeMode: realtimeModeSchema,
  aiAssistEnabled: z.boolean(),
  recordingEnabled: z.boolean(),
  retentionDaysTranscripts: z.number().int().min(1).max(36500),
  retentionDaysAudio: z.number().int().min(0).max(36500),
  dialect: clinicDialectSchema,
  clinicName: z.string().min(1).max(120),
  clinicHours: z.string().min(1).max(2000),
  clinicServices: z.array(z.string().min(1).max(200)).max(64),
  clinicAfterHours: z.string().max(2000).nullable().optional(),
  clinicTransferPhone: z.string().max(32).nullable().optional(),
  clinicPolicyNotes: z.string().max(4000).nullable().optional(),
  clinicFaqBullets: z.array(z.string().min(1).max(500)).max(32),
  escalationRules: escalationRulesSchema,
});
export type ClinicSettingsInput = z.infer<typeof clinicSettingsSchema>;

export const settingsPatchSchema = clinicSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "patch must include at least one field",
  });
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

// ---- /api/tts/preview (Track C2) ----
export const ttsPreviewBodySchema = z.object({
  config: ttsProviderSchema,
  text: z.string().min(1).max(400).optional(),
});
export type TtsPreviewBody = z.infer<typeof ttsPreviewBodySchema>;
