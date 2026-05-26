# Cost Tracking + Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture token/char usage on every translate, suggest, and TTS call, persist it in a `usage_events` table, and surface a 7-day cost history in the admin Settings page.

**Architecture:** A shared `lib/usage.ts` helper wraps a Drizzle insert into `usage_events`; each capture point calls it fire-and-forget so no latency is added to the hot path. A new `GET /api/usage` route aggregates the table by day/route and returns JSON consumed by a new `UsageCard` React component in the Settings page.

**Tech Stack:** Drizzle ORM (pg), Next.js route handlers (Node runtime), TanStack Query (`useQuery`), Vitest for unit + integration tests.

---

### Task 1: Schema — add `usage_events` table

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] Step 1: Add the `usageEvents` table and its exported types at the end of `lib/db/schema.ts`, before the closing lines:

```ts
// ----- usage_events (Cost Tracking) -----
export const usageEvents = pgTable(
  "usage_events",
  {
    id:               uuid("id").primaryKey().defaultRandom(),
    sessionId:        uuid("session_id").references(() => calls.id, { onDelete: "set null" }),
    route:            text("route").notNull(),            // "translate" | "suggest" | "tts"
    provider:         text("provider").notNull(),         // "groq" | "deepgram" | "bedrock" | ...
    model:            text("model").notNull(),
    promptTokens:     integer("prompt_tokens"),           // null for TTS
    completionTokens: integer("completion_tokens"),       // null for TTS
    ttsChars:         integer("tts_chars"),               // null for translate/suggest
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull(),
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index("usage_events_session_idx").on(t.sessionId),
    createdIdx: index("usage_events_created_idx").on(t.createdAt),
  }),
);

export type UsageEvent    = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
```

- [ ] Step 2: Generate and run the migration:
```bash
npm run db:generate
npm run db:migrate
```

- [ ] Step 3: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 4: Commit:
```bash
git add lib/db/schema.ts drizzle/migrations
git commit -m "feat(schema): add usage_events table for per-call cost tracking"
```

---

### Task 2: Unit tests for `lib/usage.ts` (TDD — write tests first)

**Files:**
- Create: `tests/unit/usage.test.ts`

- [ ] Step 1: Create `tests/unit/usage.test.ts` with three tests covering correct inserts and error swallowing:

