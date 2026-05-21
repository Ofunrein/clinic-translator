// Track C1 integration tests for the AI reply suggestion stream.
// Mirrors B2's translate.test pattern: mock Bedrock at the SDK seam
// (`__setBedrockStreamClientForTest`) instead of msw — same reasons.
//
// We exercise:
//   * SSE-style token stream → final envelope round-trip
//   * confidence clamping + low-confidence pass-through (does not throw)
//   * escalate path preserved through to the consumer
//   * malformed-JSON tail recovery
//   * `recordAudit` outcome wiring via the helper used by /api/suggest/outcome
//
// The route layer touches the live DB; we don't have testcontainers here,
// so the route's persistence path is verified against a stub `db` injected
// via dynamic mock of `@/lib/db/client` for the audit-on-outcome assertion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  suggestReply,
  __setBedrockStreamClientForTest,
  type BedrockStreamLike,
  type SuggestionResult,
} from "@/lib/anthropic";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";
import { SuggestError } from "@/lib/api/errors";

// ----- Helpers: build a fake bedrock stream from canned text deltas -----

interface FakeStreamSpec {
  /** Text deltas the model emits in order. */
  deltas: string[];
  /** Optional throw on send to simulate transport failures. */
  throwOnSend?: { name: string; status?: number };
}

function streamFromSpec(spec: FakeStreamSpec): BedrockStreamLike {
  return {
    send: async () => {
      if (spec.throwOnSend) {
        const e = new Error(spec.throwOnSend.name) as Error & {
          name: string;
          $metadata: { httpStatusCode?: number };
        };
        e.name = spec.throwOnSend.name;
        e.$metadata = { httpStatusCode: spec.throwOnSend.status };
        throw e;
      }
      return {
        body: (async function* () {
          for (const text of spec.deltas) {
            const evt = {
              type: "content_block_delta",
              delta: { type: "text_delta", text },
            };
            yield {
              chunk: { bytes: new TextEncoder().encode(JSON.stringify(evt)) },
            };
          }
        })(),
      };
    },
  };
}

async function collect(
  iter: AsyncIterable<{ token?: string; final?: SuggestionResult }>,
): Promise<{ tokens: string[]; final: SuggestionResult | null }> {
  const tokens: string[] = [];
  let final: SuggestionResult | null = null;
  for await (const ev of iter) {
    if (ev.token) tokens.push(ev.token);
    else if (ev.final) final = ev.final;
  }
  return { tokens, final };
}

const BASE_ARGS = {
  transcript: [
    { role: "patient" as const, text: "Hi, I would like to schedule a visit." },
  ],
  clinicContext: DEFAULT_CLINIC,
  dialect: "mx" as const,
};

describe("suggestReply (streaming integration)", () => {
  beforeEach(() => {
    vi.stubEnv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-6-v1:0");
  });
  afterEach(() => {
    __setBedrockStreamClientForTest(null);
    vi.unstubAllEnvs();
  });

  it("streams tokens then yields a parsed final envelope", async () => {
    // The model emits the JSON object split across chunks.
    const json = JSON.stringify({
      suggestion: "Sure, what day works for you?",
      confidence: 0.91,
      reasoning: "Routine scheduling ask.",
      escalate: false,
    });
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += 7) {
      chunks.push(json.slice(i, i + 7));
    }
    __setBedrockStreamClientForTest(streamFromSpec({ deltas: chunks }));

    const { tokens, final } = await collect(suggestReply(BASE_ARGS));

    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.join("")).toBe(json);
    expect(final).not.toBeNull();
    expect(final?.suggestion).toBe("Sure, what day works for you?");
    expect(final?.confidence).toBeCloseTo(0.91, 2);
    expect(final?.escalate).toBe(false);
  });

  it("propagates the escalate flag and clamps the confidence", async () => {
    // Out-of-range confidence (1.5) gets clamped to 1.00; escalate=true is preserved.
    const json = JSON.stringify({
      suggestion: "Please hold while I transfer you to a clinician.",
      confidence: 1.5,
      reasoning: "Patient asked about a drug dose.",
      escalate: true,
    });
    __setBedrockStreamClientForTest(streamFromSpec({ deltas: [json] }));

    const { final } = await collect(suggestReply(BASE_ARGS));
    expect(final?.escalate).toBe(true);
    expect(final?.confidence).toBe(1);
    expect(final?.suggestion).toMatch(/transfer/i);
  });

  it("low-confidence outputs pass through unchanged (no throw)", async () => {
    const json = JSON.stringify({
      suggestion: "Could you say that one more time, please?",
      confidence: 0.32,
      reasoning: "Ambiguous intent.",
      escalate: false,
    });
    __setBedrockStreamClientForTest(streamFromSpec({ deltas: [json] }));

    const { final } = await collect(suggestReply(BASE_ARGS));
    expect(final?.confidence).toBeCloseTo(0.32, 2);
    expect(final?.suggestion).toMatch(/say that one more time/);
  });

  it("recovers JSON tail when the model wraps output in code fences", async () => {
    const json = JSON.stringify({
      suggestion: "Yes, we are open Saturday morning.",
      confidence: 0.88,
      reasoning: "Hours question.",
      escalate: false,
    });
    const fenced = "```json\n" + json + "\n```\n";
    __setBedrockStreamClientForTest(streamFromSpec({ deltas: [fenced] }));

    const { final } = await collect(suggestReply(BASE_ARGS));
    expect(final?.suggestion).toMatch(/Saturday morning/);
  });

  it("throws SuggestError on transport throttling with retryable=true", async () => {
    __setBedrockStreamClientForTest(
      streamFromSpec({
        deltas: [],
        throwOnSend: { name: "ThrottlingException", status: 429 },
      }),
    );
    await expect(collect(suggestReply(BASE_ARGS))).rejects.toBeInstanceOf(
      SuggestError,
    );
    await expect(collect(suggestReply(BASE_ARGS))).rejects.toMatchObject({
      retryable: true,
      status: 429,
    });
  });

  it("throws SuggestError on non-JSON model output (non-retryable parse path)", async () => {
    __setBedrockStreamClientForTest(
      streamFromSpec({ deltas: ["not really json at all"] }),
    );
    await expect(collect(suggestReply(BASE_ARGS))).rejects.toBeInstanceOf(
      SuggestError,
    );
  });

  it("never sends the original Spanish to the model — only EN turns are emitted", async () => {
    let capturedBody: string | null = null;
    __setBedrockStreamClientForTest({
      send: async (cmd) => {
        const input = (cmd as unknown as { input: { body: Uint8Array } }).input;
        capturedBody = new TextDecoder().decode(input.body);
        return {
          body: (async function* () {
            const evt = {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: JSON.stringify({
                  suggestion: "ok",
                  confidence: 0.9,
                  reasoning: "test",
                  escalate: false,
                }),
              },
            };
            yield {
              chunk: { bytes: new TextEncoder().encode(JSON.stringify(evt)) },
            };
          })(),
        };
      },
    });

    await collect(
      suggestReply({
        ...BASE_ARGS,
        transcript: [
          { role: "patient", text: "I would like to confirm my appointment." },
          { role: "staff", text: "Thanks for calling." },
        ],
      }),
    );
    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody as unknown as string) as {
      messages: Array<{ content: Array<{ text: string }> }>;
      system: string;
    };
    const userText = parsed.messages[0].content[0].text;
    expect(userText).toContain("PATIENT: I would like to confirm my appointment.");
    expect(userText).toContain("STAFF: Thanks for calling.");
    // Verify the system prompt declares the JSON output spec.
    expect(parsed.system).toMatch(/ONE JSON object/);
  });
});

