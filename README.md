# Clinic Translator

Real-time Spanish to English translator built for clinic phone triage. A patient calls in speaking Spanish. Staff use this app to read what the patient is saying in English, type a reply in English, and have that reply played back to the patient as natural Spanish audio. Round trip stays under two seconds on a decent connection.

Staff drive everything. No automated voice agent. Nothing sends without an explicit click.

<img width="1168" height="618" alt="image" src="https://github.com/user-attachments/assets/8d78da68-7ea6-4c9a-aec4-611fd92638b4" />


## How it works

Staff click Start Call. The browser asks for mic access and opens a WebSocket to Deepgram Nova-3, which streams Spanish speech to text in real time. Partials show up greyed out as the patient talks. Once Deepgram finalizes an utterance, the transcript locks in and the translation pipeline picks it up.

The English translation drops in below each Spanish line. Any medical terms the clinic has glossary entries for get highlighted so staff can spot them at a glance.

When staff are ready to reply, they type English and hit Cmd+Enter. The app translates to Spanish, hands the text to Deepgram Aura-2 for TTS, and plays the audio out the default audio device. Staff hear what the patient hears before it leaves the room. There is also an AI suggestion engine that drafts a short English reply based on the conversation so far, but it never sends on its own. Staff accept, edit, or dismiss.

Urgency detection runs the whole time. If the patient says anything matching the emergency keyword set (cardiac, respiratory, bleeding, obstetric, trauma), the call gets flagged urgent, a soft alert plays, and the AI nudges toward escalation language.

## Stack

| Layer | What it uses |
|---|---|
| Frontend | Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui |
| State | Zustand for the live session, TanStack Query for server state, IndexedDB for crash recovery |
| Backend | Node.js 22, Drizzle ORM, Neon Postgres, NextAuth v5 |
| STT | Deepgram Nova-3 over WebSocket |
| TTS | Deepgram Aura-2, MP3 cached by hash |
| Translation | Groq Llama 3.3 70B by default, AWS Bedrock Claude as a fallback path |
| AI assist | Groq Llama 3.3 70B streamed over SSE, staff-gated |
| Encryption | AES-256-GCM on every PHI column |
| Hosting | Vercel Enterprise with BAA |
| Observability | Sentry (optional, scrubs PHI before send) |
| Testing | Vitest for unit and integration, Playwright for end to end |

## Project structure

```
clinic-translator/
├── app/
│   ├── (auth)/                 Public auth routes (login, signup)
│   ├── (admin)/                Protected admin routes (settings)
│   ├── app/                    Main translator UI (protected)
│   │   ├── page.tsx            Split pane shell, PatientPane left, StaffPane right
│   │   └── sessions/           Call history list and session detail
│   ├── api/
│   │   ├── auth/               NextAuth handler, email signup, STT JWT
│   │   ├── sessions/           Call CRUD, end session, persist utterances
│   │   ├── stt/                Deepgram WebSocket proxy and token
│   │   ├── translate/          Translation plus glossary injection
│   │   ├── tts/                TTS synthesis and preview
│   │   ├── suggest/            AI reply suggestions over SSE, outcome tracking
│   │   ├── glossary/           Medical term lookup
│   │   └── settings/           Clinic config read and write
│   ├── layout.tsx
│   ├── page.tsx                Landing page (unauthenticated)
│   └── globals.css
│
├── components/
│   ├── PatientPane.tsx         Left pane: ES transcript and urgency selector
│   ├── StaffPane.tsx           Right pane: EN composer, TTS preview, suggestions
│   ├── SuggestionGhost.tsx     Ghost text preview of the AI draft
│   ├── SuggestionChips.tsx     Accept, edit, or dismiss controls
│   ├── UrgencyAlert.tsx        Banner that fires on urgent keyword match
│   ├── CallbackVerifyCard.tsx  Pulls the patient's callback number out of the transcript
│   ├── CorrectionPopover.tsx   Right click any transcript token to edit it inline
│   ├── StatusPill.tsx          Live connection indicator (ready, degraded, offline)
│   └── ui/                     shadcn/ui primitives
│
├── lib/
│   ├── db/
│   │   ├── schema.ts           Full Drizzle schema, 7 tables plus NextAuth tables
│   │   └── client.ts           Lazy per request Drizzle client
│   ├── auth/
│   │   ├── config.ts           NextAuth v5 config (Google plus credentials)
│   │   ├── allowlist.ts        Email domain whitelist enforcement
│   │   ├── password.ts         bcrypt helpers
│   │   └── roles.ts            owner, staff, admin enums
│   ├── providers/
│   │   ├── registry.ts         Vendor catalog for STT, translate, TTS, suggest
│   │   ├── presets.ts          Latency mode configs (fast, balanced, accurate)
│   │   ├── clients.ts          Provider dispatcher
│   │   └── clients/            Vendor specific clients (Deepgram, Groq, Bedrock, etc.)
│   ├── edge/
│   │   ├── urgency-keywords.ts Emergency phrase detection plus audio alert
│   │   ├── silence-detector.ts No audio for 8 seconds, fires a nudge
│   │   ├── hangup-detect.ts    No activity for 3 minutes, auto ends the call
│   │   ├── callback-verify.ts  Extracts E.164 phone numbers from ES transcript
│   │   ├── multi-speaker.ts    Heuristic for more than one voice
│   │   ├── correction.ts       Transcript token correction
│   │   ├── code-switch.ts      Detects mixed ES and EN
│   │   └── ...                 Profanity filter, number normalization, replay buffer
│   ├── hooks/
│   │   ├── useStt.ts           STT streaming hook
│   │   ├── useTranslate.ts     Translation mutation
│   │   ├── useTts.ts           TTS playback
│   │   ├── useSuggest.ts       AI suggestion stream and outcome
│   │   └── useClinicSettings.ts
│   ├── crypto.ts               AES-256-GCM encrypt and decrypt for all PHI
│   ├── audit.ts                Immutable audit log writer
│   ├── session.ts              Zustand store plus IndexedDB crash recovery
│   ├── medical-glossary.ts     Static ES to EN medical term set, around 40 terms
│   ├── clinic-prompts.ts       System prompt builder for AI suggestions
│   └── escalation-rules.ts     Trigger rules for urgent escalation
│
├── tests/
│   ├── unit/                   Vitest: crypto, glossary, urgency, session, providers
│   ├── integration/            Vitest: translate API, TTS cache, auth allowlist
│   ├── e2e/                    Playwright: full call round trip, crash recovery
│   └── fixtures/               translation-pairs.jsonl
│
├── eslint-rules/
│   └── no-phi-log.js           Custom rule, bans console.log of PHI field names
│
├── drizzle/                    Database migrations
├── public/worklets/stt-pcm.js  AudioWorklet, 100ms PCM framing for Deepgram
└── middleware.ts               Protects /app/* and /settings/* routes
```

