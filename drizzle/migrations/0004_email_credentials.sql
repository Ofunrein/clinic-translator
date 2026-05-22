-- 0004_email_credentials.sql — email+password auth (no email confirmation).

CREATE TABLE IF NOT EXISTS "user_credentials" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "password_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
