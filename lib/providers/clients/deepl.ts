// Track C2. Stub for DeepL translate. Phase 2 wires real client.

import { TranslateError } from "@/lib/api/errors";
import { ProviderNotImplementedError } from "../types";
import type { TranslateResult } from "../clients";

export async function translateDeepL(_args: unknown): Promise<TranslateResult> {
  throw new TranslateError("deepl translate not implemented (Phase 2)", {
    retryable: false,
    cause: new ProviderNotImplementedError("deepl", "translate"),
  });
}