```ts
// tests/unit/usage.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the db client before importing recordUsage so the module
// sees the mock at import time.
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: vi.fn(),
  },
}));

import { db } from "@/lib/db/client";
import { recordUsage } from "@/lib/usage";

type MockedDb = {
  insert: ReturnType<typeof vi.fn>;
};

function mockInsertChain(resolve: boolean = true) {
  const valuesStub = resolve
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(new Error("db exploded"));
  (db as unknown as MockedDb).insert = vi.fn().mockReturnValue({ values: valuesStub });
  return valuesStub;
}

describe("recordUsage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts correct fields for a translate call", async () => {
    const valuesStub = mockInsertChain(true);

    await recordUsage({
      route: "translate",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      promptTokens: 120,
      completionTokens: 30,
      ttsChars: null,
      sessionId: null,
    });

    expect((db as unknown as MockedDb).insert).toHaveBeenCalledOnce();
    const row = valuesStub.mock.calls[0][0];
    expect(row.route).toBe("translate");
    expect(row.provider).toBe("groq");
    expect(row.model).toBe("llama-3.3-70b-versatile");
    expect(row.promptTokens).toBe(120);
    expect(row.completionTokens).toBe(30);
    expect(row.ttsChars).toBeNull();
    // estimatedCostUsd = (120 + 30) * (0.00015 / 1000) would vary by model;
    // just assert it's a string (numeric drizzle type) or number.
    expect(typeof row.estimatedCostUsd).toBe("string");
  });

  it("computes correct decimal cost for token-based calls", async () => {
    mockInsertChain(true);
    const valuesStub = (
      (db as unknown as MockedDb).insert("").values as ReturnType<typeof vi.fn>
    );
    // Reinitialise mock to capture the values call
    const capturedValues: Record<string, unknown>[] = [];
    (db as unknown as MockedDb).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        capturedValues.push(row);
        return Promise.resolve(undefined);
      }),
    });
    void valuesStub; // suppress lint

    await recordUsage({
      route: "suggest",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      promptTokens: 1000,
      completionTokens: 0,
      ttsChars: null,
      sessionId: null,
    });

    const row = capturedValues[0];
    // groq llama-3.3-70b-versatile: costPer1k = 0.00015 (from registry translate/suggest)
    // 1000 tokens * (0.00015 / 1000) = 0.00015
    expect(Number(row.estimatedCostUsd)).toBeCloseTo(0.00015, 8);
  });

  it("swallows DB errors without throwing", async () => {
    mockInsertChain(false);

    // Should not throw even when db.insert rejects
    await expect(
      recordUsage({
        route: "tts",
        provider: "deepgram",
        model: "aura-2",
        promptTokens: null,
        completionTokens: null,
        ttsChars: 500,
        sessionId: null,
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] Step 2: Run tests (they will fail until Task 3 creates `lib/usage.ts`):
```bash
npm test -- --reporter=verbose tests/unit/usage.test.ts
```
Expected: 3 failing tests — confirms the test seam is correct.

- [ ] Step 3: Commit:
```bash
git add tests/unit/usage.test.ts
git commit -m "test(usage): add failing unit tests for recordUsage (TDD)"
```

---

### Task 3: Implement `lib/usage.ts`

**Files:**
- Create: `lib/usage.ts`

- [ ] Step 1: Create `lib/usage.ts`:

```ts
// lib/usage.ts — fire-and-forget usage capture helper.
// Called from route handlers as: void recordUsage(...).catch(err => console.error("[usage]", err))
// recordUsage itself is async but never throws; it absorbs DB errors internally.

import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { getCatalogEntry } from "@/lib/providers/registry";

export interface RecordUsageArgs {
  route: "translate" | "suggest" | "tts";
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  ttsChars: number | null;
  sessionId: string | null;
}

/**
 * Compute estimated cost in USD from registry rates.
 *
 * translate/suggest: (promptTokens + completionTokens) × (costPer1k / 1000)
 * tts:               ttsChars × (costPer1kChars / 1000)
 *
 * Falls back to 0 when the provider/model is not in the registry.
 */
function estimateCost(args: RecordUsageArgs): number {
  if (args.route === "tts") {
    const chars = args.ttsChars ?? 0;
    if (chars === 0) return 0;
    const entry = getCatalogEntry("tts", args.provider);
    if (!entry) return 0;
    // costPer1kChars lives on each voice entry; use the first voice that matches
    // the model/engine. For TTS, `model` is the engine id (e.g. "aura-2").
    const voice = entry.voices.find((v) => v.engine === args.model || v.id === args.model);
    const rate = voice?.costPer1kChars ?? 0;
    return (chars * rate) / 1000;
  }

  // translate / suggest
  const totalTokens = (args.promptTokens ?? 0) + (args.completionTokens ?? 0);
  if (totalTokens === 0) return 0;
  const kind = args.route === "translate" ? "translate" : "suggest";
  const entry = getCatalogEntry(kind, args.provider);
  if (!entry) return 0;
  const modelEntry = entry.models.find((m) => m.id === args.model);
  const rate = modelEntry?.costPer1k ?? 0;
  return (totalTokens * rate) / 1000;
}

/**
 * Insert a usage_events row. Never throws — DB errors are caught and logged.
 * Call as: void recordUsage(...).catch(err => console.error("[usage]", err))
 * or simply: void recordUsage(...)
 */
