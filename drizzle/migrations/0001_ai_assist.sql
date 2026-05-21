-- 0001_ai_assist.sql — Track C1 AI-assisted reply suggestions.
-- Adds the suggestion_outcome_enum type and four columns to utterances.
-- Idempotent: re-runnable against an already-migrated DB.

DO $$ BEGIN
  CREATE TYPE "suggestion_outcome_enum" AS ENUM ('accepted', 'edited', 'dismissed', 'none');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "utterances"
    ADD COLUMN IF NOT EXISTS "suggestion_text_enc" bytea;
EXCEPTION WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "utterances"
    ADD COLUMN IF NOT EXISTS "suggestion_confidence" numeric(3,2);
EXCEPTION WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "utterances"
    ADD COLUMN IF NOT EXISTS "suggestion_outcome" "suggestion_outcome_enum"
    NOT NULL DEFAULT 'none';
EXCEPTION WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "utterances"
    ADD COLUMN IF NOT EXISTS "suggestion_escalate" boolean NOT NULL DEFAULT false;
EXCEPTION WHEN undefined_table THEN null; END $$;
