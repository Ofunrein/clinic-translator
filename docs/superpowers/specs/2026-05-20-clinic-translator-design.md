# Clinic Spanish↔English Translator — Design Spec

**Date:** 2026-05-20
**Author:** Martin Ofunrein (for clinic owner friend)
**Status:** Draft — pending user review

## 1. Problem

Friend's clinic gets phone calls from Spanish-speaking patients. No staff speaks Spanish. Friend wants to keep answering the phone himself, with a web app that:

1. Listens to the patient on the call (live audio).
2. Shows the patient's Spanish, plus an English translation, on screen.
3. Lets him type English replies.
4. Speaks those replies aloud as natural-sounding Spanish, played through speakers into the handset.

Friend explicitly does **not** want a robot answering the phone.

## 2. Goals & Non-Goals

**Goals**
- Real-time, two-way translation during a live phone call.
- Spanish voice output as realistic as possible.
- HIPAA-compliant: covered entity, BAAs with every vendor that touches PHI.
- Ship a usable pilot in under one week.
- Encrypted PHI at rest, audit log for every access.

**Non-Goals (explicitly cut)**
- No automated voice agent answering the phone.
- No Twilio number, no SIP routing, no Vapi.
- No SMS/voicemail deflection.
- No EMR integration in v1.
- No multi-tenant; single clinic only in v1.
- No mobile app; desktop browser only.

## 3. Approach

Single Next.js 15 web app deployed on Vercel Enterprise. Friend opens it on a clinic PC during calls, holds the phone next to a USB headset (or speakerphone). Browser captures patient audio via mic, transcribes Spanish, translates to English on screen. Friend types English; app translates to Spanish, speaks it via realistic TTS, audio routes back through the headset into the phone.

Single phase, no follow-on voice-agent work in this spec.

## 4. Architecture

### 4.1 Frontend
- Next.js 15 App Router, React 19, TypeScript strict.
- Tailwind v4 + shadcn/ui.
- Zustand for session state (in-memory transcript).
- TanStack Query for server-state.
- Two-pane layout:
  - **PatientPane (left):** waveform, live ES transcript with EN translation under each utterance, urgency-flag dropdown.
  - **StaffPane (right):** EN textarea, ES preview line, send/play button. `Cmd+Enter` submits.
- Always-visible status pill: 🟢 ready / 🟡 degraded / 🔴 offline.
- Auto-save partial transcript to DB every 5s for crash/refresh recovery.

### 4.2 Backend (Vercel Functions)
- `app/api/stt/route.ts` — Edge runtime, WebSocket proxy to Deepgram Nova-3 ES streaming.
- `app/api/translate/route.ts` — Node runtime, calls AWS Bedrock Claude Sonnet 4.6.
- `app/api/tts/route.ts` — Node runtime, Google Cloud TTS Chirp 3 HD `es-US-Chirp3-HD-Achernar`.
- `app/api/sessions/*` — CRUD over calls + utterances (Drizzle).
- `app/api/auth/*` — Supabase Auth via NextAuth bridge, Google OIDC, clinic-domain allowlist.

### 4.3 Database (Supabase Postgres + Drizzle)

```ts
patients: id, callback_phone_enc, name_enc, dob_last4_enc,
  preferred_dialect, notes_enc, created_at, last_seen_at
calls: id, patient_id, source ('desktop'), started_at, ended_at,
  urgency, outcome, staff_user_id
utterances: id, call_id, role ('patient'|'staff'), lang ('es'|'en'),
  text_enc, translation_enc, ts, audio_storage_key
staff_users: id, email, name, role, last_login_at, active
glossary_terms: id, en, es, dialect, category, created_by
audit_log: id, actor_id, action, target_type, target_id, ts, ip_addr
```

- PHI columns encrypted with `pgcrypto` `pgp_sym_encrypt`, key from Vercel env, rotated quarterly.
- Drizzle ORM via `drizzle-orm/postgres-js`, migrations in `drizzle/migrations/`.
- Row-Level Security enabled on every table; staff users see only their clinic.
- `audit_log` insert trigger fires on read/write of patient/call/utterance rows.

### 4.4 Realtime
- Supabase Realtime channels for cross-tab sync (e.g. friend opens app on second PC, sees same active session).

### 4.5 Storage
- Supabase Storage private bucket `recordings/` for any saved call audio (off by default; opt-in per clinic).
- 90-day auto-delete via scheduled function.

## 5. Data Flow

### 5.1 Patient ES → Staff EN
1. Friend clicks **Start**; browser requests mic.
2. `MediaRecorder` opens 16kHz mono PCM stream.
3. 100ms chunks streamed to `/api/stt` WS → Deepgram Nova-3 (`language=es`, `interim_results=true`, `endpointing=500`, `smart_format=true`).
4. Partials render greyed in PatientPane; finals freeze.
5. Final ES utterance POSTed to `/api/translate` `{text, src:'es', dst:'en'}` → Bedrock Claude returns `{translation, glossary_hits}`.
6. EN translation rendered under ES; glossary hits highlighted.
7. Drizzle insert into `utterances` (encrypted), audit log.

