# Clinic Translator

HIPAA-compliant Spanish↔English real-time translator web app for a single clinic. Staff answer the phone, the app transcribes the patient's Spanish, translates to English, then speaks staff replies aloud as natural Spanish back into the handset.

Spec: [`docs/superpowers/specs/2026-05-20-clinic-translator-design.md`](docs/superpowers/specs/2026-05-20-clinic-translator-design.md)

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM · Supabase Postgres · AWS Bedrock Claude · Deepgram STT · Google Cloud TTS · Sentry · Vercel.

## Dev

```sh
cp .env.example .env.local   # fill in
npm install
npm run dev                  # http://localhost:3000
```

## Scripts

- `npm run dev` — Next dev server
- `npm run build` / `npm run start` — production build/run
- `npm run lint` / `npm run typecheck`
- `npm run test` — Vitest (unit + integration)
- `npm run test:e2e` — Playwright (Chromium)
- `npm run db:generate` / `db:migrate` / `db:studio` — Drizzle

## Status

Wave 1: scaffold only. Feature implementation tracked per spec §13 milestones.

## Setup

```sh
git clone <repo-url> clinic-translator
cd clinic-translator
cp .env.example .env.local        # fill Supabase, Bedrock, Deepgram, GCP, Sentry, allowlist
pnpm install                      # or `npm install`
pnpm db:migrate                   # apply Drizzle migrations
pnpm dev                          # http://localhost:3000
```

Required env keys for auth: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`CLINIC_EMAIL_ALLOWLIST` (comma-separated, supports `*@clinic.com`
wildcards). Sentry is opt-in via `SENTRY_DSN`.
