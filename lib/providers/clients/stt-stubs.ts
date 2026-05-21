// Track C2. Stubs for unwired STT providers (AWS Transcribe, Google Speech,
// Whisper-on-Azure). Phase 2 wires real clients.

import { STTError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";

export async function streamAwsTranscribe(_args: unknown): Promise<never> {
  throw new STTError("aws-transcribe stt not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("aws-transcribe", "stt"),
  });
}

export async function streamGoogleSpeech(_args: unknown): Promise<never> {
  throw new STTError("google-speech stt not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("google-speech", "stt"),
  });
}

export async function streamWhisperAzure(_args: unknown): Promise<never> {
  throw new STTError("whisper-azure stt not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("whisper-azure", "stt"),
  });
}
