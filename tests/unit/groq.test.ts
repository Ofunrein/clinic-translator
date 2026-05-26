process.env.DATABASE_URL ??= "postgresql://stub:stub@localhost:5432/stub";
process.env.GROQ_API_KEY = "test-key-stub";

import { describe, it, expect, afterEach } from "vitest";
import {
  __setGroqFetchForTest,
  translateGroq,
  suggestReplyGroq,
} from "@/lib/providers/clients/groq";
import { SuggestError } from "@/lib/api/errors";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";
import type { SuggestTurn } from "@/lib/anthropic";
import type { Dialect } from "@/lib/medical-glossary";
import { TranslateError } from "@/lib/api/errors";
// SuggestError imported above

const MODEL_NOT_FOUND_BODY = JSON.stringify({
  error: { type: "model_not_found", message: "model not found" },
});

function makeTextResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function makeTranslateOkResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translation: "hello" }) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => { __setGroqFetchForTest(null); });

describe("isModelNotFound", () => {
  it("returns true for 404 with type model_not_found — translateGroq retries", async () => {
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
    const result = await translateGroq({ text: "hola", src: "es", dst: "en", model: "gpt-oss-120b" });
    expect(callCount).toBe(2);
    expect(result.translation).toBe("hello");
  });

  it("does not trigger for non-404 errors", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => { callCount++; return makeTextResponse('{"error":"internal"}', 500); });
    await expect(translateGroq({ text: "hola", src: "es", dst: "en", model: "gpt-oss-120b" })).rejects.toBeInstanceOf(TranslateError);
    expect(callCount).toBe(1);
  });

  it("does not trigger for 404 with different error type", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => { callCount++; return makeTextResponse(JSON.stringify({ error: { type: "invalid_api_key" } }), 404); });
    await expect(translateGroq({ text: "hola", src: "es", dst: "en", model: "gpt-oss-120b" })).rejects.toBeInstanceOf(TranslateError);
    expect(callCount).toBe(1);
  });
});

const SUGGEST_ARGS = {
  transcript: [] as SuggestTurn[],
  clinicContext: DEFAULT_CLINIC,
  dialect: "mx" as Dialect,
};

function makeSuggestOkResponse(): Response {
  const sseBody = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: '{"suggestion":"ok","confidence":0.9,"reasoning":"r","escalate":false}' }, finish_reason: null }] })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(sseBody, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const MODEL_NOT_FOUND_BODY_SUGGEST = JSON.stringify({
  error: { type: "model_not_found", message: "model not found" },
});

describe("suggestReplyGroq fallback", () => {
  it("retries and streams from fallback model on model_not_found", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init.body as string) as { model: string };
      if (callCount === 1) {
        expect(body.model).toBe("gpt-oss-120b");
        return new Response(MODEL_NOT_FOUND_BODY_SUGGEST, { status: 404, headers: { "Content-Type": "application/json" } });
      }
      expect(body.model).toBe("llama-3.3-70b-versatile");
      return makeSuggestOkResponse();
    });

    const events: string[] = [];
    let finalResult: import("@/lib/anthropic").SuggestionResult | undefined;
    for await (const ev of suggestReplyGroq({ ...SUGGEST_ARGS, model: "gpt-oss-120b" })) {
      if ("token" in ev && ev.token) events.push(ev.token);
      if ("final" in ev && ev.final) finalResult = ev.final;
    }
    expect(callCount).toBe(2);
    expect(events.length).toBeGreaterThan(0);
    expect(finalResult?.suggestion).toBe("ok");
  });

  it("throws SuggestError if fallback also fails", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return new Response(MODEL_NOT_FOUND_BODY_SUGGEST, { status: 404, headers: { "Content-Type": "application/json" } });
    });
    const run = async () => {
      for await (const _ev of suggestReplyGroq({ ...SUGGEST_ARGS, model: "gpt-oss-120b" })) { void _ev; }
    };
    await expect(run()).rejects.toBeInstanceOf(SuggestError);
    expect(callCount).toBe(2);
  });

  it("does not retry when configured model is already the fallback", async () => {
    let callCount = 0;
    __setGroqFetchForTest(async () => {
      callCount++;
      return new Response(MODEL_NOT_FOUND_BODY_SUGGEST, { status: 404, headers: { "Content-Type": "application/json" } });
    });
    const run = async () => {
      for await (const _ev of suggestReplyGroq({ ...SUGGEST_ARGS, model: "llama-3.3-70b-versatile" })) { void _ev; }
    };
    await expect(run()).rejects.toBeInstanceOf(SuggestError);
    expect(callCount).toBe(1);
  });
});
