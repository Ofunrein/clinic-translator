// Track C2. Stub for AWS Polly TTS. Phase 2 will wire the real Polly client.
import { TTSError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";

export async function synthesizePolly(_args: {
  text: string;
  voice: string;
  engine: "neural" | "generative" | "long-form" | "standard";
}): Promise<{ audio: Buffer; cacheHit: boolean; voice: string; fellBack: boolean }> {
  // Surface as TTSError so the route's error envelope is consistent for the
  // UI; cause carries the typed sentinel for tests.
  throw new TTSError("polly tts not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("polly", "tts"),
  });
}
