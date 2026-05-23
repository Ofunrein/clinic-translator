// Track C2. Provider dispatcher unit tests. Asserts the dispatcher routes
// to the correct underlying client and that unwired providers throw the
// typed `ProviderNotImplementedError` (wrapped in the typed error envelope).

// Stub DATABASE_URL before any module imports so the indirect db/client
// pull-in (via @/lib/api/errors → @/lib/auth/roles → @/lib/db/client) does
// not throw at import time. The dispatcher itself never touches the DB.
process.env.DATABASE_URL ??= "postgresql://stub:stub@localhost:5432/stub";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  translate,
  synthesize,
  streamStt,
  suggestReply,
} from "@/lib/providers/clients";
import {
  __setBedrockClientForTest,
  __setBedrockStreamClientForTest,
  type BedrockLike,
  type BedrockStreamLike,
} from "@/lib/anthropic";
import {
  __setTtsClientForTest,
  __setKvForTest,
} from "@/lib/google-tts";
import {
  __setDeepgramTtsFetchForTest,
} from "@/lib/providers/clients/deepgram-tts";
import {
  ProviderNotImplementedError,
} from "@/lib/providers/types";
import { TranslateError, TTSError, STTError, SuggestError } from "@/lib/api/errors";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x44]);

function bedrockOk(text: string): BedrockLike {
  return {
    send: async () => ({
      body: new TextEncoder().encode(
        JSON.stringify({ content: [{ type: "text", text }] }),
      ),
    }),
  };
}

