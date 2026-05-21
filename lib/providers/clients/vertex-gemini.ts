// Track C2. Stub for Google Vertex Gemini translate / suggest. Phase 2 wires
// the real client.

import { TranslateError, SuggestError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";
import type { TranslateResult, SuggestStreamEvent } from "../clients";

export async function translateVertex(_args: unknown): Promise<TranslateResult> {
  throw new TranslateError("vertex-gemini translate not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("vertex-gemini", "translate"),
  });
}

export async function* suggestVertex(_args: unknown): AsyncIterable<SuggestStreamEvent> {
  throw new SuggestError("vertex-gemini suggest not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("vertex-gemini", "suggest"),
  });
  // Unreachable but keeps TS happy for the AsyncIterable contract.
  yield { token: "" };
}
