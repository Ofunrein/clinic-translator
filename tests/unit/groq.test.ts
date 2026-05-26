process.env.DATABASE_URL ??= "postgresql://stub:stub@localhost:5432/stub";
process.env.GROQ_API_KEY = "test-key-stub";

import { describe, it, expect, afterEach } from "vitest";
import {
  __setGroqFetchForTest,
  translateGroq,
} from "@/lib/providers/clients/groq";
import { TranslateError } from "@/lib/api/errors";

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