describe("providers/clients dispatcher", () => {
  afterEach(() => {
    __setBedrockClientForTest(null);
    __setBedrockStreamClientForTest(null);
    __setTtsClientForTest(null);
    __setKvForTest(null);
    __setDeepgramTtsFetchForTest(null);
  });

  describe("translate()", () => {
    it("routes bedrock provider to the AWS Bedrock client", async () => {
      __setBedrockClientForTest(bedrockOk(JSON.stringify({ translation: "ok" })));
      const result = await translate({
        text: "hola",
        src: "es",
        dst: "en",
        config: { provider: "bedrock", model: "anthropic.claude-haiku-4-5-v1:0" },
      });
      expect(result.translation).toBe("ok");
    });

    it("vertex-gemini stub throws TranslateError wrapping ProviderNotImplementedError", async () => {
      await expect(
        translate({
          text: "hola",
          src: "es",
          dst: "en",
          config: { provider: "vertex-gemini", model: "gemini-2.5-flash" },
        }),
      ).rejects.toMatchObject({
        name: "TranslateError",
      });
    });

    it("azure-openai + deepl stubs throw ProviderNotImplementedError as cause", async () => {
      const az = await translate({
        text: "x",
        src: "es",
        dst: "en",
        config: { provider: "azure-openai", model: "gpt-4o-mini" },
      }).catch((e) => e);
      expect(az).toBeInstanceOf(TranslateError);
      expect((az as TranslateError).cause).toBeInstanceOf(ProviderNotImplementedError);

      const dl = await translate({
        text: "x",
        src: "es",
        dst: "en",
        config: { provider: "deepl", model: "free" },
      }).catch((e) => e);
      expect((dl as TranslateError).cause).toBeInstanceOf(ProviderNotImplementedError);
    });
  });

  describe("synthesize()", () => {
    it("routes google-tts provider to the Google TTS client", async () => {
      __setTtsClientForTest({
        synthesizeSpeech: async () => [{ audioContent: new Uint8Array(FAKE_MP3) }],
      });
      const result = await synthesize({
        text: "hola",
        config: {
          provider: "google-tts",
          voice: "es-US-Chirp3-HD-Achernar",
          engine: "chirp-3-hd",
        },
      });
      expect(result.audio.equals(FAKE_MP3)).toBe(true);
    });

    it("routes deepgram provider to the Deepgram Aura TTS client", async () => {
      process.env.DEEPGRAM_API_KEY = "test-key";
      __setDeepgramTtsFetchForTest(async () =>
        new Response(FAKE_MP3, { status: 200 }),
      );
      const result = await synthesize({
        text: "hola",
        config: {
          provider: "deepgram",
          voice: "aura-2-javier-es",
          engine: "aura-2",
        },
      });
      expect(result.audio.equals(FAKE_MP3)).toBe(true);
      expect(result.voice).toBe("aura-2-javier-es");
    });

    it("polly / cartesia / openai-tts / elevenlabs stubs throw TTSError(ProviderNotImplementedError)", async () => {
      const cases: Array<Parameters<typeof synthesize>[0]["config"]> = [
        { provider: "polly", voice: "Lupe", engine: "generative" },
        { provider: "cartesia", voice: "sonic-2-es-female", engine: "sonic-2" },
        { provider: "openai-tts", voice: "nova", engine: "tts-1" },
        { provider: "elevenlabs", voice: "turbo-v2-5-es", engine: "turbo-v2-5" },
      ];
      for (const config of cases) {
        const e = await synthesize({ text: "hola", config }).catch((err) => err);
        expect(e).toBeInstanceOf(TTSError);
        expect((e as TTSError).cause).toBeInstanceOf(ProviderNotImplementedError);
      }
    });
  });

  describe("streamStt()", () => {
    it("returns null for deepgram (route owns the bridge)", async () => {
      const handle = await streamStt({ provider: "deepgram", model: "nova-3" });
      expect(handle).toBeNull();
    });

    it("aws-transcribe / google-speech / whisper-azure throw STTError", async () => {
      const cases = [
        { provider: "aws-transcribe", model: "default" } as const,
        { provider: "google-speech", model: "chirp-2" } as const,
        { provider: "whisper-azure", model: "whisper-large-v3" } as const,
      ];
      for (const c of cases) {
        const err = await streamStt(c).catch((e) => e);
        expect(err).toBeInstanceOf(STTError);
        expect((err as STTError).cause).toBeInstanceOf(ProviderNotImplementedError);
      }
    });
  });

  describe("suggestReply()", () => {
    it("routes bedrock provider to the streaming Bedrock client", async () => {
      const stream: BedrockStreamLike = {
        send: async () => ({
          body: (async function* () {
            const enc = new TextEncoder();
            yield {
              chunk: {
                bytes: enc.encode(
                  JSON.stringify({
                    type: "content_block_delta",
                    delta: {
                      type: "text_delta",
                      text: JSON.stringify({
                        suggestion: "Hi, how can I help?",
                        confidence: 0.9,
                        reasoning: "polite opener",
                        escalate: false,
                      }),
                    },
                  }),
                ),
              },
            };
          })(),
        }),
      };
      __setBedrockStreamClientForTest(stream);
      const events: string[] = [];
      let final: { suggestion: string } | null = null;
      for await (const ev of suggestReply({
        transcript: [],
        clinicContext: DEFAULT_CLINIC,
        dialect: "mx",
        config: { provider: "bedrock", model: "anthropic.claude-haiku-4-5-v1:0" },
      })) {
        if ("token" in ev && ev.token) events.push(ev.token);
        if ("final" in ev && ev.final) final = ev.final;
      }
      expect(events.length).toBeGreaterThan(0);
      expect(final?.suggestion).toBe("Hi, how can I help?");
    });

    it("vertex-gemini / azure-openai stubs throw SuggestError(ProviderNotImplementedError)", async () => {
      const tryCfg = async (
        config: Parameters<typeof suggestReply>[0]["config"],
      ): Promise<unknown> => {
        try {
          for await (const _ev of suggestReply({
            transcript: [],
            clinicContext: DEFAULT_CLINIC,
            dialect: "mx",
            config,
          })) {
            void _ev;
          }
          return null;
        } catch (e) {
          return e;
        }
      };
      const v = await tryCfg({ provider: "vertex-gemini", model: "gemini-2.5-flash" });
      expect(v).toBeInstanceOf(SuggestError);
      expect((v as SuggestError).cause).toBeInstanceOf(ProviderNotImplementedError);
      const a = await tryCfg({ provider: "azure-openai", model: "gpt-4o-mini" });
      expect(a).toBeInstanceOf(SuggestError);
      expect((a as SuggestError).cause).toBeInstanceOf(ProviderNotImplementedError);
    });
  });
});

// Keep beforeEach for parity with other tests if you ever want a clean env
beforeEach(() => {
  /* noop */
});
