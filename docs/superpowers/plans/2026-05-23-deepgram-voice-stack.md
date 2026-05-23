# Deepgram Unified Voice Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and verify a cost-first voice pipeline where Deepgram Nova-3 handles STT and Deepgram Aura-2 handles TTS, with OpenAI (dev) or Bedrock (prod) for translation — no Google TTS required for the default path.

**Architecture:** Browser mic → `/api/stt` WebSocket → Deepgram Nova-3 → `/api/translate` → LLM → `/api/tts` → `lib/providers/clients/deepgram-tts.ts` → Deepgram Aura `/v1/speak` → MP3 to speaker. Provider selection lives in `clinic_settings` via presets in `lib/providers/presets.ts`; the dispatcher in `lib/providers/clients.ts` routes TTS by `config.provider`.

**Tech Stack:** Next.js 15 App Router, Deepgram REST + WebSocket, `@deepgram/sdk` (browser STT token path), Vitest, Vercel Hobby, Neon Postgres, NextAuth v5.

---

## File map

| File | Role |
|------|------|
| `lib/providers/clients/deepgram-tts.ts` | Deepgram Aura TTS client (already exists) |
| `lib/providers/clients.ts` | TTS dispatcher — `case "deepgram"` (already wired) |
| `lib/providers/presets.ts` | Default STT+TTS = Deepgram (already updated) |
| `lib/providers/registry.ts` | Aura voice catalog for admin UI |
| `app/api/tts/route.ts` | POST handler — uses `dispatchSynthesize` |
| `app/api/stt/route.ts` | Edge WS bridge to Deepgram |
| `.env.example` | Env var docs (needs update) |
| `tests/unit/providers-clients.test.ts` | Dispatcher routing tests |

---

### Task 1: Refresh env docs for unified Deepgram key

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example` comments**

Replace the Deepgram and OpenAI sections with:

```bash
# Deepgram (STT Nova-3 + TTS Aura-2 — one key for both)
DEEPGRAM_API_KEY=

# OpenAI (dev translate/suggest only; optional if using Bedrock)
OPENAI_API_KEY=

# Google Cloud TTS (optional fallback — not used by default presets)
GOOGLE_APPLICATION_CREDENTIALS=
GCP_TTS_VOICE=es-US-Chirp3-HD-Achernar
```

- [ ] **Step 2: Update README Setup section**

Add under required env keys:

```markdown
For the default dev preset: `DEEPGRAM_API_KEY` (STT + TTS) and `OPENAI_API_KEY` (translate).
Bedrock keys are only needed for production presets (fast/balanced/accurate with Claude).
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document unified Deepgram STT+TTS env vars"
```

---

### Task 2: Fix test runner (jsdom missing)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jsdom dev dependency**

```bash
npm install -D jsdom
```

- [ ] **Step 2: Run unit tests**

```bash
npm run test -- tests/unit/providers-clients.test.ts tests/unit/providers-registry.test.ts
```

Expected: all tests PASS (including `routes deepgram provider to the Deepgram Aura TTS client`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jsdom so vitest can run"
```

---

### Task 3: Add Deepgram TTS unit test file

**Files:**
- Create: `tests/unit/deepgram-tts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import {
  synthesizeDeepgram,
  __setDeepgramTtsFetchForTest,
} from "@/lib/providers/clients/deepgram-tts";
import { TTSError } from "@/lib/api/errors";

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x44]);

describe("deepgram-tts", () => {
  afterEach(() => {
    __setDeepgramTtsFetchForTest(null);
    delete process.env.DEEPGRAM_API_KEY;
  });

  it("throws TTSError when DEEPGRAM_API_KEY is missing", async () => {
    await expect(
      synthesizeDeepgram({
        text: "hola",
        voice: "aura-2-javier-es",
        engine: "aura-2",
      }),
    ).rejects.toBeInstanceOf(TTSError);
  });

  it("POSTs to /v1/speak with model and returns mp3 buffer", async () => {
    process.env.DEEPGRAM_API_KEY = "test-key";
    let capturedUrl = "";
    __setDeepgramTtsFetchForTest(async (url, init) => {
      capturedUrl = String(url);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Token test-key",
      );
      return new Response(FAKE_MP3, { status: 200 });
    });

    const result = await synthesizeDeepgram({
      text: "Buenos días",
      voice: "aura-2-javier-es",
      engine: "aura-2",
    });

    expect(capturedUrl).toContain("model=aura-2-javier-es");
    expect(capturedUrl).toContain("encoding=mp3");
    expect(result.audio.equals(FAKE_MP3)).toBe(true);
    expect(result.voice).toBe("aura-2-javier-es");
  });
});
```

