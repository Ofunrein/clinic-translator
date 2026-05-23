-- 0006_user_theme.sql — per-user light/dark preference on staff_users.
-- Idempotent.

DO $$ BEGIN
  CREATE TYPE "theme_preference" AS ENUM ('light', 'dark');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "staff_users"
  ADD COLUMN IF NOT EXISTS "theme_preference" "theme_preference" NOT NULL DEFAULT 'light';
