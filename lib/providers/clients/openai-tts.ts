import { TTSError } from "@/lib/api/errors";

export async function synthesizeOpenAi(args: {
  text: string;
  voice: string;
  engine: "tts-1" | "tts-1-hd";
}): Promise<{ audio: Buffer; cacheHit: boolean; voice: string; fellBack: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TTSError("OPENAI_API_KEY not set", { retryable: false });
  }

  // Map Google/Chirp voice names to valid OpenAI voices.
  const VOICE_MAP: Record<string, string> = {
    "es-US-Chirp3-HD-Achernar": "nova",
    "es-US-Chirp3-HD-Aoede": "nova",
    achernar: "nova",
    alloy: "alloy",
    echo: "echo",
    fable: "fable",
    onyx: "onyx",
    nova: "nova",
    shimmer: "shimmer",
  };
  const voice = VOICE_MAP[args.voice] ?? VOICE_MAP[args.voice.toLowerCase()] ?? "nova";
  const model = args.engine === "tts-1-hd" ? "tts-1-hd" : "tts-1";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: args.text, response_format: "mp3" }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new TTSError(`OpenAI TTS error ${res.status}: ${msg}`, {
      retryable: res.status === 429 || res.status >= 500,
    });
  }

  const arrayBuf = await res.arrayBuffer();
  const audio = Buffer.from(arrayBuf);
  return { audio, cacheHit: false, voice, fellBack: false };
}
