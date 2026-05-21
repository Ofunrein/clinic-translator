-- 0002_settings.sql — Track C2 clinic_settings table.
-- Adds enum types and the clinic_settings table for hot-swappable
-- STT/translate/TTS/suggest provider configs. Idempotent.

DO $$ BEGIN
  CREATE TYPE "latency_mode" AS ENUM ('fast', 'balanced', 'accurate');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "realtime_mode" AS ENUM ('text-middleman', 's2s');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "clinic_dialect" AS ENUM ('mx', 'cen', 'car', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "clinic_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinic_id" uuid NOT NULL,
  "stt" jsonb NOT NULL,
  "translate" jsonb NOT NULL,
  "tts" jsonb NOT NULL,
  "suggest" jsonb NOT NULL,
  "latency_mode" "latency_mode" NOT NULL DEFAULT 'balanced',
  "realtime_mode" "realtime_mode" NOT NULL DEFAULT 'text-middleman',
  "ai_assist_enabled" boolean NOT NULL DEFAULT true,
  "recording_enabled" boolean NOT NULL DEFAULT false,
  "retention_days_transcripts" integer NOT NULL DEFAULT 2555,
  "retention_days_audio" integer NOT NULL DEFAULT 90,
  "dialect" "clinic_dialect" NOT NULL DEFAULT 'mx',
  "clinic_name" text NOT NULL DEFAULT 'Riverside Family Clinic',
  "clinic_hours" text NOT NULL DEFAULT 'Monday–Friday, 8:00 AM to 5:00 PM Central',
  "escalation_rules" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "staff_users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinic_settings_clinic_id_uq"
  ON "clinic_settings" ("clinic_id");
