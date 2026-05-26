# Groq Model Probe + Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a Groq `model_not_found` (HTTP 404) error at call time and transparently retry with `llama-3.3-70b-versatile` so misconfigured model IDs never surface to the caller.

**Architecture:** All changes are confined to `lib/providers/clients/groq.ts`. A new `isModelNotFound` predicate checks the Groq-specific 404 shape; both `translateGroq` and `suggestReplyGroq` call it after `!res.ok` and, on a positive match, re-issue the request with `GROQ_FALLBACK_MODEL`. Retry is one-shot — if the fallback also fails, the original typed error is rethrown so nothing upstream changes.

**Tech Stack:** vitest, TypeScript, native `fetch` (already shimmed via `__setGroqFetchForTest`), `TranslateError`/`SuggestError` from `@/lib/api/errors`.

---

### Task 1: Add `GROQ_FALLBACK_MODEL` constant and `isModelNotFound` helper

**Files:**
- Modify: `lib/providers/clients/groq.ts`

- [ ] Step 1: Write failing test

```typescript
// tests/unit/groq.test.ts
// Track: Groq model probe + fallback

process.env.DATABASE_URL ??= "postgresql://stub:stub@localhost:5432/stub";
process.env.GROQ_API_KEY = "test-key-stub";

import { describe, it, expect, afterEach } from "vitest";
import {
  __setGroqFetchForTest,
  translateGroq,
  suggestReplyGroq,
} from "@/lib/providers/clients/groq";
import { TranslateError, SuggestError } from "@/lib/api/errors";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODEL_NOT_FOUND_BODY = JSON.stringify({
  error: { type: "model_not_found", message: "model not found" },
});

function makeTextResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTranslateOkResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ translation: "hello" }),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeSuggestOkResponse(): Response {
  const sseBody = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: '{"suggestion":"ok","confidence":0.9,"reasoning":"r","escalate":false}' }, finish_reason: null }] })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(sseBody, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  __setGroqFetchForTest(null);
});

// ---------------------------------------------------------------------------
// isModelNotFound detection (indirect: translateGroq behaviour)
// ---------------------------------------------------------------------------

describe("isModelNotFound", () => {
  it("returns true for 404 with type model_not_found", async () => {
    // We test this indirectly: if the helper works, translateGroq retries
    // instead of throwing immediately on the first call.
    let callCount = 0;
    __setGroqFetchForTest(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init.body as string) as { model: string };
      if (callCount === 1) {
        expect(body.model).toBe("gpt-oss-120b");
        return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
      }
      // fallback call
      expect(body.model).toBe("llama-3.3-70b-versatile");
      return makeTranslateOkResponse();
    });

    const result = await translateGroq({
      text: "hola",
      src: "es",
      dst: "en",
      model: "gpt-oss-120b",
    });

    expect(callCount).toBe(2);
    expect(result.translation).toBe("hello");
  });

  it("does not trigger for non-404 errors (e.g., 500)", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTextResponse('{"error":"internal"}', 500);
    });

    await expect(
      translateGroq({ text: "hola", src: "es", dst: "en", model: "gpt-oss-120b" }),
    ).rejects.toBeInstanceOf(TranslateError);

    expect(callCount).toBe(1);
  });

  it("does not trigger for 404 with different error type", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTextResponse(
        JSON.stringify({ error: { type: "invalid_api_key" } }),
        404,
      );
    });

    await expect(
      translateGroq({ text: "hola", src: "es", dst: "en", model: "gpt-oss-120b" }),
    ).rejects.toBeInstanceOf(TranslateError);

    expect(callCount).toBe(1);
  });
});
```

- [ ] Step 2: Run test, confirm FAIL

```bash
npm test -- --reporter=verbose tests/unit/groq.test.ts
```

Expected output contains:
```
FAIL tests/unit/groq.test.ts
 × isModelNotFound > returns true for 404 with type model_not_found
```
(Test fails because `isModelNotFound` does not exist yet and `translateGroq` throws on 404 instead of retrying.)

- [ ] Step 3: Implement — add constant and helper to `lib/providers/clients/groq.ts`

Add after the existing `GROQ_BASE` and `DEFAULT_GROQ_MODEL` constants (around line 16):