export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  try {
    const estimatedCostUsd = estimateCost(args).toFixed(6);
    await db.insert(usageEvents).values({
      sessionId:        args.sessionId,
      route:            args.route,
      provider:         args.provider,
      model:            args.model,
      promptTokens:     args.promptTokens,
      completionTokens: args.completionTokens,
      ttsChars:         args.ttsChars,
      estimatedCostUsd,
    });
  } catch (err) {
    console.error("[usage] recordUsage failed", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] Step 2: Run the unit tests — all 3 should pass:
```bash
npm test -- --reporter=verbose tests/unit/usage.test.ts
```

- [ ] Step 3: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 4: Commit:
```bash
git add lib/usage.ts
git commit -m "feat(usage): implement recordUsage helper with cost estimation from registry"
```

---

### Task 4: Capture usage in `lib/providers/clients/groq.ts` — translate

**Files:**
- Modify: `lib/providers/clients/groq.ts`

The Groq non-streaming translate response already returns a full JSON body. We need to:
1. Add a `usage` field to the `ChatCompletionResponse` interface.
2. Return `usage` from `translateGroq`.
3. Update `TranslateGroqResult` to include optional usage.

- [ ] Step 1: In `lib/providers/clients/groq.ts`, update `ChatCompletionResponse` to include `usage`:

```ts
interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

- [ ] Step 2: Update `TranslateGroqResult` to include optional `usage`:

```ts
export interface TranslateGroqResult {
  translation: string;
  glossary_hits: { en: string; es: string }[];
  usage?: { promptTokens: number; completionTokens: number };
}
```

- [ ] Step 3: At the end of `translateGroq`, change the return from:

```ts
  return { translation, glossary_hits: args.glossaryHits ?? [] };
```

to:

```ts
  const usage = parsed.usage
    ? {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
      }
    : undefined;
  return { translation, glossary_hits: args.glossaryHits ?? [] , usage };
```

- [ ] Step 4: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 5: Commit:
```bash
git add lib/providers/clients/groq.ts
git commit -m "feat(groq): return usage tokens from translateGroq"
```

---

### Task 5: Capture usage in `lib/providers/clients/groq.ts` — suggest stream

**Files:**
- Modify: `lib/providers/clients/groq.ts`

The suggest stream needs `stream_options: { include_usage: true }` in the request body. Groq sends a final SSE frame (before `[DONE]`) that contains `usage` at the top level of the JSON object (not inside `choices`). We yield a final event with usage so the route can record it.

- [ ] Step 1: Add a `usage` field to `SseDelta` to capture the final frame:

```ts
interface SseDelta {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

- [ ] Step 2: Update `SuggestGroqEvent` to include an optional `usage` variant:

```ts
export type SuggestGroqEvent =
  | { token: string; final?: never; usage?: never }
  | { token?: never; final: SuggestionResult; usage?: never }
  | { token?: never; final?: never; usage: { promptTokens: number; completionTokens: number } };
```

- [ ] Step 3: Add `stream_options: { include_usage: true }` to the request body in `suggestReplyGroq`. Locate the `body: JSON.stringify({...})` block and add the field:

```ts
      body: JSON.stringify({
        model: args.model || DEFAULT_GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 512,
        response_format: { type: "json_object" },
        stream: true,
        stream_options: { include_usage: true },
        messages,
      }),
```

- [ ] Step 4: Inside the SSE parsing loop in `suggestReplyGroq`, after collecting `delta` content, add handling for the usage frame. The usage frame has no `choices` but has a top-level `usage` field. Add this after the existing `delta` yield:

```ts
        // Capture the final usage frame Groq sends when stream_options.include_usage=true
        if (parsed.usage && !parsed.choices?.length) {
          yield {
            usage: {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
            },
          };
        }
```

- [ ] Step 5: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 6: Commit:
```bash
git add lib/providers/clients/groq.ts
git commit -m "feat(groq): add stream_options.include_usage and yield usage event in suggestReplyGroq"
```

---

### Task 6: Capture usage in `lib/providers/clients.ts` dispatch — propagate usage

**Files:**
- Modify: `lib/providers/clients.ts`

The dispatch layer wraps provider calls. We need the `translate` dispatch to surface `usage` and the `suggestReply` dispatch to pass through the new `usage` event.

- [ ] Step 1: Update `TranslateResult` re-export to include `usage`. Since `TranslateResult` is currently `Awaited<ReturnType<typeof translateBedrock>>` from `lib/anthropic`, and Bedrock doesn't return usage yet (Task 7 adds it), we need a unified type. Change the top of `clients.ts` to define it explicitly:

```ts
export interface TranslateResult {
  translation: string;
  glossary_hits: Array<{ en: string; es: string; category?: string }>;
  usage?: { promptTokens: number; completionTokens: number };
}
```

Remove the line: `export type TranslateResult = Awaited<ReturnType<typeof translateBedrock>>;`

- [ ] Step 2: In the `groq` branch of the `translate` dispatch, pass through usage:

```ts
    case "groq": {
      const dialect: Dialect = rest.dialect ?? "all";
      const hits = rest.glossaryHits ?? findGlossaryHits(rest.text, dialect);
      const out = await translateGroq({
        text: rest.text,
        src: rest.src,
        dst: rest.dst,
        model: config.model,
        glossaryHits: hits.map((h) => ({
          en: h.term.en,
          es: h.term.es,
        })),
      });
      return {
        translation: out.translation,
        glossary_hits: hits.map((h) => ({
          en: h.term.en,
          es: h.term.es,
          category: h.term.category,
        })),
        usage: out.usage,
      };
    }
```

- [ ] Step 3: In `SuggestStreamEvent`, ensure the type includes the usage variant. Update the type alias:

```ts
export type SuggestStreamEvent =
  | { token: string; final?: never; usage?: never }
  | { token?: never; final: SuggestionResult; usage?: never }
  | { token?: never; final?: never; usage: { promptTokens: number; completionTokens: number } };
```

(Also update the import from `lib/anthropic` if `BedrockSuggestStreamEvent` conflicts — add the usage variant there too, or widen locally.)

- [ ] Step 4: In the `groq` branch of `suggestReply`, pass through all event types including `usage`:

```ts
    case "groq":
      for await (const ev of suggestReplyGroq({
        transcript: rest.transcript,
        clinicContext: rest.clinicContext,
        dialect: rest.dialect,
        model: config.model,
      })) {
        yield ev;
      }
      return;
```

(The groq generator already yields typed events; the dispatch already passes them through — verify the type union aligns.)

- [ ] Step 5: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 6: Commit:
```bash
git add lib/providers/clients.ts
git commit -m "feat(clients): propagate usage tokens through translate and suggestReply dispatch"
```

---

### Task 7: Capture usage in `lib/anthropic.ts` — Bedrock translate

**Files:**
- Modify: `lib/anthropic.ts`

Bedrock returns `usage` in the response body. Parse it and add to `TranslateResult`.

- [ ] Step 1: Locate the `BedrockClaudeBody` response parsing in `lib/anthropic.ts`. Find where `response.body` is decoded and the JSON is parsed. Add `usage` to the parsed shape:

```ts
interface BedrockResponseBody {
  content: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}
```

- [ ] Step 2: After parsing the response body, extract `usage` and include it in the return value of `translate`:

```ts
  const usage = (parsedBody as BedrockResponseBody).usage
    ? {
        promptTokens: (parsedBody as BedrockResponseBody).usage!.input_tokens,
        completionTokens: (parsedBody as BedrockResponseBody).usage!.output_tokens,
      }
    : undefined;

  return {
    translation,
    glossary_hits: hits.map((h) => ({
      en: h.term.en,
      es: h.term.es,
      category: h.term.category,
    })),
    usage,
  };
```

- [ ] Step 3: In the `bedrock` branch of `clients.ts` `translate` dispatch, pass `usage` through:

```ts
    case "bedrock": {
      const out = await translateBedrock({ ...rest, modelId: config.model });
      return {
        translation: out.translation,
        glossary_hits: out.glossary_hits,
        usage: out.usage,
      };
    }
```

- [ ] Step 4: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 5: Run existing translate integration tests to confirm no regressions:
```bash
npm test -- --reporter=verbose tests/integration/translate.test.ts
```

- [ ] Step 6: Commit:
```bash
git add lib/anthropic.ts lib/providers/clients.ts
git commit -m "feat(bedrock): return usage tokens from translate for cost tracking"
```

---

### Task 8: Wire `recordUsage` into `app/api/translate/route.ts`

**Files:**
- Modify: `app/api/translate/route.ts`

- [ ] Step 1: Add import at the top of the file:

```ts
import { recordUsage } from "@/lib/usage";
```

- [ ] Step 2: After the successful `dispatchTranslate` call (after `result` is assigned), add the fire-and-forget capture. Insert this block immediately after the `result = await dispatchTranslate(...)` block, before the `// Persist when bound to a session` block:

```ts
    // Fire-and-forget cost capture — never blocks the response path.
    void recordUsage({
      route: "translate",
      provider: cfg.translate.provider,
      model: cfg.translate.model ?? "default",
      promptTokens:     result.usage?.promptTokens    ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      ttsChars: null,
      sessionId: body.sessionId ?? null,
    }).catch((err: unknown) => console.error("[usage]", err));
```

Note: `cfg` is already in scope from `const cfg = await getActiveProviderConfig()`.

- [ ] Step 3: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 4: Commit:
```bash
git add app/api/translate/route.ts
git commit -m "feat(translate): capture usage via recordUsage after successful translate"
```

---

### Task 9: Wire `recordUsage` into `app/api/suggest/route.ts`

**Files:**
- Modify: `app/api/suggest/route.ts`

The suggest route uses a streaming `ReadableStream`. We need to capture the `usage` event from `dispatchSuggestReply` and record it after the stream ends.

- [ ] Step 1: Add import at the top of `app/api/suggest/route.ts`:

```ts
import { recordUsage } from "@/lib/usage";
```

- [ ] Step 2: Inside the `ReadableStream` `start` callback, add a variable to accumulate usage before the `for await` loop, and capture the `usage` event:

```ts
      try {
        let final: SuggestionResult | null = null;
        let capturedUsage: { promptTokens: number; completionTokens: number } | null = null;
        const active = await getActiveProviderConfig();
        for await (const event of dispatchSuggestReply({
          transcript,
          clinicContext,
          dialect: ctx.dialect,
          config: active.suggest,
        })) {
          if ("token" in event && event.token) {
            controller.enqueue(sseFrame({ token: event.token }));
          } else if ("final" in event && event.final) {
            final = event.final;
            controller.enqueue(sseFrame({ final: event.final }));
          } else if ("usage" in event && event.usage) {
            capturedUsage = event.usage;
          }
        }
        if (final && utteranceInDb) {
          await persistSuggestion({
            utteranceId,
            result: final,
            userId: user.userId,
            traceId,
            lastUtteranceCallId: sessionId,
          });
        }
        // Fire-and-forget cost capture after stream completes.
        void recordUsage({
          route: "suggest",
          provider: active.suggest.provider,
          model: active.suggest.model ?? "default",
          promptTokens:     capturedUsage?.promptTokens    ?? null,
          completionTokens: capturedUsage?.completionTokens ?? null,
          ttsChars: null,
          sessionId,
        }).catch((err: unknown) => console.error("[usage]", err));
```

- [ ] Step 3: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 4: Commit:
```bash
git add app/api/suggest/route.ts
git commit -m "feat(suggest): capture usage via recordUsage after suggest stream ends"
```

---

### Task 10: Wire `recordUsage` into `app/api/tts/route.ts`

**Files:**
- Modify: `app/api/tts/route.ts`

TTS has no tokens — we count `body.text.length` chars. The provider and voice are in `ttsConfig`.

- [ ] Step 1: Add import at the top of `app/api/tts/route.ts`:

```ts
import { recordUsage } from "@/lib/usage";
```

- [ ] Step 2: After `const result = await dispatchSynthesize(...)`, add the fire-and-forget capture:

```ts
    const result = await dispatchSynthesize({ text: body.text, config: ttsConfig });

    // Fire-and-forget cost capture. Use the engine as model for TTS cost lookup.
    void recordUsage({
      route: "tts",
      provider: ttsConfig.provider,
      model: "engine" in ttsConfig && ttsConfig.engine ? ttsConfig.engine : "default",
      promptTokens: null,
      completionTokens: null,
      ttsChars: body.text.length,
      sessionId: body.sessionId ?? null,
    }).catch((err: unknown) => console.error("[usage]", err));
```

- [ ] Step 3: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 4: Commit:
```bash
git add app/api/tts/route.ts
git commit -m "feat(tts): capture char usage via recordUsage after synthesis"
```

---

### Task 11: Integration tests for `GET /api/usage`

**Files:**
- Create: `tests/integration/usage-route.test.ts`

Write tests first (TDD).

- [ ] Step 1: Create `tests/integration/usage-route.test.ts`:

```ts
// tests/integration/usage-route.test.ts
// Tests for GET /api/usage — admin-only 7-day aggregate endpoint.
// Uses a direct DB seeding approach with the test DB (requires DATABASE_URL).
// Auth is mocked at the requireUser boundary via vi.mock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Mock requireUser so we can test role enforcement without a real session.
vi.mock("@/lib/api/auth", () => ({
  requireUser: vi.fn(),
}));

import { requireUser } from "@/lib/api/auth";
import { GET } from "@/app/api/usage/route";

type MockedRequireUser = ReturnType<typeof vi.fn>;

// Seed one usage_events row per route and return the inserted ids.
async function seedEvents(): Promise<string[]> {
  const rows = await db
    .insert(usageEvents)
    .values([
      {
        route: "translate",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        promptTokens: 100,
        completionTokens: 50,
        ttsChars: null,
        estimatedCostUsd: "0.000022",
      },
      {
        route: "suggest",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        promptTokens: 200,
        completionTokens: 80,
        ttsChars: null,
        estimatedCostUsd: "0.000042",
      },
      {
        route: "tts",
        provider: "deepgram",
        model: "aura-2",
        promptTokens: null,
        completionTokens: null,
        ttsChars: 500,
        estimatedCostUsd: "0.000015",
      },
    ])
    .returning({ id: usageEvents.id });
  return rows.map((r) => r.id);
}

async function deleteSeededEvents(ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(usageEvents).where(eq(usageEvents.id, id));
  }
}

describe("GET /api/usage", () => {
  let seededIds: string[] = [];

  beforeEach(async () => {
    seededIds = await seedEvents();
  });

  afterEach(async () => {
    await deleteSeededEvents(seededIds);
    vi.clearAllMocks();
  });

  it("returns correct aggregates for admin user", async () => {
    (requireUser as unknown as MockedRequireUser).mockResolvedValue({
      userId: "admin-user-id",
      email: "admin@clinic.com",
      role: "admin",
    });

    const req = new Request("http://localhost/api/usage?days=7");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      totalCostUsd: number;
      byDay: Array<{ date: string; costUsd: number; calls: number }>;
      byRoute: { translate: number; suggest: number; tts: number };
    };

    // Total must be at least the sum of our seeded rows (there may be others in DB).
    expect(body.totalCostUsd).toBeGreaterThanOrEqual(0.000079);
    expect(Array.isArray(body.byDay)).toBe(true);
    expect(body.byDay.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.byRoute.translate).toBe("number");
    expect(typeof body.byRoute.suggest).toBe("number");
    expect(typeof body.byRoute.tts).toBe("number");
  });

  it("returns 403 for staff (non-admin) role", async () => {
    (requireUser as unknown as MockedRequireUser).mockResolvedValue({
      userId: "staff-user-id",
      email: "staff@clinic.com",
      role: "staff",
    });

    const req = new Request("http://localhost/api/usage?days=7");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
```

- [ ] Step 2: Run tests (will fail until Task 12 creates the route):
```bash
npm test -- --reporter=verbose tests/integration/usage-route.test.ts
```
Expected: 2 failing tests.

- [ ] Step 3: Commit:
```bash
git add tests/integration/usage-route.test.ts
git commit -m "test(usage-route): add failing integration tests for GET /api/usage (TDD)"
```

---

### Task 12: Implement `GET /api/usage` route

**Files:**
- Create: `app/api/usage/route.ts`

- [ ] Step 1: Create `app/api/usage/route.ts`:

```ts
// GET /api/usage — admin-only 7-day cost aggregate.
// Query params: ?days=7 (default, max 30)
// Returns: { totalCostUsd, byDay, byRoute }

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { ForbiddenError, errorToResponse } from "@/lib/api/errors";

export const runtime = "nodejs";

interface DayRow {
  date: string;
  costUsd: string;
  calls: string;
}

interface RouteRow {
  route: string;
  costUsd: string;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (user.role !== "admin" && user.role !== "owner") {
      throw new ForbiddenError("admin or owner role required");
    }

    const url = new URL(req.url);
    const rawDays = url.searchParams.get("days");
    const days = Math.min(Math.max(parseInt(rawDays ?? "7", 10) || 7, 1), 30);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString();

    // Day-by-day aggregate
    const dayRows = await db
      .select({
        date:    sql<string>`DATE(${usageEvents.createdAt})`.as("date"),
        costUsd: sql<string>`SUM(${usageEvents.estimatedCostUsd})`.as("cost_usd"),
        calls:   sql<string>`COUNT(*)`.as("calls"),
      })
      .from(usageEvents)
      .where(sql`${usageEvents.createdAt} >= ${cutoffIso}`)
      .groupBy(sql`DATE(${usageEvents.createdAt})`)
      .orderBy(sql`DATE(${usageEvents.createdAt}) DESC`);

    // Per-route aggregate
    const routeRows = await db
      .select({
        route:   usageEvents.route,
        costUsd: sql<string>`SUM(${usageEvents.estimatedCostUsd})`.as("cost_usd"),
      })
      .from(usageEvents)
      .where(sql`${usageEvents.createdAt} >= ${cutoffIso}`)
      .groupBy(usageEvents.route);

    const totalCostUsd = (dayRows as DayRow[]).reduce(
      (sum, r) => sum + parseFloat(r.costUsd ?? "0"),
      0,
    );

    const byDay = (dayRows as DayRow[]).map((r) => ({
      date:    r.date,
      costUsd: parseFloat(r.costUsd ?? "0"),
      calls:   parseInt(r.calls ?? "0", 10),
    }));

    const byRoute: Record<string, number> = {
      translate: 0,
      suggest:   0,
      tts:       0,
    };
    for (const r of routeRows as RouteRow[]) {
      byRoute[r.route] = parseFloat(r.costUsd ?? "0");
    }

    return NextResponse.json(
      { totalCostUsd, byDay, byRoute },
      { status: 200 },
    );
  } catch (err) {
    return errorToResponse(err);
  }
}
```

- [ ] Step 2: Run the integration tests — both should pass:
```bash
npm test -- --reporter=verbose tests/integration/usage-route.test.ts
```

- [ ] Step 3: Run all unit tests to confirm no regressions:
```bash
npm test -- --reporter=verbose tests/unit/usage.test.ts
```

- [ ] Step 4: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 5: Commit:
```bash
git add app/api/usage/route.ts
git commit -m "feat(api): add GET /api/usage admin-only 7-day cost aggregate route"
```

---

### Task 13: Add `UsageCard` to the Settings page

**Files:**
- Modify: `app/(admin)/settings/page.tsx`

- [ ] Step 1: Add `useQuery` import if not already present. The file already imports from `@tanstack/react-query` — confirm `useQuery` is in that import:

```ts
import { useQueryClient, useQuery } from "@tanstack/react-query";
```

- [ ] Step 2: Add the `UsageCard` component definition near the top of the file (after existing imports, before the main `SettingsPage` component):

```tsx
// ----- UsageCard -----

interface UsageDay {
  date: string;
  costUsd: number;
  calls: number;
}

interface UsageData {
  totalCostUsd: number;
  byDay: UsageDay[];
  byRoute: {
    translate: number;
    suggest: number;
    tts: number;
  };
}

function UsageCard() {
  const { data, isLoading, isError } = useQuery<UsageData>({
    queryKey: ["usage", 7],
    queryFn: async () => {
      const res = await fetch("/api/usage?days=7");
      if (!res.ok) throw new Error("usage unavailable");
      return res.json() as Promise<UsageData>;
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>7-Day Usage Cost</CardTitle>
        <CardDescription>Estimated cost across translate, suggest, and TTS calls.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        )}
        {isError && (
          <p className="text-sm text-muted-foreground">Usage data unavailable.</p>
        )}
        {data && (
          <div className="space-y-4">
            <div>
              <span className="text-3xl font-bold tabular-nums">
                ${data.totalCostUsd.toFixed(4)}
              </span>
              <span className="ml-1 text-sm text-muted-foreground">USD (last 7 days)</span>
            </div>
            <div className="flex gap-3 flex-wrap">
              {(["translate", "suggest", "tts"] as const).map((route) => (
                <span
                  key={route}
                  className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                >
                  {route}: ${data.byRoute[route].toFixed(4)}
                </span>
              ))}
            </div>
            {data.byDay.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage in the last 7 days.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-1 font-medium">Date</th>
                    <th className="pb-1 font-medium text-right">Calls</th>
                    <th className="pb-1 font-medium text-right">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDay.map((row) => (
                    <tr key={row.date} className="border-b last:border-0">
                      <td className="py-1">{row.date}</td>
                      <td className="py-1 text-right tabular-nums">{row.calls}</td>
                      <td className="py-1 text-right tabular-nums">${row.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] Step 3: In the main `SettingsPage` (or `Settings`) component, add `<UsageCard />` at the bottom of the rendered cards section. Find the last `</Card>` or section wrapper in the return JSX and append:

```tsx
        {/* Usage Dashboard */}
        <UsageCard />
```

- [ ] Step 4: Typecheck:
```bash
npm run typecheck
```

- [ ] Step 5: Run the full test suite to confirm no regressions:
```bash
npm test -- --reporter=verbose
```

- [ ] Step 6: Commit:
```bash
git add app/(admin)/settings/page.tsx
git commit -m "feat(settings): add UsageCard with 7-day cost history table"
```

---

### Task 14: Final verification

- [ ] Step 1: Run full typecheck:
```bash
npm run typecheck
```

- [ ] Step 2: Run all tests with verbose output:
```bash
npm test -- --reporter=verbose
```

- [ ] Step 3: Verify the migration ran and the table exists (connect to DB or check the drizzle migrations folder has a new file).

- [ ] Step 4: Start dev server and manually verify:
  - Perform a translation via the UI.
  - Open the Settings page as an admin — confirm `UsageCard` renders with data.
  - Confirm the 7-day table populates after the translate call.

- [ ] Step 5: Final commit (if any fixups needed):
```bash
git add -p
git commit -m "fix(cost-tracking): typecheck and integration fixups"
```
