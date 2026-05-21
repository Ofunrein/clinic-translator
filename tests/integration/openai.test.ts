// Track D integration tests for the OpenAI dev provider.
// Mirrors B2's pattern: instead of msw (not installed), we swap the global
// fetch surface via `__setOpenaiFetchForTest`. Each test asserts the
// request shape going out and the response shape coming back, plus error
// + stream behavior.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  transcribeOpenai,
  translateOpenai,
  synthesizeOpenai,
  suggestReplyOpenai,
  __setOpenaiFetchForTest,
  type FetchLike,
} from "@/lib/providers/clients/openai";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";
import {
  STTError,
  SuggestError,
  TTSError,
  TranslateError,
} from "@/lib/api/errors";
import type { SuggestionResult } from "@/lib/anthropic";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(handler: (call: RecordedCall) => Response | Promise<Response>): {
  fetcher: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const rec: RecordedCall = { url, init };
    calls.push(rec);
    return handler(rec);
  };
  return { fetcher, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(payloads: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of payloads) {
        controller.enqueue(enc.encode(`data: ${p}\n\n`));
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("openai provider client", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-fake");
  });
  afterEach(() => {
    __setOpenaiFetchForTest(null);
    vi.unstubAllEnvs();
  });

  describe("transcribeOpenai", () => {
    it("posts multipart/form-data to /v1/audio/transcriptions and parses verbose_json", async () => {
      const { fetcher, calls } = captureFetch(() =>
        jsonResponse({
          text: "tengo dolor de cabeza",
          language: "es",
          segments: [{ avg_logprob: -0.2 }, { avg_logprob: -0.1 }],
        }),
      );
      __setOpenaiFetchForTest(fetcher);

      const audio = Buffer.alloc(3200); // ~100 ms of PCM
      const result = await transcribeOpenai({ audioBuffer: audio, lang: "es" });

      expect(result.transcript).toBe("tengo dolor de cabeza");
      expect(result.isFinal).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.confidence).toBeLessThanOrEqual(1);

      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call.url).toBe("https://api.openai.com/v1/audio/transcriptions");
      const headers = call.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test-fake");
      expect(headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    });

    it("throws STTError on empty audio buffer (non-retryable)", async () => {
      const empty = Buffer.alloc(0);
      await expect(
        transcribeOpenai({ audioBuffer: empty, lang: "es" }),
      ).rejects.toMatchObject({
        name: "STTError",
        retryable: false,
      });
    });

    it("marks 429 as retryable", async () => {
      const { fetcher } = captureFetch(
        () => new Response("rate limit", { status: 429 }),
      );
      __setOpenaiFetchForTest(fetcher);

      const audio = Buffer.alloc(3200);
      const err = await transcribeOpenai({ audioBuffer: audio, lang: "es" }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(STTError);
      expect((err as STTError).retryable).toBe(true);
    });
  });

  describe("translateOpenai", () => {
    it("sends gpt-4o-mini chat completion with json_object response_format and parses output", async () => {
      const { fetcher, calls } = captureFetch(() =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translation: "I have a headache",
                }),
              },
            },
          ],
        }),
      );
      __setOpenaiFetchForTest(fetcher);

      const result = await translateOpenai({
        text: "tengo dolor de cabeza",
        src: "es",
        dst: "en",
        glossaryHits: [{ en: "headache", es: "dolor de cabeza" }],
      });

      expect(result.translation).toBe("I have a headache");
      expect(result.glossary_hits).toHaveLength(1);

      expect(calls).toHaveLength(1);
      const body = JSON.parse(String(calls[0].init.body)) as {
        model: string;
        response_format: { type: string };
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.response_format.type).toBe("json_object");
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toMatch(/Output ONLY the translated text/);
      // User prompt embeds glossary hint lines.
      expect(body.messages[1].content).toContain("headache");
      expect(body.messages[1].content).toContain("dolor de cabeza");
    });

    it("propagates 500 as retryable TranslateError", async () => {
      const { fetcher } = captureFetch(
        () => new Response("oops", { status: 500 }),
      );
      __setOpenaiFetchForTest(fetcher);

      const err = await translateOpenai({
        text: "hola",
        src: "es",
        dst: "en",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(TranslateError);
      expect((err as TranslateError).retryable).toBe(true);
    });

    it("throws TranslateError when content is missing", async () => {
      const { fetcher } = captureFetch(() =>
        jsonResponse({ choices: [{ message: { content: "" } }] }),
      );
      __setOpenaiFetchForTest(fetcher);

      await expect(
        translateOpenai({ text: "hola", src: "es", dst: "en" }),
      ).rejects.toBeInstanceOf(TranslateError);
    });
  });

  describe("synthesizeOpenai", () => {
    it("posts to /v1/audio/speech with default voice=nova model=tts-1 and returns MP3 buffer", async () => {
      const fakeMp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00, 0x00]);
      const { fetcher, calls } = captureFetch(
        () =>
          new Response(fakeMp3, {
            status: 200,
            headers: { "content-type": "audio/mpeg" },
          }),
      );
      __setOpenaiFetchForTest(fetcher);

      const buf = await synthesizeOpenai({ text: "Buenos días" });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.equals(Buffer.from(fakeMp3))).toBe(true);

      const body = JSON.parse(String(calls[0].init.body)) as {
        model: string;
        voice: string;
        input: string;
        response_format: string;
      };
      expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech");
      expect(body.model).toBe("tts-1");
      expect(body.voice).toBe("nova");
      expect(body.input).toBe("Buenos días");
      expect(body.response_format).toBe("mp3");
    });

    it("honors custom voice + model overrides", async () => {
      const { fetcher, calls } = captureFetch(
        () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      );
      __setOpenaiFetchForTest(fetcher);

      await synthesizeOpenai({ text: "hola", voice: "shimmer", model: "tts-1-hd" });
      const body = JSON.parse(String(calls[0].init.body)) as {
        model: string;
        voice: string;
      };
      expect(body.voice).toBe("shimmer");
      expect(body.model).toBe("tts-1-hd");
    });

    it("throws TTSError on upstream 400", async () => {
      const { fetcher } = captureFetch(
        () => new Response("bad", { status: 400 }),
      );
      __setOpenaiFetchForTest(fetcher);

      const err = await synthesizeOpenai({ text: "x" }).catch((e) => e);
      expect(err).toBeInstanceOf(TTSError);
      expect((err as TTSError).retryable).toBe(false);
    });
  });

  describe("suggestReplyOpenai", () => {
    it("streams SSE deltas as tokens and yields a parsed final envelope", async () => {
      const json = JSON.stringify({
        suggestion: "Sure, what day works for you?",
        confidence: 0.91,
        reasoning: "Routine scheduling ask.",
        escalate: false,
      });
      // Split the JSON into multiple deltas across multiple SSE events.
      const slices: string[] = [];
      for (let i = 0; i < json.length; i += 9) {
        slices.push(json.slice(i, i + 9));
      }
      const payloads = slices.map((slice) =>
        JSON.stringify({
          choices: [{ delta: { content: slice }, finish_reason: null }],
        }),
      );

      const { fetcher } = captureFetch(() => sseResponse(payloads));
      __setOpenaiFetchForTest(fetcher);

      const tokens: string[] = [];
      let final: SuggestionResult | null = null;
      for await (const ev of suggestReplyOpenai({
        transcript: [{ role: "patient", text: "Quiero agendar una cita." }],
        clinicContext: DEFAULT_CLINIC,
        dialect: "mx",
      })) {
        if ("token" in ev && ev.token) tokens.push(ev.token);
        if ("final" in ev && ev.final) final = ev.final;
      }
      expect(tokens.length).toBeGreaterThan(1);
      expect(tokens.join("")).toBe(json);
      expect(final).not.toBeNull();
      expect(final?.suggestion).toBe("Sure, what day works for you?");
      expect(final?.escalate).toBe(false);
      expect(final?.confidence).toBeCloseTo(0.91, 2);
    });

    it("clamps out-of-range confidence and preserves escalate=true", async () => {
      const json = JSON.stringify({
        suggestion: "Please hold while I transfer you to a clinician.",
        confidence: 1.5,
        reasoning: "Patient asked about a drug dose.",
        escalate: true,
      });
      const payload = JSON.stringify({
        choices: [{ delta: { content: json }, finish_reason: null }],
      });
      const { fetcher } = captureFetch(() => sseResponse([payload]));
      __setOpenaiFetchForTest(fetcher);

      let final: SuggestionResult | null = null;
      for await (const ev of suggestReplyOpenai({
        transcript: [],
        clinicContext: DEFAULT_CLINIC,
        dialect: "mx",
      })) {
        if ("final" in ev && ev.final) final = ev.final;
      }
      expect(final?.confidence).toBe(1);
      expect(final?.escalate).toBe(true);
    });

    it("throws SuggestError on upstream 429 with retryable=true", async () => {
      const { fetcher } = captureFetch(
        () => new Response("throttled", { status: 429 }),
      );
      __setOpenaiFetchForTest(fetcher);

      const consume = async (): Promise<unknown> => {
        try {
          for await (const _ev of suggestReplyOpenai({
            transcript: [],
            clinicContext: DEFAULT_CLINIC,
            dialect: "mx",
          })) {
            void _ev;
          }
          return null;
        } catch (e) {
          return e;
        }
      };
      const err = await consume();
      expect(err).toBeInstanceOf(SuggestError);
      expect((err as SuggestError).retryable).toBe(true);
    });

    it("throws SuggestError when stream tail is not valid JSON", async () => {
      const payload = JSON.stringify({
        choices: [{ delta: { content: "not really json" }, finish_reason: null }],
      });
      const { fetcher } = captureFetch(() => sseResponse([payload]));
      __setOpenaiFetchForTest(fetcher);

      const consume = async (): Promise<unknown> => {
        try {
          for await (const _ev of suggestReplyOpenai({
            transcript: [],
            clinicContext: DEFAULT_CLINIC,
            dialect: "mx",
          })) {
            void _ev;
          }
          return null;
        } catch (e) {
          return e;
        }
      };
      const err = await consume();
      expect(err).toBeInstanceOf(SuggestError);
    });
  });

  describe("missing API key", () => {
    it("throws clear error when OPENAI_API_KEY is unset", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("OPENAI_API_KEY", "");
      await expect(
        translateOpenai({ text: "hola", src: "es", dst: "en" }),
      ).rejects.toThrow(/OPENAI_API_KEY/);
    });
  });
});
