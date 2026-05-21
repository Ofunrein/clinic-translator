// Track B2 integration tests for `lib/google-tts` synthesize().
// Like the translate test, this uses the test seam (`__setTtsClientForTest`,
// `__setKvForTest`) instead of msw — it exercises the same boundary msw
// would, namely the GCP TTS client + the @vercel/kv cache contract.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  synthesize,
  __setTtsClientForTest,
  __setKvForTest,
} from "@/lib/google-tts";

interface KvStore {
  store: Map<string, string>;
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, opts?: { ex?: number }) => Promise<unknown>;
}

function makeKv(): KvStore {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
      return "OK";
    },
  };
}

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00]);

describe("lib/google-tts.synthesize (integration)", () => {
  afterEach(() => {
    __setTtsClientForTest(null);
    __setKvForTest(null);
    vi.unstubAllEnvs();
  });

  it("hits Google once on cold call, then serves from KV cache on identical second call", async () => {
    let calls = 0;
    __setTtsClientForTest({
      synthesizeSpeech: async () => {
        calls += 1;
        return [{ audioContent: new Uint8Array(FAKE_MP3) }];
      },
    });
    const kv = makeKv();
    __setKvForTest(kv);

    const first = await synthesize({
      text: "Buenos días, ¿en qué le puedo ayudar?",
      voice: "es-US-Chirp3-HD-Achernar",
    });
    expect(first.cacheHit).toBe(false);
    expect(first.audio.equals(FAKE_MP3)).toBe(true);
    expect(calls).toBe(1);
    expect(kv.store.size).toBe(1);

    const second = await synthesize({
      text: "Buenos días, ¿en qué le puedo ayudar?",
      voice: "es-US-Chirp3-HD-Achernar",
    });
    expect(second.cacheHit).toBe(true);
    expect(second.audio.equals(FAKE_MP3)).toBe(true);
    // Critical: Google was NOT called a second time.
    expect(calls).toBe(1);
  });

  it("differentiates cache entries by voice", async () => {
    let calls = 0;
    __setTtsClientForTest({
      synthesizeSpeech: async () => {
        calls += 1;
        return [{ audioContent: new Uint8Array(FAKE_MP3) }];
      },
    });
    __setKvForTest(makeKv());

    await synthesize({ text: "hola", voice: "es-US-Chirp3-HD-Achernar" });
    await synthesize({ text: "hola", voice: "es-US-Chirp3-HD-Algenib" });
    expect(calls).toBe(2);
  });

  it("falls back to Standard voice when the primary voice errors", async () => {
    let attempt = 0;
    __setTtsClientForTest({
      synthesizeSpeech: async (req: unknown) => {
        attempt += 1;
        const r = req as { voice: { name: string } };
        if (r.voice.name === "es-US-Chirp3-HD-Achernar") {
          throw Object.assign(new Error("Chirp 3 HD unavailable"), { code: 14 });
        }
        return [{ audioContent: new Uint8Array(FAKE_MP3) }];
      },
    });
    __setKvForTest(makeKv());

    const result = await synthesize({ text: "hola" });
    expect(result.fellBack).toBe(true);
    expect(result.voice).toBe("es-US-Standard-A");
    expect(attempt).toBe(2);
  });

  it("works with no KV (silent skip)", async () => {
    let calls = 0;
    __setTtsClientForTest({
      synthesizeSpeech: async () => {
        calls += 1;
        return [{ audioContent: new Uint8Array(FAKE_MP3) }];
      },
    });
    // No KV override and no env vars → kvAvailable() returns false.
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");

    const a = await synthesize({ text: "hola" });
    const b = await synthesize({ text: "hola" });
    expect(a.cacheHit).toBe(false);
    expect(b.cacheHit).toBe(false);
    expect(calls).toBe(2);
  });
});