### 5.2 Staff EN → Patient ES
1. Friend types EN, hits `Cmd+Enter`.
2. POST `/api/translate` `{text, src:'en', dst:'es'}` → ES preview shown 1.5s (cancellable).
3. POST `/api/tts` `{text, voice:'Achernar'}` → Google TTS Chirp 3 HD MP3.
4. KV cache check on `hash(text+voice)` — hit returns instantly; miss writes cache.
5. MP3 streamed to `AudioContext`, plays through default audio out.
6. Drizzle insert into `utterances` (encrypted EN + ES), audit log.

### 5.3 Latency targets
- ES partial → screen: <300ms
- ES final → EN translation: <800ms
- EN typed → ES audio start: <1.2s cold, <200ms cached

## 6. Components

### Frontend
- `app/page.tsx` — split-pane shell.
- `components/PatientPane.tsx`
- `components/StaffPane.tsx`
- `components/AudioPlayer.tsx` — wraps `AudioContext`, queues, supports barge-in.
- `components/StatusPill.tsx`
- `components/UrgencyFlag.tsx`
- `components/GlossaryHit.tsx`
- `lib/session.ts` — Zustand store for live transcript.
- `lib/medical-glossary.ts` — static ES↔EN clinic-specific overrides, dialect-tagged.

### Backend
- `lib/db/schema.ts` — Drizzle schema (above).
- `lib/db/client.ts` — Drizzle client, scoped per request.
- `lib/crypto.ts` — `encryptPHI` / `decryptPHI` helpers.
- `lib/anthropic.ts` — Bedrock Claude client.
- `lib/google-tts.ts` — Google TTS client + KV cache.
- `lib/deepgram.ts` — Deepgram WS factory.
- `lib/audit.ts` — central audit log writer.

### Auth
- `app/(auth)/*` — NextAuth Google OIDC, allowlist by email domain. Session stored in Supabase Auth; bridged to Drizzle `staff_users`.

## 7. Error Handling

| Failure | Detection | Behavior |
|---|---|---|
| Mic permission denied | `getUserMedia` reject | Modal: "Allow mic to translate." Block Start. |
| Mic muted (RMS <-50dB 8s) | Audio analyzer | Banner "no audio detected"; stream stays open. |
| Deepgram WS drop | `onclose` | Exp backoff (250ms→4s, 5x). Failover to chunked Whisper-on-Azure-BAA POST. |
| Translate 5xx/timeout >4s | fetch reject | Retry 1x; second fail → inline "translation unavailable, retry?" button. |
| Translate 429 | rate limit | Queue + retry, visible spinner. |
| TTS failure | non-200 | Fallback: Google TTS Standard voice (still BAA) → if also fails, "voice unavailable, type to patient". |
| AudioContext suspended | browser autoplay policy | Banner "click anywhere to enable audio". |
| Claude refusal | response pattern | Audit `translate_refused`, surface "translation blocked — rephrase". |
| DB write fail | Drizzle throws | Queue in IndexedDB, retry every 30s, banner "saving paused". |
| Realtime drop | channel `closed` | Auto-rejoin every 5s; poll fallback. |
| Browser crash/refresh | beforeunload | Auto-save every 5s, resume URL `/?session=<id>`. |
| Network offline | `navigator.onLine=false` | Banner "offline, paused". |
| Wrong language detected | DG conf <0.6 or Claude detects | "Language unclear — confirm Spanish?" toggle, EN→EN passthrough option. |
| Encryption key missing/rotated | decrypt null | Hard fail + alert; never show garbled text. |

Cross-cutting: `try/catch` wrapping every route, `{code, message, retryable, traceId}` JSON. Sentry Business plan with `beforeSend` PHI scrubber. Status pill always visible.

## 8. Security & Compliance

- **HIPAA covered entity** assumed (confirm with friend).
- All vendors with BAAs signed before pilot (see §10).
- PHI columns encrypted at app layer with `pgcrypto`; Postgres at-rest encryption on top.
- Secrets in Vercel env + AWS Secrets Manager, no `.env` committed.
- ESLint custom rule `no-phi-log` bans `console.log` of `text|translation|name|phone|dob` keys.
- Gitleaks pre-commit + GH Actions secret scan.
- TLS-only, HSTS, strict CSP.
- 7-year transcript retention (Texas medical record rule); 90-day audio.
- `audit_log` immutable (`REVOKE UPDATE,DELETE` on table).
- Quarterly access review, sample 5% of audit log.
- Pen test before pilot launch (Cobalt or HackerOne).
- Auth: clinic-domain email allowlist; MFA required.

## 9. Testing

### Unit (Vitest)
- `lib/crypto.ts` round-trip + key rotation.
- `lib/medical-glossary.ts` substitution + dialect priority.
- `lib/session.ts` append + resume + partial overwrite.
- API client wrappers (msw mocks).
- Drizzle helpers + schema constraints + cascade.

