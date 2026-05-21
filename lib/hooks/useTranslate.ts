// Owned by Track B3.
// React Query mutation wrapping `POST /api/translate` with single-flight
// retry on 429. Spec §5.1 step 5, §5.2 step 2, §7 (translate 5xx/429).
"use client";

import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/session";

export interface TranslateRequest {
  text: string;
  src: "es" | "en";
  dst: "es" | "en";
}

export interface TranslateResponse {
  translation: string;
  glossary_hits?: Array<{ en: string; es: string; category?: string }>;
  trace_id?: string;
}

interface ApiError {
  code: string;
  message: string;
  retryable?: boolean;
  traceId?: string;
}

class TranslateError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function translateOnce(req: TranslateRequest): Promise<TranslateResponse> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.ok) {
    return (await res.json()) as TranslateResponse;
  }
  let body: ApiError | null = null;
  try {
    body = (await res.json()) as ApiError;
  } catch {
    body = null;
  }
  throw new TranslateError(
    body?.code ?? `http_${res.status}`,
    body?.message ?? `translate failed: ${res.status}`,
    res.status,
    body?.retryable ?? (res.status === 429 || res.status >= 500),
  );
}

export type UseTranslate = UseMutationResult<
  TranslateResponse,
  TranslateError,
  TranslateRequest
>;

export function useTranslate(): UseTranslate {
  const setStatus = useSessionStore((s) => s.setStatus);

  return useMutation<TranslateResponse, TranslateError, TranslateRequest>({
    mutationKey: ["translate"],
    mutationFn: async (req) => {
      try {
        return await translateOnce(req);
      } catch (err) {
        if (err instanceof TranslateError && err.status === 429) {
          // Single-flight retry on rate-limit per spec §7.
          await new Promise((r) => setTimeout(r, 750));
          return translateOnce(req);
        }
        throw err;
      }
    },
    onError: (err) => {
      setStatus("degraded", `translate: ${err.message}`);
    },
    onSuccess: () => {
      // Don't downgrade an `offline` status from a success — only clear
      // a `degraded` translate flag.
      const { status } = useSessionStore.getState();
      if (status === "degraded") setStatus("ready");
    },
  });
}

export { TranslateError };
