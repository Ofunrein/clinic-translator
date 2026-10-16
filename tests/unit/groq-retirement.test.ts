import { afterEach, describe, expect, it } from "vitest";
import { __setGroqFetchForTest, translateGroq, suggestReplyGroq } from "@/lib/providers/clients/groq";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";

process.env.GROQ_API_KEY = "test-key";
afterEach(() => __setGroqFetchForTest(null));
const retired = () => Response.json({ error: { type: "invalid_request_error", code: "model_not_found" } }, { status: 404 });

describe("retired Groq models", () => {
  it("recovers translation from the actual production error envelope", async () => {
    const models: string[] = [];
    __setGroqFetchForTest(async (_url, init) => {
      const { model } = JSON.parse(String(init.body));
      models.push(model);
      return models.length === 1 ? retired() : Response.json({ choices: [{ message: { content: '{"translation":"Hello"}' } }] });
    });
    const result = await translateGroq({ text: "Hola", src: "es", dst: "en", model: "llama-3.3-70b-versatile" });
    expect(result.translation).toBe("Hello");
    expect(models).toEqual(["llama-3.3-70b-versatile", "openai/gpt-oss-20b"]);
  });

  it("recovers streamed suggestions from the actual production error envelope", async () => {
    let attempts = 0;
    __setGroqFetchForTest(async (_url, init) => {
      attempts++;
      if (attempts === 1) return retired();
      expect(JSON.parse(String(init.body)).model).toBe("openai/gpt-oss-20b");
      return new Response('data: {"choices":[{"delta":{"content":"{\\"suggestion\\":\\"How can I help?\\",\\"confidence\\":0.9,\\"reasoning\\":\\"Greeting\\",\\"escalate\\":false}"}}]}\n\ndata: [DONE]\n\n');
    });
    const events = [];
    for await (const event of suggestReplyGroq({ transcript: [], clinicContext: DEFAULT_CLINIC, dialect: "mx", model: "llama-3.3-70b-versatile" })) events.push(event);
    expect(events.at(-1)).toHaveProperty("final.suggestion", "How can I help?");
    expect(attempts).toBe(2);
  });
});