```typescript
export const GROQ_FALLBACK_MODEL = "llama-3.3-70b-versatile";

/**
 * Returns true when Groq responds with HTTP 404 and the error body contains
 * `type: "model_not_found"`. Used by both translateGroq and suggestReplyGroq
 * to detect unknown model IDs and trigger one-shot fallback.
 */
export function isModelNotFound(status: number, body: string): boolean {
  if (status !== 404) return false;
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown } };
    return parsed?.error?.type === "model_not_found";
  } catch {
    return false;
  }
}
```

- [ ] Step 4: Run test, confirm PASS

```bash
npm test -- --reporter=verbose tests/unit/groq.test.ts
```

Expected:
```
PASS tests/unit/groq.test.ts
 ✓ isModelNotFound > returns true for 404 with type model_not_found
 ✓ isModelNotFound > does not trigger for non-404 errors (e.g., 500)
 ✓ isModelNotFound > does not trigger for 404 with different error type
```

- [ ] Step 5: Commit

```bash
git add lib/providers/clients/groq.ts tests/unit/groq.test.ts && git commit -m "feat(groq): add GROQ_FALLBACK_MODEL constant and isModelNotFound helper"
```

---

### Task 2: Wire fallback into `translateGroq`

**Files:**
- Modify: `lib/providers/clients/groq.ts`

- [ ] Step 1: Write failing tests (append to `tests/unit/groq.test.ts`)

```typescript
// ---------------------------------------------------------------------------
// translateGroq fallback
// ---------------------------------------------------------------------------

describe("translateGroq fallback", () => {
  it("retries with fallback model and returns translation on model_not_found", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init.body as string) as { model: string };
      if (callCount === 1) {
        expect(body.model).toBe("gpt-oss-120b");
        return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
      }
      expect(body.model).toBe("llama-3.3-70b-versatile");
      return makeTranslateOkResponse();
    });

    const result = await translateGroq({
      text: "hola",
      src: "es",
      dst: "en",
      model: "gpt-oss-120b",
    });

    expect(callCount).toBe(2);
    expect(result.translation).toBe("hello");
  });

  it("throws TranslateError if fallback also returns model_not_found", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
    });

    await expect(
      translateGroq({ text: "hola", src: "es", dst: "en", model: "gpt-oss-120b" }),
    ).rejects.toBeInstanceOf(TranslateError);

    // Called twice: once for gpt-oss-120b, once for fallback
    expect(callCount).toBe(2);
  });

  it("does not retry when configured model is already the fallback", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
    });

    await expect(
      translateGroq({
        text: "hola",
        src: "es",
        dst: "en",
        model: "llama-3.3-70b-versatile",
      }),
    ).rejects.toBeInstanceOf(TranslateError);

    expect(callCount).toBe(1);
  });

  it("passes through normally when model returns 200 on first call", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTranslateOkResponse();
    });

    const result = await translateGroq({
      text: "hola",
      src: "es",
      dst: "en",
      model: "llama-3.3-70b-versatile",
    });

    expect(callCount).toBe(1);
    expect(result.translation).toBe("hello");
  });
});
```

- [ ] Step 2: Run test, confirm FAIL

```bash
npm test -- --reporter=verbose tests/unit/groq.test.ts
```

Expected output contains:
```
FAIL tests/unit/groq.test.ts
 × translateGroq fallback > retries with fallback model and returns translation on model_not_found
 × translateGroq fallback > throws TranslateError if fallback also returns model_not_found
 × translateGroq fallback > does not retry when configured model is already the fallback
```

- [ ] Step 3: Implement — update `translateGroq` in `lib/providers/clients/groq.ts`

Replace the `if (!res.ok)` block in `translateGroq` (currently around lines 360–365) with:

```typescript
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (isModelNotFound(res.status, text) && model !== GROQ_FALLBACK_MODEL) {
      console.warn("[groq] model not found, falling back", {
        requested: model,
        fallback: GROQ_FALLBACK_MODEL,
      });
      // One-shot retry with fallback model — same args, only model changes.
      let fallbackRes: Response;
      try {
        fallbackRes = await getFetch()(`${GROQ_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROQ_FALLBACK_MODEL,
            temperature: 0.2,
            max_tokens: 1024,
            response_format: { type: "json_object" },
            messages,
          }),
        });
      } catch (err) {
        throw new TranslateError("groq translate transport failed", {
          retryable: true,
          cause: err,
        });
      }
      if (!fallbackRes.ok) {
        const fallbackText = await fallbackRes.text().catch(() => "");
        throw new TranslateError(`groq translate ${fallbackRes.status}`, {
          retryable: isRetryableStatus(fallbackRes.status),
          status: fallbackRes.status === 429 ? 429 : 502,
          cause: fallbackText.slice(0, 256),
        });
      }
      // Continue with fallbackRes as the response to parse below.
      // Re-assign res so the JSON parsing block works unchanged.
      res = fallbackRes;
    } else {
      throw new TranslateError(`groq translate ${res.status}`, {
        retryable: isRetryableStatus(res.status),
        status: res.status === 429 ? 429 : 502,
        cause: text.slice(0, 256),
      });
    }
  }