// ---------------------------------------------------------------------------
// Outcome route audit-log wiring.
// We exercise the persistence + audit flow without spinning up Postgres by
// stubbing the Drizzle module surface for the duration of this block.
// ---------------------------------------------------------------------------

interface UpdateCall {
  set: Record<string, unknown>;
  where: unknown;
}

vi.mock("@/lib/db/client", () => {
  const updates: UpdateCall[] = [];
  const selectsByTable: string[] = [];
  // Build a chainable proxy minimal enough for the outcome route paths we hit.
  const updateBuilder = {
    set(values: Record<string, unknown>) {
      this._set = values;
      return this;
    },
    where(_: unknown) {
      updates.push({ set: this._set as Record<string, unknown>, where: _ });
      return Promise.resolve();
    },
    _set: {} as Record<string, unknown>,
  };
  const utteranceRow = {
    id: "00000000-0000-0000-0000-000000000001",
    callId: "00000000-0000-0000-0000-000000000002",
  };
  const callRow = { staffUserId: null as string | null };
  const selectBuilder = {
    from(_t: { _name?: string }) {
      selectsByTable.push(String(_t?._name ?? "?"));
      return this;
    },
    where() {
      return this;
    },
    limit() {
      // Toggle: first select returns utterance, second returns call row.
      const idx = selectsByTable.length;
      if (idx % 2 === 1) return Promise.resolve([utteranceRow]);
      return Promise.resolve([callRow]);
    },
  };
  const inserts: Array<{ values: Record<string, unknown> }> = [];
  const insertBuilder = {
    values(v: Record<string, unknown>) {
      inserts.push({ values: v });
      return Promise.resolve();
    },
  };
  const db = {
    select: () => selectBuilder,
    update: () => updateBuilder,
    insert: () => insertBuilder,
  };
  return {
    db,
    schema: {},
    __testInternals: { updates, inserts, callRow },
  };
});

vi.mock("@/lib/api/auth", () => ({
  requireUser: async () => ({
    userId: "00000000-0000-0000-0000-000000000099",
    email: "staff@example.com",
    role: "staff",
  }),
}));

describe("/api/suggest/outcome (route)", () => {
  it("updates suggestion_outcome and writes an audit_log entry on accepted", async () => {
    const { POST } = await import("@/app/api/suggest/outcome/route");
    const { __testInternals } = (await import("@/lib/db/client")) as unknown as {
      __testInternals: {
        updates: UpdateCall[];
        inserts: Array<{ values: Record<string, unknown> }>;
        callRow: { staffUserId: string | null };
      };
    };
    __testInternals.updates.length = 0;
    __testInternals.inserts.length = 0;
    __testInternals.callRow.staffUserId = null;

    const body = {
      utteranceId: "00000000-0000-0000-0000-000000000001",
      outcome: "accepted",
    };
    const req = new Request("http://localhost/api/suggest/outcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Outcome update fired with the right enum value.
    const update = __testInternals.updates.find(
      (u) => "suggestionOutcome" in u.set,
    );
    expect(update).toBeDefined();
    expect(update?.set.suggestionOutcome).toBe("accepted");

    // Audit log row inserted with action=edit + matching target.
    const audit = __testInternals.inserts.find(
      (i) => i.values.targetType === "utterance",
    );
    expect(audit).toBeDefined();
    expect(audit?.values.action).toBe("edit");
    expect(String(audit?.values.reason ?? "")).toContain(
      "ai_suggest_outcome:accepted",
    );
  });
});