## Database schema

Seven tables. Anything that could identify a patient (name, phone, transcript, translation, notes) is encrypted at the application layer with AES-256-GCM before it hits Postgres.

`patients`. Patient records. Encrypted: name, callback phone, last 4 of DOB, notes.

`calls`. One row per phone call. Tracks the staff member who took it, urgency level (low, normal, high, urgent), and outcome (completed, transferred, voicemail, dropped, fallback).

`utterances`. Every spoken or typed message. Encrypted ES text and EN translation. Role is patient or staff. The AI suggestion columns live here too: suggestion text, confidence score, outcome (accepted, edited, dismissed), and an escalate flag.

`staff_users`. Clinic staff accounts with role (owner, staff, admin).

`glossary_terms`. Per clinic medical term overrides. Supports dialect tagging (Mexican, Central American, Caribbean) and category (drug, procedure, intake, billing, scheduling).

`clinic_settings`. One row per clinic. Provider configs as JSONB for STT, translate, TTS, and suggest. Latency mode, dialect preference, clinic name, hours, services, FAQs, transfer phone, escalation rules.

`audit_log`. Immutable. Every read and write of patient, call, and utterance data, plus auth events and decryption failures. UPDATE and DELETE are revoked at the database level so the trail cannot be rewritten.

## Call data flow

Patient speaking, Spanish to English:

1. Staff click Start Call. `POST /api/sessions` creates a call record.
2. Browser opens the mic at 16kHz mono and sends 100ms PCM chunks over the WebSocket to `/api/stt`.
3. Deepgram Nova-3 returns partials (greyed) and finals (locked).
4. Finals hit `POST /api/translate`. Groq Llama translates and glossary terms get injected.
5. The English translation renders in PatientPane right under the Spanish source.
6. Utterance writes to the database with both texts encrypted. Audit log entry follows.

Staff replying, English to Spanish:

1. Staff type and press Cmd+Enter.
2. `POST /api/translate` with `src:'en'` and `dst:'es'` returns the Spanish preview.
3. `POST /api/tts` sends `{text, voice:'Achernar'}` to Deepgram Aura-2 and gets back MP3.
4. Cache check on `hash(text + voice)`. Hit returns instantly. Miss writes the cache.
5. The MP3 plays through AudioContext to the default audio output.
6. Both English and Spanish utterances write to the database, encrypted. Audit log entry follows.

AI suggestions:

1. After each patient utterance, `POST /api/suggest` opens an SSE stream.
2. Groq Llama drafts a short English reply with a confidence score and an escalate flag.
3. The draft shows up as ghost text in StaffPane.
4. Staff accept, edit, or dismiss. The choice writes to `utterances.suggestion_outcome`.
5. The suggestion does not send on its own. Ever.

## Security and HIPAA

Encryption uses AES-256-GCM with a 32 byte key from `PHI_ENCRYPTION_KEY`. Format is `IV (12 bytes) || ciphertext || auth tag (16 bytes)`. Applied to every field that could identify a patient before any database write.