```

Note: Because `res` is declared with `let`, the re-assignment `res = fallbackRes` allows the existing JSON-parsing block below to process the fallback response without duplication.

- [ ] Step 4: Run test, confirm PASS

```bash
npm test -- --reporter=verbose tests/unit/groq.test.ts
```

Expected:
```
PASS tests/unit/groq.test.ts
 ✓ translateGroq fallback > retries with fallback model and returns translation on model_not_found
 ✓ translateGroq fallback > throws TranslateError if fallback also returns model_not_found
 ✓ translateGroq fallback > does not retry when configured model is already the fallback
 ✓ translateGroq fallback > passes through normally when model returns 200 on first call
```

Also run typecheck:
```bash
npm run typecheck
```

- [ ] Step 5: Commit

```bash
git add lib/providers/clients/groq.ts tests/unit/groq.test.ts && git commit -m "feat(groq): fallback to llama-3.3-70b-versatile on model_not_found in translateGroq"
```

---

### Task 3: Wire fallback into `suggestReplyGroq`

**Files:**
- Modify: `lib/providers/clients/groq.ts`

- [ ] Step 1: Write failing test (append to `tests/unit/groq.test.ts`)

```typescript
// ---------------------------------------------------------------------------
// suggestReplyGroq fallback
// ---------------------------------------------------------------------------

describe("suggestReplyGroq fallback", () => {
  const SUGGEST_ARGS = {
    transcript: [] as import("@/lib/anthropic").SuggestTurn[],
    clinicContext: DEFAULT_CLINIC,
    dialect: "mx" as import("@/lib/medical-glossary").Dialect,
  };

  it("retries and streams from fallback model on model_not_found", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init.body as string) as { model: string };
      if (callCount === 1) {
        expect(body.model).toBe("gpt-oss-120b");
        return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
      }
      expect(body.model).toBe("llama-3.3-70b-versatile");
      return makeSuggestOkResponse();
    });

    const events: string[] = [];
    let finalResult: import("@/lib/anthropic").SuggestionResult | undefined;

    for await (const ev of suggestReplyGroq({
      ...SUGGEST_ARGS,
      model: "gpt-oss-120b",
    })) {
      if ("token" in ev && ev.token) events.push(ev.token);
      if ("final" in ev && ev.final) finalResult = ev.final;
    }

    expect(callCount).toBe(2);
    expect(events.length).toBeGreaterThan(0);
    expect(finalResult?.suggestion).toBe("ok");
  });

  it("throws SuggestError if fallback also fails on model_not_found", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
    });

    const run = async () => {
      for await (const _ev of suggestReplyGroq({
        ...SUGGEST_ARGS,
        model: "gpt-oss-120b",
      })) {
        void _ev;
      }
    };

    await expect(run()).rejects.toBeInstanceOf(SuggestError);
    expect(callCount).toBe(2);
  });

  it("does not retry when fallback model itself gets model_not_found", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return makeTextResponse(MODEL_NOT_FOUND_BODY, 404);
    });

    const run = async () => {
      for await (const _ev of suggestReplyGroq({
        ...SUGGEST_ARGS,
        model: "llama-3.3-70b-versatile",
      })) {
        void _ev;
      }
    };

    await expect(run()).rejects.toBeInstanceOf(SuggestError);
    expect(callCount).toBe(1);
  });
});
```

- [ ] Step 2: Run test, confirm FAIL

```bash
npm test -- --reporter=verbose tests/unit/groq.test.ts
```

Expected output contains:
```
FAIL tests/unit/groq.test.ts
 × suggestReplyGroq fallback > retries and streams from fallback model on model_not_found
 × suggestReplyGroq fallback > throws SuggestError if fallback also fails on model_not_found
 × suggestReplyGroq fallback > does not retry when fallback model itself gets model_not_found
