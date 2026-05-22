// Track B2. Typed errors for API routes + JSON serialization helper.
// Spec §7: every route response shape `{code, message, retryable, traceId}`.
// PHI must never be embedded in `message` — callers pass sanitized text only.

import { NextResponse } from "next/server";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "validation"
  | "not_found"
  | "rate_limited"
  | "translate_failed"
  | "translate_refused"
  | "tts_failed"
  | "stt_failed"
  | "suggest_failed"
  | "internal";

export interface ApiErrorJson {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  trace_id: string;
}

export function newTraceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export abstract class BaseApiError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
  readonly retryable: boolean;
  readonly traceId: string;
  constructor(
    message: string,
    opts?: { retryable?: boolean; traceId?: string; cause?: unknown },
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.retryable = opts?.retryable ?? false;
    this.traceId = opts?.traceId ?? newTraceId();
  }
}

export class UnauthorizedError extends BaseApiError {
  readonly code = "unauthenticated" as const;
  readonly status = 401;
  constructor(message = "not signed in", opts?: { traceId?: string; cause?: unknown }) {
    super(message, { ...opts, retryable: false });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends BaseApiError {
  readonly code = "forbidden" as const;
  readonly status = 403;
  constructor(message = "forbidden", opts?: { traceId?: string; cause?: unknown }) {
    super(message, { ...opts, retryable: false });
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends BaseApiError {
  readonly code = "validation" as const;
  readonly status = 400;
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(
    message: string,
    issues: ReadonlyArray<{ path: string; message: string }> = [],
    opts?: { traceId?: string },
  ) {
    super(message, { ...opts, retryable: false });
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export class NotFoundError extends BaseApiError {
  readonly code = "not_found" as const;
  readonly status = 404;
  constructor(message = "not found", opts?: { traceId?: string }) {
    super(message, { ...opts, retryable: false });
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends BaseApiError {
  readonly code = "rate_limited" as const;
  readonly status = 429;
  constructor(message = "rate limited", opts?: { traceId?: string; cause?: unknown }) {
    super(message, { ...opts, retryable: true });
    this.name = "RateLimitError";
  }
}

export class TranslateError extends BaseApiError {
  readonly code: "translate_failed" | "translate_refused";
  readonly status: number;
  constructor(
    message: string,
    opts: {
      retryable: boolean;
      refusal?: boolean;
      status?: number;
      traceId?: string;
      cause?: unknown;
    },
  ) {
    super(message, opts);
    this.name = "TranslateError";
    this.code = opts.refusal ? "translate_refused" : "translate_failed";
    this.status = opts.status ?? (opts.refusal ? 422 : 502);
  }
}

export class TTSError extends BaseApiError {
  readonly code = "tts_failed" as const;
  readonly status: number;
  constructor(
    message: string,
    opts?: { retryable?: boolean; status?: number; traceId?: string; cause?: unknown },
  ) {
    super(message, opts);
    this.name = "TTSError";
    this.status = opts?.status ?? 502;
  }
}

export class STTError extends BaseApiError {
  readonly code = "stt_failed" as const;
  readonly status: number;
  constructor(
    message: string,
    opts?: { retryable?: boolean; status?: number; traceId?: string; cause?: unknown },
  ) {
    super(message, opts);
    this.name = "STTError";
    this.status = opts?.status ?? 502;
  }
}

// Track C1 — AI reply suggestion error.
export class SuggestError extends BaseApiError {
  readonly code = "suggest_failed" as const;
  readonly status: number;
  constructor(
    message: string,
    opts?: { retryable?: boolean; status?: number; traceId?: string; cause?: unknown },
  ) {
    super(message, opts);
    this.name = "SuggestError";
    this.status = opts?.status ?? 502;
  }
}

// Sanitized error log — never include text, translation, name, phone, dob fields.
function sanitizedLog(err: unknown, traceId: string): void {
  const safe = {
    traceId,
    name: err instanceof Error ? err.name : "Unknown",
    code:
      err instanceof BaseApiError
        ? err.code
        : err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "unknown",
    status:
      err instanceof BaseApiError
        ? err.status
        : err && typeof err === "object" && "status" in err
          ? Number((err as { status: unknown }).status) || undefined
          : undefined,
  };
  // eslint-disable-next-line no-console
  console.error("[api-error]", safe);
}

export function errorToResponse(err: unknown): NextResponse<ApiErrorJson> {
  // Map any error into the canonical envelope. Generate a traceId if missing.
  const traceId = err instanceof BaseApiError ? err.traceId : newTraceId();
  sanitizedLog(err, traceId);

  if (err instanceof BaseApiError) {
    const body: ApiErrorJson = {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      trace_id: traceId,
    };
    return NextResponse.json<ApiErrorJson>(body, { status: err.status });
  }

  return NextResponse.json<ApiErrorJson>(
    {
      code: "internal",
      message: "internal error",
      retryable: false,
      trace_id: traceId,
    },
    { status: 500 },
  );
}
