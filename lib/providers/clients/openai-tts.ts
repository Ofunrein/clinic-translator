// Track C2. Stub for OpenAI TTS. Phase 2 wires real client.
import { TTSError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";

export async function synthesizeOpenAi(_args: {
  text: string;
  voice: string;
  engine: "tts-1" | "tts-1-hd";
}): Promise<{ audio: Buffer; cacheHit: boolean; voice: string; fellBack: boolean }> {
  throw new TTSError("openai tts not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("openai-tts", "tts"),
  });
}
