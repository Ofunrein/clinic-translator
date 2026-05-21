-- 0003_nextauth.sql — NextAuth (Auth.js) adapter tables.
-- Schema follows @auth/drizzle-adapter Postgres expectations. Idempotent.

CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY,
  "name" text,
  "email" text NOT NULL,
  "email_verified" timestamp with time zone,
  "image" text
);

CREATE TABLE IF NOT EXISTS "accounts" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  PRIMARY KEY ("provider", "provider_account_id")
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "session_token" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification_tokens" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp with time zone NOT NULL,
  PRIMARY KEY ("identifier", "token")
);