The audit trail logs every access and modification with actor, action, target, timestamp, and IP. UPDATE and DELETE on `audit_log` are revoked at the database role level.

A custom ESLint rule (`eslint-rules/no-phi-log.js`) blocks `console.log` calls that reference `text`, `translation`, `name`, `phone`, or `dob`. Enforced at lint time so PHI never lands in logs.

Sentry is optional. When enabled, the `beforeSend` hook strips PHI shaped fields before events leave the server.

All `/app/*` and `/settings/*` routes are gated by NextAuth middleware. Staff have to be on the clinic's email allowlist via `CLINIC_EMAIL_ALLOWLIST`.

## Provider system

The provider registry in `lib/providers/registry.ts` decouples the app from any one vendor. Each category (STT, translate, TTS, suggest) lists the available vendors, and the active selection lives per clinic in `clinic_settings`. Swapping a provider is a settings change, not a code change.

Latency presets handle the quality vs cost tradeoff:

- Fast: Deepgram Nova-3, Groq Llama 3.1 8B, Deepgram Aura-2. Lowest latency.
- Balanced (default): Deepgram Nova-3, Groq Llama 3.3 70B, Deepgram Aura-2.
- Accurate: same stack with higher temperature and beam settings for messy audio.

Stubs exist for vendors we have not wired up yet (Google Speech, Azure OpenAI, DeepL, Cartesia, ElevenLabs, Polly). They throw `ProviderNotImplementedError` if selected. They show up in the admin UI so they can be turned on later without touching the rest of the codebase.

## Real-time edge processors

These run client side on the live audio and transcript:

| Processor | When it fires | What it does |
|---|---|---|
| `urgency-keywords` | Around 40 emergency phrases in Spanish | Bumps urgency to urgent, plays an alert tone, suggests a transfer |
| `silence-detector` | No audio for 8 seconds | Prompts staff to send a Spanish check in |
| `hangup-detect` | No activity for 3 minutes | Auto ends the call |
| `callback-verify` | Phone number pattern in ES transcript | Surfaces a card so staff can confirm the number |
| `multi-speaker` | Inter utterance pause pattern | Flags a possible second voice on the patient line |
| `correction` | Right click on a transcript token | Inline edit popover, updates the translation |
| `code-switch` | Mixed ES and EN in one utterance | Flags for re translation |

## Getting started

```sh
git clone <repo-url> clinic-translator
cd clinic-translator
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
# http://localhost:3000
```

For local dev without Google OAuth, use the dev login bypass at `/api/dev-login`.

Required environment variables:

```
# Auth
NEXTAUTH_SECRET=          # any random string
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
CLINIC_EMAIL_ALLOWLIST=   # comma separated, supports *@clinic.com wildcards

# Voice APIs
DEEPGRAM_API_KEY=         # STT (Nova-3) and TTS (Aura-2)
GROQ_API_KEY=             # Translation and AI suggestions

# PHI encryption
PHI_ENCRYPTION_KEY=       # base64 encoded 32 random bytes

# Database
DATABASE_URL=             # Neon Postgres connection string

# Optional
SENTRY_DSN=
```

To generate `PHI_ENCRYPTION_KEY`:

```sh
openssl rand -base64 32
```

## Scripts

```sh
npm run dev              # Development server on :3000
npm run build            # Production build
npm run start            # Production server
npm run lint             # ESLint, includes the no-phi-log rule
npm run typecheck        # TypeScript strict check
npm run test             # Vitest, unit and integration
npm run test:e2e         # Playwright on Chromium

npm run db:generate      # Generate a Drizzle migration from schema changes
npm run db:migrate       # Apply pending migrations
npm run db:studio        # Drizzle Studio GUI
```

## Testing

Unit tests in `tests/unit/` cover the AES round trip and key rotation, glossary substitution with dialect priority, the Zustand session store (append, resume, partial overwrite), urgency keyword detection and audio alerts, silence detection, the correction popover, and the provider registry dispatch.

Integration tests in `tests/integration/` hit the real API routes against a test database. Translation with glossary injection, TTS cache hit on repeated input, auth allowlist enforcement, and encryption at rest verified by querying Postgres directly.

End to end tests in `tests/e2e/happy-path.spec.ts` use Playwright with a fake audio device. The full call round trip (mic to ES transcript to EN translation to typed EN to ES audio playing). A Deepgram WebSocket disconnect mid stream with no transcript loss. A 500 from the translate API with a retry button. A browser refresh mid call with session recovery from IndexedDB.

## Deployment

Hosted on Vercel with Neon Postgres. Vercel Enterprise is required for the HIPAA BAA. The STT WebSocket proxy runs on Vercel Edge. Translation, TTS, and suggest run on Node.js.

Rough cost at 50 calls a day: Vercel around $300, Deepgram around $120, Groq around $30, Neon around $50, Sentry around $80. A free tier setup (Neon free, Deepgram growth tier) works fine for a pilot.
