-- 0005_clinic_knowledge.sql — clinic knowledge fields for AI suggest context.
-- Idempotent.

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "clinic_services" jsonb NOT NULL DEFAULT '["primary care visits","physicals","vaccinations","lab draws","prescription refills"]'::jsonb;

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "clinic_after_hours" text;

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "clinic_transfer_phone" text;

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "clinic_policy_notes" text;

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "clinic_faq_bullets" jsonb NOT NULL DEFAULT '[]'::jsonb;
