// Track C1 — POST /api/suggest. Streams an English reply suggestion via SSE.
//
// Body: { sessionId, lastUtteranceId }
// Response: text/event-stream with frames
//   data: {"token":"..."}\n\n
//   ...
//   data: {"final":{"suggestion":"...","confidence":0.85,"escalate":false}}\n\n
//   event: error\ndata: {...}\n\n   (on failure)
//
// On final, the route persists `suggestion_text_enc`, `suggestion_confidence`,
// `suggestion_escalate` to the matching utterance row + writes an audit_log
// entry. The server NEVER auto-sends — staff must approve in the UI.

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { calls, patients, utterances } from "@/lib/db/schema";
import { decryptPHI, encryptPHI } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import {
  type SuggestTurn,
  type SuggestionResult,
} from "@/lib/anthropic";
import { suggestReply as dispatchSuggestReply } from "@/lib/providers/clients";
import { getClinicSettings, rowToClinicBlob, getActiveProviderConfig } from "@/lib/settings";
import { rowToClinicConfig } from "@/lib/clinic-knowledge";
import { DEFAULT_CLINIC, type ClinicConfig } from "@/lib/clinic-prompts";
import type { Dialect } from "@/lib/medical-glossary";
import { requireUser } from "@/lib/api/auth";
import { suggestRequestSchema } from "@/lib/api/zod-schemas";
import {
  ForbiddenError,
  NotFoundError,
  SuggestError,
  UnauthorizedError,
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";

export const runtime = "nodejs";

// Use a generous turn window so the model has context but the prompt stays
// bounded. 12 turns covers a typical opener + 5 exchanges.
const MAX_TURNS = 12;

interface ApiAuthedUser {
  userId: string;
}

function isDialect(d: string | null | undefined): d is Dialect {
  return d === "mx" || d === "cen" || d === "car" || d === "all";
}

async function resolveClinicConfig(): Promise<ClinicConfig> {
  try {
    const row = await getClinicSettings();
    return rowToClinicConfig(row);
  } catch {
    return DEFAULT_CLINIC;
  }
}

async function loadCallContext(
  sessionId: string,
  userId: string,
): Promise<{ dialect: Dialect; transcript: SuggestTurn[] } | null> {
  const callRows = await db
    .select({
      id: calls.id,
      patientId: calls.patientId,
      staffUserId: calls.staffUserId,
    })
    .from(calls)
    .where(eq(calls.id, sessionId))
    .limit(1);
  const callRow = callRows[0];
  if (!callRow) return null;
  if (callRow.staffUserId !== null && callRow.staffUserId !== userId) {
    return null;
  }

  let dialect: Dialect = "mx";
  if (callRow.patientId) {
    const patientRows = await db
      .select({ preferredDialect: patients.preferredDialect })
      .from(patients)
      .where(eq(patients.id, callRow.patientId))
      .limit(1);
    const pref = patientRows[0]?.preferredDialect ?? null;
    if (isDialect(pref)) dialect = pref;
  }

  const recent = await db
    .select({
      role: utterances.role,
      lang: utterances.lang,
      textEnc: utterances.textEnc,
      translationEnc: utterances.translationEnc,
      ts: utterances.ts,
    })
    .from(utterances)
    .where(eq(utterances.callId, sessionId))
    .orderBy(asc(utterances.ts))
    .limit(MAX_TURNS * 2); // buffer for any rows we drop on decrypt failure

  const turns: SuggestTurn[] = [];
  for (const row of recent) {
    // Patient turns: prefer EN translation; staff turns: prefer EN source.
    const enBuf =
      row.role === "patient"
        ? row.translationEnc
        : row.lang === "en"
          ? row.textEnc
          : row.translationEnc;
    if (!enBuf) continue;
    let plain: string | null;
    try {
      plain = await decryptPHI(enBuf);
    } catch {
      // Skip un-decryptable turn rather than drop the whole context.
      continue;
    }
    if (!plain) continue;
    turns.push({ role: row.role, text: plain });
  }
  // Keep only the last MAX_TURNS for prompt budget.
  const trimmed = turns.slice(Math.max(0, turns.length - MAX_TURNS));
  return { dialect, transcript: trimmed };
}

function sseFrame(payload: unknown, event?: string): Uint8Array {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const head = event ? `event: ${event}\n` : "";
  return new TextEncoder().encode(head + data);
}

async function persistSuggestion(args: {
  utteranceId: string;
  result: SuggestionResult;
  userId: string;
  traceId: string;
  lastUtteranceCallId: string;
}): Promise<void> {
  try {
    const enc = await encryptPHI(args.result.suggestion);
    await db
      .update(utterances)
      .set({
        suggestionTextEnc: enc,
        suggestionConfidence: args.result.confidence.toFixed(2),
        suggestionEscalate: args.result.escalate,
      })
      .where(eq(utterances.id, args.utteranceId));
    await recordAudit({
      actorId: args.userId,
      action: "create",
      targetType: "utterance",
      targetId: args.utteranceId,
      reason: `ai_suggest:${args.traceId}`,
    });
  } catch {
    // Persistence is best-effort — do not break the SSE stream.
  }
}

export async function POST(req: Request): Promise<Response> {
  const traceId = newTraceId();
  let user: ApiAuthedUser;
  try {
    const authed = await requireUser(req);
    user = { userId: authed.userId };
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return errorToResponse(err);
    }
    return errorToResponse(err);
  }

  let body: { sessionId: string; lastUtteranceId: string };
  try {
    const json: unknown = await req.json().catch(() => null);
    const parsed = suggestRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid suggest body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    body = parsed.data;
  } catch (err) {
    return errorToResponse(err);
  }

  // Pre-flight: verify the utterance row exists, belongs to the session, and
  // the caller owns the call.
  const utteranceRows = await db
    .select({ id: utterances.id, callId: utterances.callId })
    .from(utterances)
    .where(
      and(eq(utterances.id, body.lastUtteranceId), eq(utterances.callId, body.sessionId)),
    )
    .limit(1);
  if (!utteranceRows[0]) {
    return errorToResponse(new NotFoundError("utterance not found", { traceId }));
  }

  const ctx = await loadCallContext(body.sessionId, user.userId);
  if (!ctx) {
    return errorToResponse(new ForbiddenError("call not accessible", { traceId }));
  }

  const clinicContext = await resolveClinicConfig();

  // Snapshot now so the closure below doesn't fight TS narrowing.
  const utteranceId = body.lastUtteranceId;
  const sessionId = body.sessionId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Up-front audit — the staffer requested an AI draft.
      await recordAudit({
        actorId: user.userId,
        action: "view",
        targetType: "utterance",
        targetId: utteranceId,
        reason: `ai_suggest_request:${traceId}`,
      });

      try {
        // Best-effort upper bound on token frames — caller can also abort.
        let final: SuggestionResult | null = null;
        const active = await getActiveProviderConfig();
        for await (const event of dispatchSuggestReply({
          transcript: ctx.transcript,
          clinicContext,
          dialect: ctx.dialect,
          config: active.suggest,
        })) {
          if ("token" in event && event.token) {
            controller.enqueue(sseFrame({ token: event.token }));
          } else if ("final" in event && event.final) {
            final = event.final;
            controller.enqueue(sseFrame({ final: event.final }));
          }
        }
        if (final) {
          await persistSuggestion({
            utteranceId,
            result: final,
            userId: user.userId,
            traceId,
            lastUtteranceCallId: sessionId,
          });
        }
      } catch (err) {
        const safe =
          err instanceof SuggestError
            ? {
                code: err.code,
                message: err.message,
                retryable: err.retryable,
                trace_id: traceId,
              }
            : {
                code: "suggest_failed" as const,
                message: "suggest stream failed",
                retryable: true,
                trace_id: traceId,
              };
        controller.enqueue(sseFrame(safe, "error"));
      } finally {
        controller.enqueue(sseFrame({ done: true }, "end"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-trace-id": traceId,
    },
  });
}
