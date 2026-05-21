// Track B2. POST /api/translate — Bedrock Claude Sonnet 4.6 translation.
// Spec §4.2, §5.1 step 5, §5.2 step 2.
//
// Body: { text, src, dst, sessionId? }
// Response: { translation, glossary_hits, trace_id }
// Errors: { code, message, retryable, trace_id }
//
// Side-effects: when sessionId is present, persists an encrypted utterance row
// (text + translation) and writes an audit_log entry. The role is inferred
// from `src` — Spanish source = patient, English source = staff. PHI is never
// logged; only `trace_id` and sanitized fields appear in stderr.

import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calls, utterances } from "@/lib/db/schema";
import { encryptPHI } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { translate as dispatchTranslate } from "@/lib/providers/clients";
import { getActiveProviderConfig } from "@/lib/settings";
import { findGlossaryHits, type Dialect } from "@/lib/medical-glossary";
import { requireUser } from "@/lib/api/auth";
import { translateBodySchema } from "@/lib/api/zod-schemas";
import {
  TranslateError,
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";

export const runtime = "nodejs";

function dialectFor(_callId: string | undefined): Dialect {
  // The schema doesn't store per-call dialect today (B1 holds it on `patients`);
  // default to the clinic-wide MX baseline per spec §12 Q6.
  return "mx";
}

export async function POST(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const user = await requireUser(req);

    const json: unknown = await req.json().catch(() => null);
    const parsed = translateBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid translate body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const body = parsed.data;

    // Compute glossary hits up-front so we can both prompt the model and
    // return them to the client in the response shape Track B3 expects.
    const dialect = dialectFor(body.sessionId);
    const hits = findGlossaryHits(body.text, dialect);

    let result;
    try {
      const cfg = await getActiveProviderConfig();
      result = await dispatchTranslate({
        text: body.text,
        src: body.src,
        dst: body.dst,
        dialect,
        glossaryHits: hits,
        config: cfg.translate,
      });
    } catch (err) {
      if (err instanceof TranslateError && err.code === "translate_refused") {
        // Audit per spec §7 — refusal is a security-relevant event.
        await recordAudit({
          actorId: user.userId,
          action: "translate_refused",
          targetType: "call",
          targetId: body.sessionId ?? null,
          reason: "model refused",
        });
      }
      throw err;
    }

    // Persist (encrypted) when bound to a session.
    if (body.sessionId) {
      const ownerOk = await assertCallOwner(body.sessionId, user.userId);
      if (ownerOk) {
        const role = body.src === "es" ? "patient" : "staff";
        const [textEnc, transEnc] = await Promise.all([
          encryptPHI(body.text),
          encryptPHI(result.translation),
        ]);
        try {
          const inserted = await db
            .insert(utterances)
            .values({
              callId: body.sessionId,
              role,
              lang: body.src,
              textEnc,
              translationEnc: transEnc,
            })
            .returning({ id: utterances.id });
          const newId = inserted[0]?.id ?? null;
          await recordAudit({
            actorId: user.userId,
            action: "create",
            targetType: "utterance",
            targetId: newId,
          });
        } catch {
          // Don't fail the user-facing translate on a persistence error;
          // the frontend has its own IndexedDB queue per spec §7.
        }
      }
    }

    return NextResponse.json(
      {
        translation: result.translation,
        glossary_hits: result.glossary_hits,
        trace_id: traceId,
      },
      { status: 200 },
    );
  } catch (err) {
    return errorToResponse(err);
  }
}

async function assertCallOwner(callId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: calls.id, staffUserId: calls.staffUserId })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  // Allow null staffUserId (legacy) but enforce match when present.
  return row.staffUserId === null || row.staffUserId === userId;
}
