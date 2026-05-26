import { TTSError } from "@/lib/api/errors";

type FetchLike = typeof fetch;
let _fetchOverride: FetchLike | null = null;

export function __setDeepgramTtsFetchForTest(f: FetchLike | null): void {
  _fetchOverride = f;
}

function resolveModel(voice: string, engine: "aura-2"): string {
  if (voice.startsWith("aura-")) return voice;
  return `${engine}-${voice}-es`;
}

export async function synthesizeDeepgram(args: {
  text: string;
  voice: string;
  engine: "aura-2";
  speed?: number;
}): Promise<{ audio: Buffer; cacheHit: boolean; voice: string; fellBack: boolean }> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new TTSError("DEEPGRAM_API_KEY not set", { retryable: false });
  }

  const model = resolveModel(args.voice, args.engine);
  const fetchFn = _fetchOverride ?? fetch;
  const url = new URL("https://api.deepgram.com/v1/speak");
  url.searchParams.set("model", model);
  url.searchParams.set("encoding", "mp3");
  if (typeof args.speed === "number") {
    url.searchParams.set("speed", String(args.speed));
  }

  const res = await fetchFn(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: args.text }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new TTSError(`Deepgram TTS error ${res.status}: ${msg}`, {
      retryable: res.status === 429 || res.status >= 500,
    });
  }

  const arrayBuf = await res.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuf),
    cacheHit: false,
    voice: model,
    fellBack: false,
  };
}
