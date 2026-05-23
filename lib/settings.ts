// Track C2. Server + client helpers for `clinic_settings`.
//
// The deployed app is single-tenant today, but the schema models a per-clinic
// row. We use a fixed sentinel UUID for the active clinic so the migration
// doesn't need to seed anything — `getClinicSettings` lazily upserts the
// default row on first read. In-process cache is keyed by clinicId with a
// 30-second TTL; PATCH invalidates the cache.
//
// Server-only by convention (DB access). The `server-only` import is omitted
// so Vitest can exercise this module under jsdom-less node env without
// needing a Next.js bundler shim.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clinicSettings, type ClinicSettings } from "@/lib/db/schema";
import { applyPreset, LATENCY_PRESETS } from "@/lib/providers/presets";
import type {
  ClinicConfigBlob,
  EscalationRules,
  ProviderConfig,
  SttProvider,
  TranslateProvider,
  TtsProvider,
  SuggestProvider,
} from "@/lib/providers/types";
import {
  DEFAULT_ESCALATION_RULES,
  normalizeEscalationRules,
} from "@/lib/escalation-rules";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";

/** Single-tenant placeholder until we wire multi-clinic auth. */
export const DEFAULT_CLINIC_ID = "00000000-0000-0000-0000-000000000001";

const DEFAULT_ESCALATION: EscalationRules = DEFAULT_ESCALATION_RULES;

const CACHE_TTL_MS = 30_000;
interface CacheEntry {
  expiresAt: number;
  value: ClinicSettings;
}
const cache = new Map<string, CacheEntry>();

function freshFromPreset(): ProviderConfig {
  return applyPreset("balanced");
}

function ensureSupportedStack(config: ProviderConfig): ProviderConfig {
  const preset =
    LATENCY_PRESETS[config.latencyMode] ?? LATENCY_PRESETS.balanced;
  return {
    ...config,
    stt:
      config.stt.provider === "deepgram"
        ? config.stt
        : preset.stt,
    tts:
      config.tts.provider === "deepgram"
        ? config.tts
        : preset.tts,
    translate:
      config.translate.provider === "groq"
        ? config.translate
        : preset.translate,
    suggest:
      config.suggest.provider === "groq"
        ? config.suggest
        : preset.suggest,
  };
}

function defaultRow(clinicId: string): typeof clinicSettings.$inferInsert {
  const cfg = freshFromPreset();
  return {
    clinicId,
    stt: cfg.stt,
    translate: cfg.translate,
    tts: cfg.tts,
    suggest: cfg.suggest,
    latencyMode: cfg.latencyMode,
    realtimeMode: cfg.realtimeMode,
    aiAssistEnabled: true,
    recordingEnabled: false,
    retentionDaysTranscripts: 2555,
    retentionDaysAudio: 90,
    dialect: "mx",
    clinicName: "Riverside Family Clinic",
    clinicHours: "Monday–Friday, 8:00 AM to 5:00 PM Central",
    clinicServices: [...DEFAULT_CLINIC.services],
    clinicAfterHours: DEFAULT_CLINIC.hours.afterHours ?? null,
    clinicTransferPhone: DEFAULT_CLINIC.transferPhone ?? null,
    clinicPolicyNotes: DEFAULT_CLINIC.policyNotes ?? null,
    clinicFaqBullets: [],
    escalationRules: DEFAULT_ESCALATION,
  };
}

async function loadOrSeed(clinicId: string): Promise<ClinicSettings> {
  const rows = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.clinicId, clinicId))
    .limit(1);
  const existing = rows[0];
  if (existing) return existing;
  const inserted = await db
    .insert(clinicSettings)
    .values(defaultRow(clinicId))
    .returning();
  const row = inserted[0];
  if (!row) {
    // Should never happen — INSERT ... RETURNING always yields the row.
    throw new Error("failed to seed clinic_settings");
  }
  return row;
}

export async function getClinicSettings(
  clinicId: string = DEFAULT_CLINIC_ID,
): Promise<ClinicSettings> {
  const now = Date.now();
  const cached = cache.get(clinicId);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await loadOrSeed(clinicId);
  cache.set(clinicId, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

export interface ClinicSettingsPatch {
  stt?: SttProvider;
  translate?: TranslateProvider;
  tts?: TtsProvider;
  suggest?: SuggestProvider;
  latencyMode?: ProviderConfig["latencyMode"];
  realtimeMode?: ProviderConfig["realtimeMode"];
  aiAssistEnabled?: boolean;
  recordingEnabled?: boolean;
  retentionDaysTranscripts?: number;
  retentionDaysAudio?: number;
  dialect?: "mx" | "cen" | "car" | "other";
  clinicName?: string;
  clinicHours?: string;
  clinicServices?: string[];
  clinicAfterHours?: string | null;
  clinicTransferPhone?: string | null;
  clinicPolicyNotes?: string | null;
  clinicFaqBullets?: string[];
  escalationRules?: EscalationRules;
}

export async function updateClinicSettings(args: {
  clinicId?: string;
  patch: ClinicSettingsPatch;
  updatedBy: string;
}): Promise<ClinicSettings> {
  const clinicId = args.clinicId ?? DEFAULT_CLINIC_ID;
  // Ensure row exists.
  await getClinicSettings(clinicId);
  const updateValues: Partial<typeof clinicSettings.$inferInsert> = {
    ...args.patch,
    updatedBy: args.updatedBy,
    updatedAt: new Date(),
  };
  const updated = await db
    .update(clinicSettings)
    .set(updateValues)
    .where(eq(clinicSettings.clinicId, clinicId))
    .returning();
  const row = updated[0];
  if (!row) throw new Error("update returned no row");
  cache.delete(clinicId);
  return row;
}

/** For the dispatcher — flatten DB row into a typed `ProviderConfig`. */
export function rowToProviderConfig(row: ClinicSettings): ProviderConfig {
  return {
    stt: row.stt as SttProvider,
    translate: row.translate as TranslateProvider,
    tts: row.tts as TtsProvider,
    suggest: row.suggest as SuggestProvider,
    latencyMode: row.latencyMode,
    realtimeMode: row.realtimeMode,
  };
}

/** Re-export for routes that already import from settings. */
export { rowToClinicConfig } from "@/lib/clinic-knowledge";

/** For routes that need the full clinic config (prompts, escalation, etc). */
export function rowToClinicBlob(row: ClinicSettings): ClinicConfigBlob {
  const escalation = normalizeEscalationRules(row.escalationRules as EscalationRules);
  return {
    providers: rowToProviderConfig(row),
    aiAssist: {
      enabled: row.aiAssistEnabled,
      maxTokens: 512,
      confidenceThreshold: escalation.confidenceFloor,
    },
    recording: {
      enabled: row.recordingEnabled,
      retentionDaysTranscripts: row.retentionDaysTranscripts,
      retentionDaysAudio: row.retentionDaysAudio,
    },
    clinic: {
      name: row.clinicName,
      hours: row.clinicHours,
      dialect: row.dialect,
      escalationRules: escalation,
    },
  };
}

/** Read the active config; falls back to balanced preset on any error. */
export async function getActiveProviderConfig(
  clinicId: string = DEFAULT_CLINIC_ID,
): Promise<ProviderConfig> {
  try {
    const row = await getClinicSettings(clinicId);
    return ensureSupportedStack(rowToProviderConfig(row));
  } catch {
    return ensureSupportedStack(LATENCY_PRESETS.balanced);
  }
}

/** Test-only cache reset. */
export function __resetSettingsCacheForTest(): void {
  cache.clear();
}