### Integration (Vitest + Testcontainers Postgres)
- `/api/translate` glossary injection + lang lock.
- `/api/tts` cache hit on repeated input.
- `/api/stt` WS frame proxy.
- Auth allowlist enforced.
- Encryption-at-rest verified by direct Postgres query.

### E2E (Playwright, fake audio device)
- Phase 1 happy path: mic → ES transcript → EN translation → type EN → ES audio plays.
- Reconnect: kill DG WS mid-stream, no transcript loss.
- Translate fail: msw 500 → retry button + audit.
- Crash recovery: refresh mid-call → resume session.

### Voice quality
- 50-utterance ES reference set covering MX / Central American / Caribbean dialects.
- Compare Chirp 3 HD Achernar vs Algenib vs Polly Generative Lupe via 5-listener MOS rating; pick highest.
- CI guard: `whisper.cpp` round-trip on cached vs new TTS, WER drift >5% fails build.

### Translation quality
- Golden set `tests/fixtures/translation-pairs.jsonl`, 200 medical phrases.
- BLEU + chrF gate in CI; new prompt drop blocks merge.
- 30-phrase adversarial set for false cognates, regional slang, drug brands.

### Latency (k6)
- `/api/translate` p50 <500ms, p95 <1.2s.
- `/api/tts` p50 <300ms cached, <800ms cold.
- STT first-partial <400ms.

### Pilot acceptance
- 2-week pilot, 20-50 calls, daily 5-min retro.
- Success: ≥85% calls completed without staff fallback, mean call <8min, zero PHI incidents.
- Patient post-call survey via SMS: "¿Sonó natural?" 1-5, target ≥4.0 mean.

## 10. Vendors & BAA

| Vendor | Use | BAA | $/mo @ 50 calls/day |
|---|---|---|---|
| Vercel Enterprise | Hosting | Sales BAA | ~$300 |
| Supabase Team | Postgres + Auth + Realtime + Storage | BAA same-day | $599 |
| AWS Bedrock | Claude Sonnet 4.6 translate | AWS BAA standard | ~$80 |
| Deepgram | STT Nova-3 ES streaming | BAA on Growth (~1wk) | ~$120 |
| Google Cloud | TTS Chirp 3 HD ES | BAA via GCP customer agreement | ~$60 |
| Sentry Business | Error tracking | BAA console | $80 |
| **Total** | | | **~$1.2k/mo** |

**BAA procurement order:**
1. Twilio — N/A (cut from scope)
2. Supabase Team — same-day
3. Google Cloud — 1 day
4. AWS Bedrock — instant
5. Sentry Business — same-day
6. Deepgram Growth — ~1 week
7. Vercel Enterprise — 1-2 weeks (longest pole; dev with synthetic data until signed)

**Fallbacks if a BAA stalls:**
- Vercel BAA delay → self-host Next.js on AWS Fargate (BAA standard).
- Deepgram BAA delay → Whisper-on-Azure-OpenAI (BAA standard).

## 11. Out of Scope (v1)

- Automated voice agent / Vapi / Pipecat.
- Twilio phone number / SIP / SMS.
- EMR integration (Epic, Athena, etc.).
- Mobile app.
- Multi-tenant.
- After-hours coverage.
- Languages other than ES↔EN.
- Real-time speaker diarization.

## 12. Open Questions for Friend

(Send these before kickoff; answers reshape decisions.)

1. Is clinic a HIPAA covered entity?
2. Calls/day from ES-only patients? Peak hour?
3. Current phone setup (landline, VoIP, cell)?
4. EMR/PMS in use?
5. Top call reasons (rank): appointment / refill / results / billing / intake / hours / urgent symptoms.
6. Spanish dialect base (MX / Central American / Caribbean)?
7. Other languages needed (Mam, K'iche', Vietnamese)?
8. Recording calls OK (TX one-party)?
9. Compliance officer / counsel to sign BAAs?
10. Headset on each PC, or speakerphone next to handset?
11. Monthly budget ceiling?
12. Pilot timeline?

## 13. Milestones

- **D0 (today):** spec approved.
- **D1:** repo scaffolded (Next.js + Supabase + Drizzle + auth), schema + migrations applied to staging.
- **D2:** STT route + PatientPane shipping live ES transcript end-to-end.
- **D3:** Translate route + glossary, EN translation under utterances.
- **D4:** StaffPane + TTS + AudioPlayer, full round-trip working.
- **D5:** Error handling + status pill + crash recovery + audit log.
- **D6:** E2E + voice quality eval + perf gate green.
- **D7:** Internal walk-through, fix list.
- **W2:** Pilot at clinic, 20-50 calls, retros + tuning.

## 14. References

- HIPAA Security Rule §164.312
- Texas medical records retention: TAC §165.1
- Vercel BAA: <https://vercel.com/legal/baa>
- Supabase BAA: <https://supabase.com/security>
- AWS BAA: <https://aws.amazon.com/compliance/hipaa-compliance/>
- Deepgram BAA: <https://deepgram.com/security>
- Google Cloud HIPAA: <https://cloud.google.com/security/compliance/hipaa>