- [ ] **Step 2: Run test**

```bash
npm run test -- tests/unit/deepgram-tts.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/deepgram-tts.test.ts
git commit -m "test: cover Deepgram Aura TTS client"
```

---

### Task 4: Update stale TTS route header comment

**Files:**
- Modify: `app/api/tts/route.ts:1-6`

- [ ] **Step 1: Replace file header comment**

```typescript
// Track B2. POST /api/tts — provider-dispatched synthesis (Deepgram Aura default).
// Spec §4.2, §5.2 step 3-4, §7 (TTS failure → fallback voice).
//
// Body: { text, voice?, sessionId? }
// Response: audio/mpeg stream + Cache-Control private 24h.
// Errors:   JSON { code, message, retryable, trace_id } + 5xx status.
```

- [ ] **Step 2: Commit**

```bash
git add app/api/tts/route.ts
git commit -m "docs: TTS route comment reflects Deepgram default"
```

---

### Task 5: Manual smoke test — full call loop

**Files:** none (manual verification)

- [ ] **Step 1: Set env and start dev server**

```bash
cp .env.example .env.local
# fill: DATABASE_URL, NEXTAUTH_SECRET, DEEPGRAM_API_KEY, OPENAI_API_KEY
# add CLINIC_EMAIL_ALLOWLIST or use /api/dev-login in development
npm run dev
```

- [ ] **Step 2: Log in and open `/app`**

Expected: split-pane translator loads, status pill visible.

- [ ] **Step 3: Start session — speak Spanish into mic**

Expected: partial Spanish text appears in PatientPane within ~300ms; final transcript freezes grey → black.

- [ ] **Step 4: Confirm English translation appears**

Expected: translation line under Spanish utterance within ~800ms.

- [ ] **Step 5: Type English reply, send**

Expected: Spanish preview → MP3 plays through speaker. Response header `x-tts-voice: aura-2-javier-es` (or active preset voice).

- [ ] **Step 6: Check server logs on TTS failure**

If Deepgram returns 401/403: verify `DEEPGRAM_API_KEY` has TTS/Aura access on your Deepgram project.

---

### Task 6: Optional — TTS response cache for Deepgram

**Files:**
- Modify: `lib/providers/clients/deepgram-tts.ts`

Skip this task if YAGNI — Google TTS has KV cache; Deepgram does not yet. Only implement if repeated phrases cause noticeable cost/latency.

- [ ] **Step 1: Write failing cache test in `tests/unit/deepgram-tts.test.ts`**

Add test that second call with same text+voice returns `cacheHit: true` when KV stub is set (mirror pattern from `lib/google-tts.ts` `__setKvForTest`).

- [ ] **Step 2: Extract shared cache helper or inline sha256 key `tts:deepgram:${hash}` in `deepgram-tts.ts`**

- [ ] **Step 3: Run tests and commit**

---

### Task 7: Free-tier deploy checklist (Vercel Hobby + Neon)

**Files:**
- Create: `docs/superpowers/plans/2026-05-23-free-tier-deploy-checklist.md` (optional one-pager)

- [ ] **Step 1: Vercel env vars (Production + Preview)**

```
DATABASE_URL          # Neon pooled connection string
DIRECT_URL            # Neon direct (migrations)
NEXTAUTH_URL          # https://your-app.vercel.app
NEXTAUTH_SECRET       # openssl rand -base64 32
DEEPGRAM_API_KEY
OPENAI_API_KEY        # or Bedrock keys for prod presets
GOOGLE_CLIENT_ID      # if using Google OAuth
GOOGLE_CLIENT_SECRET
CLINIC_EMAIL_ALLOWLIST
```

- [ ] **Step 2: Deploy**

```bash
vercel --prod
```

- [ ] **Step 3: Run migrations against Neon**

```bash
npm run db:migrate
```

- [ ] **Step 4: Smoke test on production URL** — repeat Task 5 steps on HTTPS (mic requires secure context).

---

## Self-review

| Spec requirement | Task |
|------------------|------|
| Deepgram STT streaming | Already in `app/api/stt/route.ts` — Task 5 verifies |
| Deepgram TTS Spanish | `deepgram-tts.ts` + presets — Tasks 3, 5 verify |
| Cost-first / no HIPAA | Documented in AGENTS.md; Task 7 deploys free tiers |
| Provider dispatcher | Task 2–3 tests |
| Admin voice catalog | Registry already lists Aura voices — no task needed |

No placeholders remain. Types consistent: `TtsProvider` uses `{ provider: "deepgram"; voice: string; engine: "aura-2" }` throughout.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-23-deepgram-voice-stack.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — run tasks in this session with checkpoints

Which approach?
