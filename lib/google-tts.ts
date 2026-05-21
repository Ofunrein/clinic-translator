// Track B2. Google Cloud TTS Chirp 3 HD client + Vercel KV cache.
// Spec §4.2, §5.2 step 3-4, §7 (TTS failure → fallback voice).
//
// Cache: sha256(text + "|" + voice) → MP3 bytes (base64) in @vercel/kv,
// 24h TTL. Cache silently no-ops if KV env vars are missing.
//
// Auth: GOOGLE_APPLICATION_CREDENTIALS path or default ADC chain.

import { createHash } from "node:crypto";
import textToSpeech from "@google-cloud/text-to-speech";
import { TTSError } from "./api/errors";

const DEFAULT_VOICE = "es-US-Chirp3-HD-Achernar";
const DEFAULT_LANG = "es-US";
const FALLBACK_VOICE = "es-US-Standard-A"; // BAA-covered standard voice
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h

type GoogleTtsClient = InstanceType<typeof textToSpeech.TextToSpeechClient>;
let _client: GoogleTtsClient | null = null;
function client(): GoogleTtsClient {
  if (_client) return _client;
  _client = new textToSpeech.TextToSpeechClient();
  return _client;
}

// Test seam.
export interface TtsClientLike {
  synthesizeSpeech: (req: unknown) => Promise<[{ audioContent?: Uint8Array | string | null }]>;
}
let _override: TtsClientLike | null = null;
export function __setTtsClientForTest(c: TtsClientLike | null): void {
  _override = c;
}

// In-memory KV stub — used in tests when @vercel/kv env is absent.
type KvLike = {
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, opts?: { ex?: number }) => Promise<unknown>;
};
let _kvOverride: KvLike | null = null;
export function __setKvForTest(kv: KvLike | null): void {
  _kvOverride = kv;
}

function kvAvailable(): boolean {
  if (_kvOverride) return true;
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getKv(): Promise<KvLike | null> {
  if (_kvOverride) return _kvOverride;
  if (!kvAvailable()) return null;
  try {
    // Lazy import via indirection so TS doesn't require the package at
    // type-check time (it's not in deps; runtime presence is optional).
    const mod = await (Function("s", "return import(s)") as (s: string) => Promise<{ kv: KvLike }>)(
      "@vercel/kv",
    );
    return mod.kv;
  } catch {
    return null;
  }
}

function cacheKey(text: string, voice: string): string {
  const h = createHash("sha256");
  h.update(text);
  h.update("|");
  h.update(voice);
  return `tts:${h.digest("hex")}`;
}

function langCodeFor(voice: string): string {
  // Google voice naming convention is `<lang>-<region>-<family>...`.
  const m = voice.match(/^([a-z]{2}-[A-Z]{2})/);
  return m ? m[1] : DEFAULT_LANG;
}

function asBuffer(content: Uint8Array | string | null | undefined): Buffer {
  if (!content) {
    throw new TTSError("empty audio content", { retryable: true });
  }
  if (typeof content === "string") {
    // gRPC client returns Buffer in Node; if string, it's base64.
    return Buffer.from(content, "base64");
  }
  return Buffer.from(content);
}

export interface SynthesizeArgs {
  text: string;
  voice?: string;
}

export interface SynthesizeResult {
  audio: Buffer;
  cacheHit: boolean;
  voice: string;
  /** True if we fell back to a Standard voice after a Chirp 3 HD failure. */
  fellBack: boolean;
}

async function callGoogle(text: string, voice: string): Promise<Buffer> {
  const c: TtsClientLike = _override ?? (client() as unknown as TtsClientLike);
  const request = {
    input: { text },
    voice: { languageCode: langCodeFor(voice), name: voice },
    audioConfig: { audioEncoding: "MP3" as const, sampleRateHertz: 24000 },
  };
  let res: Awaited<ReturnType<TtsClientLike["synthesizeSpeech"]>>;
  try {
    res = await c.synthesizeSpeech(request);
  } catch (err: unknown) {
    const status =
      err && typeof err === "object" && "code" in err
        ? Number((err as { code: unknown }).code) || undefined
        : undefined;
    throw new TTSError(`google tts failed`, {
      retryable: true,
      status: status && status >= 400 && status < 500 ? 502 : 502,
      cause: err,
    });
  }
  return asBuffer(res[0]?.audioContent);
}

export async function synthesize(args: SynthesizeArgs): Promise<SynthesizeResult> {
  const text = args.text;
  if (!text) throw new TTSError("empty text", { retryable: false });
  const primaryVoice = args.voice ?? DEFAULT_VOICE;

  const kv = await getKv();
  const key = cacheKey(text, primaryVoice);

  if (kv) {
    try {
      const cached = await kv.get(key);
      if (cached) {
        return {
          audio: Buffer.from(cached, "base64"),
          cacheHit: true,
          voice: primaryVoice,
          fellBack: false,
        };
      }
    } catch {
      // Cache lookup failure is non-fatal.
    }
  }

  let audio: Buffer;
  let voiceUsed = primaryVoice;
  let fellBack = false;

  try {
    audio = await callGoogle(text, primaryVoice);
  } catch (err) {
    if (primaryVoice === FALLBACK_VOICE) {
      throw err;
    }
    // Spec §7: TTS failure → Standard voice fallback (still BAA).
    try {
      audio = await callGoogle(text, FALLBACK_VOICE);
      voiceUsed = FALLBACK_VOICE;
      fellBack = true;
    } catch {
      throw err instanceof TTSError
        ? err
        : new TTSError("google tts failed (with fallback)", { retryable: true, cause: err });
    }
  }

  if (kv) {
    try {
      await kv.set(key, audio.toString("base64"), { ex: CACHE_TTL_SECONDS });
    } catch {
      // Cache write failure is non-fatal.
    }
  }

  return { audio, cacheHit: false, voice: voiceUsed, fellBack };
}
