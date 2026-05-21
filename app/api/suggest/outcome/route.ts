// Track C1 — POST /api/suggest/outcome.
// Records whether the staff `accepted | edited | dismissed` an AI draft.
// Side-effect: updates utterance.suggestion_outcome + audit_log entry.

import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { utterances, calls } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/api/auth";
import { suggestOutcomeSchema } from "@/lib/api/zod-schemas";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";

export const runtime = "nodejs";

interface OutcomeOk {
  ok: true;
  trace_id: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const user = await requireUser(req);

    const json: unknown = await req.json().catch(() => null);
    const parsed = suggestOutcomeSchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid suggest outcome body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const body = parsed.data;

    // Verify utterance + call ownership.
    const rows = await db
      .select({
        id: utterances.id,
        callId: utterances.callId,
      })
      .from(utterances)
      .where(eq(utterances.id, body.utteranceId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundError("utterance not found", { traceId });
    }
    const ownerRows = await db
      .select({ staffUserId: calls.staffUserId })
      .from(calls)
      .where(eq(calls.id, row.callId))
      .limit(1);
    const owner = ownerRows[0];
    if (!owner) {
      throw new NotFoundError("call not found", { traceId });
    }
    if (owner.staffUserId !== null && owner.staffUserId !== user.userId) {
      throw new ForbiddenError("call not accessible", { traceId });
    }

    await db
      .update(utterances)
      .set({ suggestionOutcome: body.outcome })
      .where(eq(utterances.id, body.utteranceId));

    await recordAudit({
      actorId: user.userId,
      action: "edit",
      targetType: "utterance",
      targetId: body.utteranceId,
      reason: `ai_suggest_outcome:${body.outcome}:${traceId}`,
    });

    const okBody: OutcomeOk = { ok: true, trace_id: traceId };
    return NextResponse.json(okBody, { status: 200 });
  } catch (err) {
    return errorToResponse(err);
  }
}
