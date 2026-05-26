import { describe, it, expect, afterEach } from "vitest";
import {
  synthesizeDeepgram,
  __setDeepgramTtsFetchForTest,
} from "@/lib/providers/clients/deepgram-tts";
import { TTSError } from "@/lib/api/errors";

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x44]);

describe("deepgram-tts", () => {
  afterEach(() => {
    __setDeepgramTtsFetchForTest(null);
    delete process.env.DEEPGRAM_API_KEY;
  });

  it("throws TTSError when DEEPGRAM_API_KEY is missing", async () => {
    await expect(
      synthesizeDeepgram({
        text: "hola",
        voice: "aura-2-javier-es",
        engine: "aura-2",
      }),
    ).rejects.toBeInstanceOf(TTSError);
  });

  it("POSTs to /v1/speak with model and returns mp3 buffer", async () => {
    process.env.DEEPGRAM_API_KEY = "test-key";
    let capturedUrl = "";
    __setDeepgramTtsFetchForTest(async (url, init) => {
      capturedUrl = String(url);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Token test-key",
      );
      return new Response(FAKE_MP3, { status: 200 });
    });

    const result = await synthesizeDeepgram({
      text: "Buenos días",
      voice: "aura-2-javier-es",
      engine: "aura-2",
      speed: 0.85,
    });

    expect(capturedUrl).toContain("model=aura-2-javier-es");
    expect(capturedUrl).toContain("encoding=mp3");
    expect(capturedUrl).toContain("speed=0.85");
    expect(result.audio.equals(FAKE_MP3)).toBe(true);
    expect(result.voice).toBe("aura-2-javier-es");
  });
});
