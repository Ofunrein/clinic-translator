## Learned User Preferences

- HIPAA compliance is not a priority; optimize for cost over BAA-compliant vendor tiers.
- Prefer free or minimal fixed-cost hosting (Vercel Hobby, Neon free tier, pay-per-use AI only).
- Chose NextAuth v5 with Drizzle on Neon over Supabase Auth to avoid Supabase Auth coupling and recurring cost.
- Default voice path is Deepgram-only (Nova-3 STT + Aura-2 TTS); avoid Google/Polly TTS on default presets.
- Only two AI vendors in active use: Deepgram (voice) and Groq (translate + suggest).

## Learned Workspace Facts

- Next.js app: real-time clinic phone translator with Spanish STT, English↔Spanish translation, and Spanish TTS.
- Database and auth: Neon Postgres with Drizzle; Supabase Auth was removed in favor of NextAuth v5 and Google OAuth.
- Active stack: DEEPGRAM_API_KEY for STT+TTS, GROQ_API_KEY for translate and suggest; `getActiveProviderConfig` normalizes legacy rows to Deepgram + Groq.
- Clinic knowledge (Settings → Knowledge): profile, services, policies, and FAQs persist on `clinic_settings` and feed Groq suggest via `rowToClinicConfig`; glossary stays separate for translation.
- Latency presets (fast/balanced/accurate): Deepgram Nova-3 + Aura-2 Mexican Spanish voices; Groq Llama 8B (fast) or 70B (balanced/accurate) for text.
- STT WebSocket auth: browser fetches a JWT from POST /api/auth/token and passes it as ?token= on the WebSocket URL.
- Edge routes must not import Node-only dependencies (e.g. @google-cloud/*, postgres) through shared provider barrels.
- Sentry is off unless SENTRY_DSN is set; configs scrub PHI-like fields before sending events.
- Google OAuth credentials are managed in the GCP n8n-host project.
- Deepgram handles STT and TTS (Aura-2) in this repo; one DEEPGRAM_API_KEY covers both.
