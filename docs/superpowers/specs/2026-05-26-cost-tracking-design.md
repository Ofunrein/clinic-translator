# Per-Call Cost Tracking + Usage Dashboard Design

## Goal

Capture actual token and character usage on every translate, suggest, and TTS call. Store in a `usage_events` table. Show 7-day cost history in the Settings page.

## Architecture

Three capture points (STT streaming excluded — impractical to meter):

```
POST /api/translate → translateGroq/translateBedrock
                          └─ captures usage.total_tokens from response
                          └─ INSERT usage_events row

POST /api/suggest   → suggestReplyGroq (stream)
                          └─ captures usage from final SSE frame
                          └─ INSERT usage_events row

POST /api/tts       → synthesizeDeepgram / synthesizeGoogle / etc.
                          └─ captures text.length (chars)
                          └─ INSERT usage_events row

GET /api/usage      → new route, admin-only
                          └─ aggregates by day, returns JSON

Settings page       → new "Usage" card, calls /api/usage
```

## Schema

New table `usage_events` (Drizzle migration):

```ts
export const usageEvents = pgTable("usage_events", {
  id:               uuid("id").primaryKey().defaultRandom(),
  sessionId:        uuid("session_id").references(() => calls.id, { onDelete: "set null" }),
  route:            text("route").notNull(),         // "translate" | "suggest" | "tts"
  provider:         text("provider").notNull(),      // "groq" | "deepgram" | "bedrock" | ...
  model:            text("model").notNull(),
  promptTokens:     integer("prompt_tokens"),        // null for TTS
  completionTokens: integer("completion_tokens"),    // null for TTS
  ttsChars:         integer("tts_chars"),            // null for translate/suggest
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sessionIdx: index("usage_events_session_idx").on(t.sessionId),
  createdIdx: index("usage_events_created_idx").on(t.createdAt),
}));
```

## Cost Estimation

Cost is computed at insert time from registry `costPer1k` (translate/suggest) and `costPer1kChars` (TTS):

```
translate/suggest: estimatedCostUsd = totalTokens × (costPer1k / 1000)
tts:               estimatedCostUsd = ttsChars × (costPer1kChars / 1000)
```

A new shared helper `lib/usage.ts` exposes `recordUsage(args)` — thin wrapper around Drizzle insert. Fire-and-forget (no await in request path — use `void recordUsage(...)` to avoid adding latency).

## Capture Point Details

### `/api/translate`
Groq returns `response.usage.prompt_tokens` and `response.usage.completion_tokens` in the non-streaming JSON body. Bedrock returns similar structure. Add capture after successful translate call in `lib/providers/clients/groq.ts` and `lib/anthropic.ts`.

Return type of `translateGroq` gains optional `usage?: { promptTokens: number; completionTokens: number }`. Route calls `void recordUsage(...)` after successful translate.

### `/api/suggest`
Groq streaming: the final SSE frame before `[DONE]` contains `usage` when `stream_options: { include_usage: true }` is added to the request body. Add this flag. `suggestReplyGroq` yields a final event with usage data.

### `/api/tts`
No token counting — count `body.text.length` (chars). Route already has the text; insert after successful synthesize call.

## API Route: `GET /api/usage`

Node runtime, admin-only (`requireAdmin`). Query params: `?days=7` (default, max 30).

Response:
```json
{
  "totalCostUsd": 0.0142,
  "byDay": [
    { "date": "2026-05-26", "costUsd": 0.0041, "calls": 12 },
    ...
  ],
  "byRoute": {
    "translate": 0.0081,
    "suggest": 0.0048,
    "tts": 0.0013
  }
}
```

## Settings UI: Usage Card

New `UsageCard` component in `app/(admin)/settings/page.tsx`. Renders below the provider cards. Fetches `/api/usage?days=7` via `useQuery`. Shows:

- Total 7-day cost (large number, USD formatted to 4 decimal places)
- Per-route cost badges (translate / suggest / tts)
- Simple day-by-day table (date | calls | cost)

Loading: skeleton. Error: muted "usage unavailable" text. No chart — table is sufficient.

## Error Handling

- `recordUsage` failures are non-fatal: wrapped in try/catch, logged, never throw to caller
- `/api/usage` DB errors → 500 with `{ code: "usage_unavailable" }`, UI shows fallback text
- Zero usage: render "No usage in the last 7 days"

## Testing

`tests/unit/usage.test.ts` (new):
- `recordUsage` fires INSERT with correct field values for translate/suggest/tts
- Cost computation: tokens × rate produces correct decimal
- `recordUsage` swallows DB errors without throwing

`tests/integration/usage-route.test.ts` (new):
- GET /api/usage with seeded events returns correct aggregates
- GET /api/usage requires admin role (403 for staff)

## Files Changed / Created

| File | Change |
|------|--------|
| `lib/db/schema.ts` | Add `usageEvents` table |
| `drizzle/migrations/` | Auto-generated migration |
| `lib/usage.ts` | New: `recordUsage()` helper, cost computation |
| `lib/providers/clients/groq.ts` | Return usage from translate; add `include_usage` to suggest stream; yield usage in final event |
| `lib/anthropic.ts` | Return usage from Bedrock translate |
| `app/api/translate/route.ts` | Call `void recordUsage(...)` after translate |
| `app/api/suggest/route.ts` | Call `void recordUsage(...)` after suggest stream ends |
| `app/api/tts/route.ts` | Call `void recordUsage(...)` after synthesize |
| `app/api/usage/route.ts` | New: GET handler, 7-day aggregate |
| `app/(admin)/settings/page.tsx` | Add `UsageCard` component |
| `tests/unit/usage.test.ts` | New: 3 unit tests |
| `tests/integration/usage-route.test.ts` | New: 2 integration tests |

## Out of Scope

- STT (streaming, no clean token boundary)
- Per-user cost breakdown (single clinic for now)
- Cost alerts / budget limits
- Export to CSV
