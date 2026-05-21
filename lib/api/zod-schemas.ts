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
