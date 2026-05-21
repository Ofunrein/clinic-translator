// Track C2. Stub for Cartesia Sonic-2 TTS. Phase 2 wires real client.
import { TTSError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";

export async function synthesizeCartesia(_args: {
  text: string;
  voice: string;
  engine: "sonic-2";
}): Promise<{ audio: Buffer; cacheHit: boolean; voice: string; fellBack: boolean }> {
  throw new TTSError("cartesia tts not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("cartesia", "tts"),
  });
}
