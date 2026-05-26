# Groq Model Probe + Fallback Design

## Goal

When `gpt-oss-120b` (or any unknown Groq model) is configured for translate or suggest, detect a model-not-found error at call time and retry transparently with `llama-3.3-70b-versatile`. No startup probe, no config change required.

## Architecture

Single-layer change: `lib/providers/clients/groq.ts`. Both `translateGroq` and `suggestReplyGroq` call the same Groq `/chat/completions` endpoint. Groq returns HTTP 404 with `{"error": {"type": "model_not_found"}}` when the model ID is invalid.

```
caller → translateGroq(model: "gpt-oss-120b")
              └─ POST /chat/completions model=gpt-oss-120b
                    ↓ 404 model_not_found
              └─ retry with FALLBACK_MODEL ("llama-3.3-70b-versatile")
                    ↓ 200
              └─ return result + log warn
```

## Components

### `GROQ_FALLBACK_MODEL` constant
`"llama-3.3-70b-versatile"` — the known-good model that is always available on Groq free tier.

### `isModelNotFound(status, body)` helper
Detects the 404 + `type: "model_not_found"` error shape from Groq's API. Returns boolean. Used by both translate and suggest.

### `translateGroq` update
After the `!res.ok` branch: if `isModelNotFound(res.status, text)` and `model !== GROQ_FALLBACK_MODEL`, log a warning and re-call with `GROQ_FALLBACK_MODEL`. Otherwise, throw as before.

### `suggestReplyGroq` update
Same pattern, but the retry must re-POST and re-stream. The generator yields from the retry connection.

## Data Flow

- Retry is **one shot only** — if fallback model also fails, throw the original error class.
- Retry uses **same args** (temperature, max_tokens, messages) — only model changes.
- `console.warn("[groq] model not found, falling back", { requested: model, fallback: GROQ_FALLBACK_MODEL })` — visible in Vercel logs.
- No state stored — next call tries the configured model again (self-healing if Groq adds the model).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Configured model works | Pass-through, no change |
| Configured model → 404 model_not_found | Retry with fallback, warn log |
| Fallback also fails | Throw original TranslateError/SuggestError |
| 429 rate limit | Existing retry path, no change |
| Any other 4xx/5xx | Existing error path, no change |

## Testing

`tests/unit/groq.test.ts` (new):
- `translateGroq` with 404 model-not-found → retries with fallback model, returns translation
- `translateGroq` with 404 model-not-found → fallback also 404 → throws TranslateError
- `translateGroq` with 200 first call → no retry
- `suggestReplyGroq` with 404 model-not-found → retries and streams from fallback

## Files Changed

| File | Change |
|------|--------|
| `lib/providers/clients/groq.ts` | Add `GROQ_FALLBACK_MODEL`, `isModelNotFound`, update both functions |
| `tests/unit/groq.test.ts` | New: 4 tests covering probe + fallback logic |

## Out of Scope

- UI badge showing "fallback active" — adds complexity; Vercel logs are sufficient for debugging
- Startup probe — over-engineering; lazy detection self-heals
- Caching fallback state across requests — unnecessary given fast detection
