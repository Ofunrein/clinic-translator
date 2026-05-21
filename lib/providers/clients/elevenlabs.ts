// Track C2. Stub for ElevenLabs TTS. Phase 2 wires real client (gated on BAA).
import { TTSError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";

export async function synthesizeElevenLabs(_args: {
  text: string;
  voice: string;
  engine: "turbo-v2-5";
}): Promise<{ audio: Buffer; cacheHit: boolean; voice: string; fellBack: boolean }> {
  throw new TTSError("elevenlabs tts not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("elevenlabs", "tts"),
  });
}