```

- [ ] Step 3: Implement — update `suggestReplyGroq` in `lib/providers/clients/groq.ts`

Replace the `if (!res.ok)` block in `suggestReplyGroq` (currently around lines 199–206) with:

```typescript
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const requestedModel = args.model || DEFAULT_GROQ_MODEL;
    if (isModelNotFound(res.status, text) && requestedModel !== GROQ_FALLBACK_MODEL) {
      console.warn("[groq] model not found, falling back", {
        requested: requestedModel,
        fallback: GROQ_FALLBACK_MODEL,
      });
      // One-shot retry with fallback model — same messages, only model changes.
      let fallbackRes: Response;
      try {
        fallbackRes = await getFetch()(`${GROQ_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model: GROQ_FALLBACK_MODEL,
            temperature: 0.3,
            max_tokens: 512,
            response_format: { type: "json_object" },
            stream: true,
            messages,
          }),
        });
      } catch (err) {
        throw new SuggestError("groq suggest transport failed", {
          retryable: true,
          cause: err,
        });
      }
      if (!fallbackRes.ok) {
        const fallbackText = await fallbackRes.text().catch(() => "");
        throw new SuggestError(`groq suggest ${fallbackRes.status}`, {
          retryable: isRetryableStatus(fallbackRes.status),
          status: fallbackRes.status === 429 ? 429 : 502,
          cause: fallbackText.slice(0, 256),
        });
      }
      // Re-assign res so the streaming block below processes the fallback response.
      res = fallbackRes;
    } else {
      throw new SuggestError(`groq suggest ${res.status}`, {
        retryable: isRetryableStatus(res.status),
        status: res.status === 429 ? 429 : 502,
        cause: text.slice(0, 256),
      });
    }
  }
```

Note: `res` is already declared with `let` in `suggestReplyGroq`, so the re-assignment is valid and the existing `res.body` streaming block that follows processes the fallback response unchanged.

- [ ] Step 4: Run test, confirm PASS

```bash
npm test -- --reporter=verbose tests/unit/groq.test.ts
```

Expected:
```
PASS tests/unit/groq.test.ts
 ✓ isModelNotFound > returns true for 404 with type model_not_found
 ✓ isModelNotFound > does not trigger for non-404 errors (e.g., 500)
 ✓ isModelNotFound > does not trigger for 404 with different error type
 ✓ translateGroq fallback > retries with fallback model and returns translation on model_not_found
 ✓ translateGroq fallback > throws TranslateError if fallback also returns model_not_found
 ✓ translateGroq fallback > does not retry when configured model is already the fallback
 ✓ translateGroq fallback > passes through normally when model returns 200 on first call
 ✓ suggestReplyGroq fallback > retries and streams from fallback model on model_not_found
 ✓ suggestReplyGroq fallback > throws SuggestError if fallback also fails on model_not_found
 ✓ suggestReplyGroq fallback > does not retry when fallback model itself gets model_not_found
```

Also run the full unit suite to confirm no regressions:
```bash
npm test -- --reporter=verbose
```

And typecheck:
```bash
npm run typecheck
```

- [ ] Step 5: Commit

```bash
git add lib/providers/clients/groq.ts tests/unit/groq.test.ts && git commit -m "feat(groq): fallback to llama-3.3-70b-versatile on model_not_found in suggestReplyGroq"
```

---

## Summary of all files changed

| File | Change |
|------|--------|
| `lib/providers/clients/groq.ts` | Export `GROQ_FALLBACK_MODEL` const; export `isModelNotFound` helper; update `translateGroq` and `suggestReplyGroq` `!res.ok` branches to re-issue with fallback model on 404 model_not_found |
| `tests/unit/groq.test.ts` | New file: 10 tests covering `isModelNotFound` detection, `translateGroq` fallback (success, double-fail, no-loop, pass-through), and `suggestReplyGroq` fallback (stream, double-fail, no-loop) |

## Invariants preserved

- No startup probe — detection is lazy and self-healing.
- No stored state — every request independently tries the configured model first.
- Fallback is one-shot — if `GROQ_FALLBACK_MODEL` also fails, the original typed error class (`TranslateError` / `SuggestError`) is thrown unchanged.
- `console.warn` with `requested` and `fallback` fields is the only side effect, visible in Vercel function logs.
- All other error paths (429, 5xx, transport failure, non-model-not-found 404) are untouched.
