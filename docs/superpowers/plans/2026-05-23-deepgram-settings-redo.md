# Deepgram-Only Settings Page Redo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered multi-vendor Providers tab with a simple Deepgram-first settings UI — one API key for hearing and speaking — and fix stale labels/data so the page matches reality.

**Architecture:** Keep the existing four-provider backend (`stt`, `translate`, `tts`, `suggest` jsonb on `clinic_settings`). The UI hides vendor choice for voice: STT and TTS are locked to Deepgram with selectable model/voice only. Translate and suggest stay on OpenAI (dev) or Bedrock (prod presets) but move off the main Providers tab into a collapsed "Translation (LLM)" section — Deepgram does not offer standalone text translation in the current app architecture. Cost estimator reads only Deepgram catalog entries for voice.

**Tech Stack:** Next.js 15, React 19, TanStack Query, shadcn/ui, Drizzle, existing `PROVIDER_REGISTRY` + `LATENCY_PRESETS`.

**Out of scope:** Migrating to Deepgram Voice Agent API (single WebSocket for STT+LLM+TTS). That is a separate architecture change (~$4.50/hr bundled). This plan is UI + defaults only.

---

## Why the screenshot looks wrong today

| Problem | Cause |
|---------|-------|
| Latency cards say "Cartesia / Polly / Chirp 3 HD" | Hardcoded strings in `LatencyModeCard` — not updated when presets switched to Deepgram |
| STT shows "OpenAI Whisper (dev)" | `clinic_settings` row in DB still has old `dev-openai` blobs from before preset change |
| Cost shows TTS $0.045 for non-Deepgram voice | DB TTS provider ≠ current presets |
| Dropdown lists 5 STT vendors | UI iterates full `PROVIDER_REGISTRY.stt` |

---

## File map

| File | Change |
|------|--------|
| `app/(admin)/settings/page.tsx` | Redesign Providers tab — Deepgram-only voice, fix labels |
| `lib/providers/presets.ts` | Already Deepgram STT+TTS — verify labels match UI |
| `lib/settings.ts` | Default seed uses Deepgram — add one-time migration helper |
| `app/api/settings/migrate-deepgram/route.ts` | **Create** — admin POST to reset provider blobs to balanced preset |
| `lib/providers/registry.ts` | Add `DEEPGRAM_ONLY_UI` filter helper (optional) |

---

### Task 1: Fix hardcoded latency card labels

**Files:**
- Modify: `app/(admin)/settings/page.tsx` (~lines 324–336)

- [ ] **Step 1: Replace `labels` in `LatencyModeCard`**

```typescript
const labels: Record<LatencyMode, { title: string; sub: string; p50: string }> = {
  fast: { title: "Fast", sub: "Deepgram Celeste + Haiku 4.5", p50: "~600 ms" },
  balanced: {
    title: "Balanced (recommended)",
    sub: "Deepgram Javier + Haiku 4.5",
    p50: "~800 ms",
  },
  accurate: {
    title: "Accurate",
    sub: "Deepgram Estrella + Sonnet 4.6",
    p50: "~1.2 s",
  },
};
```

- [ ] **Step 2: Change card description**

```typescript
<CardDescription>
  Pick a voice profile. STT and TTS always use Deepgram; translation model varies by mode.
</CardDescription>
```

- [ ] **Step 3: Verify in browser** — latency cards show Deepgram voice names.

---

### Task 2: Deepgram-only voice section (replace STT + TTS cards)

**Files:**
- Modify: `app/(admin)/settings/page.tsx`

- [ ] **Step 1: Add constant for Deepgram Aura voices** (from registry or inline)

```typescript
const DEEPGRAM_STT_MODELS = [
  { id: "nova-3", label: "Nova-3 Spanish (streaming)" },
  { id: "nova-2", label: "Nova-2 Spanish" },
] as const;

const DEEPGRAM_TTS_VOICES = [
  { id: "aura-2-javier-es", label: "Javier — Mexican, professional" },
  { id: "aura-2-estrella-es", label: "Estrella — Mexican, warm" },
  { id: "aura-2-celeste-es", label: "Celeste — Colombian, energetic" },
  { id: "aura-2-sirio-es", label: "Sirio — Mexican, baritone" },
  { id: "aura-2-olivia-es", label: "Olivia — Mexican, casual" },
] as const;
```

- [ ] **Step 2: Create `DeepgramVoiceCard` component**

Single card replacing `SttCard` + `TtsCard`:

```tsx
function DeepgramVoiceCard({
  stt,
  tts,
  onChange,
}: {
  stt: SttProvider;
  tts: TtsProvider;
  onChange: (next: { stt?: SttProvider; tts?: TtsProvider }) => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deepgram voice</CardTitle>
        <CardDescription>
          One API key for listening (Nova) and speaking (Aura). Uses <code>DEEPGRAM_API_KEY</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">STT model</label>
          <Select
            value={stt.model}
            onValueChange={(model) =>
              onChange({
                stt: { provider: "deepgram", model, language: "es" },
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEEPGRAM_STT_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Spanish voice</label>
          <Select
            value={tts.voice}
            onValueChange={(voice) =>
              onChange({
                tts: { provider: "deepgram", voice, engine: "aura-2" },
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEEPGRAM_TTS_VOICES.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <TtsPreviewButton config={{ provider: "deepgram", voice: tts.voice, engine: "aura-2" }} />
        </div>
      </CardContent>
    </Card>
  );
}
```

