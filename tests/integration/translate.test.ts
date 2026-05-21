// Track B2 integration tests for `lib/anthropic` translate().
// Uses the Bedrock client test seam (`__setBedrockClientForTest`) instead
// of msw because msw isn't installed and the AWS SDK signs requests in a
// way that's hostile to network mocks anyway. The seam intercepts at the
// SDK boundary, which is what msw would do on the wire.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  translate,
  __setBedrockClientForTest,
  type BedrockLike,
} from "@/lib/anthropic";
import { TranslateError } from "@/lib/api/errors";

interface BedrockResponseShape {
  content: Array<{ type: "text"; text: string }>;
}

function bedrockResponse(text: string): { body: Uint8Array } {
  const body: BedrockResponseShape = {
    content: [{ type: "text", text }],
  };
  return { body: new TextEncoder().encode(JSON.stringify(body)) };
}

function modelEnvelope(translation: string): string {
  return JSON.stringify({ translation });
}

describe("lib/anthropic.translate (integration)", () => {
  beforeEach(() => {
    vi.stubEnv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-6-v1:0");
  });
  afterEach(() => {
    __setBedrockClientForTest(null);
    vi.unstubAllEnvs();
  });

  it("returns translation + glossary hits when model emits clean JSON", async () => {
    const sent: unknown[] = [];
    const stub: BedrockLike = {
      send: async (cmd) => {
        sent.push(cmd);
        return bedrockResponse(modelEnvelope("I have a headache and need a refill"));
      },
    };
    __setBedrockClientForTest(stub);

    const result = await translate({
      text: "Tengo dolor de cabeza y necesito resurtir mi receta",
      src: "es",
      dst: "en",
      dialect: "mx",
    });

    expect(result.translation).toBe("I have a headache and need a refill");
    // Glossary hits include `dolor de cabeza` (headache), `resurtir` (mx refill),
    // `receta médica` (prescription) — the exact set is best verified by being
    // non-empty and stable across the en/es columns.
    expect(result.glossary_hits.length).toBeGreaterThan(0);
    const ens = result.glossary_hits.map((h) => h.en);
    expect(ens).toContain("headache");
    expect(ens).toContain("refill");
    // Sanity check the prompt — Bedrock got exactly one InvokeModel command.
    expect(sent).toHaveLength(1);
  });

  it("injects glossary hints into the user prompt body", async () => {
    let receivedBody: string | null = null;
    const stub: BedrockLike = {
      send: async (cmd) => {
        // The InvokeModelCommand stores its input on `.input`.
        const input = (cmd as unknown as { input: { body: Uint8Array } }).input;
        receivedBody = new TextDecoder().decode(input.body);
        return bedrockResponse(modelEnvelope("flu shot"));
      },
    };
    __setBedrockClientForTest(stub);

    await translate({ text: "vacuna contra la gripe", src: "es", dst: "en", dialect: "mx" });

    expect(receivedBody).not.toBeNull();
    const parsed = JSON.parse(receivedBody as unknown as string) as {
      messages: Array<{ content: Array<{ text: string }> }>;
      system: string;
    };
    const userText = parsed.messages[0].content[0].text;
    // Glossary lines are formatted as `- "<source>" → "<target>"`.
    expect(userText).toContain("flu shot");
    expect(userText).toContain("vacuna contra la gripe");
    // Lang lock instruction must be present in the system prompt.
    expect(parsed.system).toMatch(/Output ONLY the translated text/);
  });

  it("marks 429 upstream errors retryable", async () => {
    const stub: BedrockLike = {
      send: async () => {
        const err = new Error("Throttling") as Error & {
          name: string;
          $metadata: { httpStatusCode: number };
        };
        err.name = "ThrottlingException";
        err.$metadata = { httpStatusCode: 429 };
        throw err;
      },
    };
    __setBedrockClientForTest(stub);

    await expect(
      translate({ text: "hola", src: "es", dst: "en" }),
    ).rejects.toMatchObject({
      name: "TranslateError",
      retryable: true,
      status: 429,
    });
  });

  it("classifies refusal as non-retryable + refusal code", async () => {
    const stub: BedrockLike = {
      send: async () =>
        bedrockResponse(modelEnvelope("I'm sorry, but I cannot help with that request.")),
    };
    __setBedrockClientForTest(stub);

    const promise = translate({ text: "tengo dolor", src: "es", dst: "en" });
    await expect(promise).rejects.toBeInstanceOf(TranslateError);
    await expect(promise).rejects.toMatchObject({
      code: "translate_refused",
      retryable: false,
    });
  });

  it("parses bare-text fallback when model drops the JSON envelope", async () => {
    const stub: BedrockLike = {
      send: async () => bedrockResponse("Take 500 mg twice daily"),
    };
    __setBedrockClientForTest(stub);

    const result = await translate({
      text: "tome 500 mg dos veces al día",
      src: "es",
      dst: "en",
    });
    expect(result.translation).toBe("Take 500 mg twice daily");
  });
});
