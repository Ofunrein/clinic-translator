// Track C2. Stub for Azure OpenAI translate / suggest. Phase 2 wires real client.

import { TranslateError, SuggestError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";
import type { TranslateResult, SuggestStreamEvent } from "../clients";

export async function translateAzure(_args: unknown): Promise<TranslateResult> {
  throw new TranslateError("azure-openai translate not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("azure-openai", "translate"),
  });
}

export async function* suggestAzure(_args: unknown): AsyncIterable<SuggestStreamEvent> {
  throw new SuggestError("azure-openai suggest not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("azure-openai", "suggest"),
  });
  yield { token: "" };
}