Extract preview button from existing `TtsCard` into `TtsPreviewButton`.

- [ ] **Step 3: Replace in Providers tab**

```tsx
<TabsContent value="providers" className="space-y-4">
  <LatencyModeCard ... />
  <DeepgramVoiceCard
    stt={cfg.stt}
    tts={cfg.tts}
    onChange={(next) => setProvider(next)}
  />
  <TranslationCard
    translate={cfg.translate}
    suggest={cfg.suggest}
    onChange={(next) => setProvider(next)}
  />
</TabsContent>
```

- [ ] **Step 4: Delete `SttCard` and `TtsCard`** (or leave unused — prefer delete to avoid drift).

---

### Task 3: Collapse translate/suggest into one card

**Files:**
- Modify: `app/(admin)/settings/page.tsx`

Deepgram cannot translate text. Show one card, not two vendor pickers:

- [ ] **Step 1: Create `TranslationCard`**

```tsx
function TranslationCard({
  translate,
  suggest,
  onChange,
}: {
  translate: TranslateProvider;
  suggest: SuggestProvider;
  onChange: (next: Partial<ProviderConfig>) => void;
}): React.JSX.Element {
  // Dev default: openai gpt-4o-mini. Prod presets: bedrock haiku/sonnet.
  // Show provider dropdown ONLY if NODE_ENV === 'development' OR user is admin debugging.
  // For cost-first users: hide provider, show model tier only.

  return (
    <Card>
      <CardHeader>
        <CardTitle>Translation</CardTitle>
        <CardDescription>
          Text translation uses an LLM (OpenAI or Bedrock) — not Deepgram. Latency mode picks the model.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground">
          Current: {translate.provider} / {translate.model}
        </div>
        <p className="mt-2 text-xs">
          Change translation model by switching latency mode above, or edit in Advanced.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Remove standalone `TranslateCard` and `SuggestCard` from Providers tab**

Move full pickers to AI Assist tab under "Advanced" collapsible if needed later.

---

### Task 4: Migrate stale DB rows to Deepgram

**Files:**
- Create: `app/api/settings/migrate-deepgram/route.ts`
- Modify: `app/(admin)/settings/page.tsx` — show banner when STT/TTS ≠ deepgram

- [ ] **Step 1: Add migration route**

```typescript
// POST /api/settings/migrate-deepgram
// Admin-only. Overwrites stt/tts/suggest/translate with applyPreset("balanced").
export async function POST(req: Request): Promise<Response> {
  await requireUser(req);
  await requireRole(["admin"]);
  const preset = applyPreset("balanced");
  const row = await updateClinicSettings({
    patch: {
      stt: preset.stt,
      tts: preset.tts,
      translate: preset.translate,
      suggest: preset.suggest,
      latencyMode: preset.latencyMode,
    },
    updatedBy: user.userId,
  });
  return NextResponse.json({ settings: row });
}
```

- [ ] **Step 2: Add banner in settings page**

When `draft.stt.provider !== "deepgram" || draft.tts.provider !== "deepgram"`:

```tsx
<div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
  Voice providers are not Deepgram.{" "}
  <Button variant="link" onClick={migrateToDeepgram}>Switch to Deepgram</Button>
</div>
```

- [ ] **Step 3: Click "Reset to defaults" should call same balanced preset** (already does — verify after Task 2).

---

### Task 5: Update cost estimator for Deepgram-only voice

**Files:**
- Modify: `app/(admin)/settings/page.tsx` — `estimateCost()`

- [ ] **Step 1: Force voice costs from Deepgram catalog when estimating**

If `cfg.stt.provider !== "deepgram"`, use balanced preset STT for estimate display (with footnote "using Deepgram estimate").

- [ ] **Step 2: Expected cost after migration**

Per 5-min call with Deepgram Nova-3 + Aura-2 + Haiku: ~**$0.05–0.07** (not $0.073 with old Polly/Cartesia mix).

---

### Task 6: Wire tabs properly (fix dead tabs)

**Files:**
- Modify: `app/(admin)/settings/page.tsx` (~line 230)

Screenshot shows tabs but `onValueChange` is a no-op — only Providers content renders.

- [ ] **Step 1: Add tab state**

```typescript
const [tab, setTab] = React.useState("providers");
// ...
<Tabs value={tab} onValueChange={setTab}>
```

- [ ] **Step 2: Verify AI Assist / Clinic / Data / Glossary tabs switch content**

---

### Task 7: Tests and verification

**Files:**
- Modify: `tests/integration/settings.test.ts` (if banner/migrate added)

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2: Manual UI check**

1. Open `/admin/settings` (or settings route)
2. Latency cards show Deepgram names
3. Single "Deepgram voice" card — no OpenAI Whisper dropdown
4. Click "Reset to defaults" → STT nova-3, TTS aura-2-javier-es
5. Preview voice plays MP3

---

## Self-review

| Requirement | Task |
|-------------|------|
| Deepgram for STT | Task 2 — locked |
| Deepgram for TTS | Task 2 — locked |
| No stale Cartesia/Polly labels | Task 1 |
| Fix DB showing OpenAI Whisper | Task 4 |
| Simpler UI | Tasks 2–3 |
| "Everything" Deepgram | **Voice yes; translate stays LLM** — documented in Task 3 |

**Gap:** True single-vendor Deepgram for translate requires Voice Agent API rearchitecture — note in plan header, not in this sprint.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-23-deepgram-settings-redo.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one task per subagent with review gates
2. **Inline Execution** — implement in this session

Which approach?
