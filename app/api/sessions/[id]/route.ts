// Track B2. /api/sessions/[id] — fetch (with decrypted utterances), patch, soft-delete.

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db/client";
import { calls, utterances } from "@/lib/db/schema";
import { decryptPHI, PHIDecryptError } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/api/auth";
import { patchSessionBodySchema } from "@/lib/api/zod-schemas";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";
import { dbToFe, feToDb } from "@/lib/api/urgency";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function loadOwnedCall(id: string, userId: string) {
  const rows = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("call not found");
  if (row.staffUserId !== null && row.staffUserId !== userId) {
    throw new ForbiddenError("not the call owner");
  }
  return row;
}

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);
    const call = await loadOwnedCall(id, user.userId);

    const utts = await db
      .select()
      .from(utterances)
      .where(eq(utterances.callId, id))
      .orderBy(asc(utterances.ts));

    const decrypted = await Promise.all(
      utts.map(async (u) => {
        try {
          const [text, translation] = await Promise.all([
            decryptPHI(u.textEnc),
            decryptPHI(u.translationEnc),
          ]);
          return {
            id: u.id,
            role: u.role,
            lang: u.lang,
            text,
            translation,
            ts: u.ts.toISOString(),
            audioStorageKey: u.audioStorageKey,
          };
        } catch (err) {
          if (err instanceof PHIDecryptError) {
            await recordAudit({
              actorId: user.userId,
              action: "decrypt_failed",
              targetType: "utterance",
              targetId: u.id,
            });
          }
          // Spec §7: never display garbled text. Return null bodies + flag.
          return {
            id: u.id,
            role: u.role,
            lang: u.lang,
            text: null,
            translation: null,
            ts: u.ts.toISOString(),
            audioStorageKey: u.audioStorageKey,
            decryptError: true,
          };
        }
      }),
    );

    await recordAudit({
      actorId: user.userId,
      action: "view",
      targetType: "call",
      targetId: id,
    });

    return NextResponse.json({
      id: call.id,
      startedAt: call.startedAt.toISOString(),
      endedAt: call.endedAt ? call.endedAt.toISOString() : null,
      urgency: dbToFe(call.urgency),
      outcome: call.outcome ?? null,
      utterances: decrypted,
      trace_id: traceId,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);
    await loadOwnedCall(id, user.userId);

    const json: unknown = await req.json().catch(() => null);
    const parsed = patchSessionBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid patch body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }

    const updates: Partial<typeof calls.$inferInsert> = {};
    if (parsed.data.urgency) updates.urgency = feToDb(parsed.data.urgency);
    if (parsed.data.outcome) {
      // Frontend vocab → DB enum mapping. handled→completed, abandoned→dropped.
      const map: Record<string, "completed" | "dropped" | "transferred" | "voicemail" | "fallback"> = {
        handled: "completed",
        abandoned: "dropped",
        transferred: "transferred",
        voicemail: "voicemail",
        fallback: "fallback",
      };
      updates.outcome = map[parsed.data.outcome];
    }
    if (parsed.data.endedAt) updates.endedAt = new Date(parsed.data.endedAt);

    const updated = await db
      .update(calls)
      .set(updates)
      .where(eq(calls.id, id))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError("call not found");

    await recordAudit({
      actorId: user.userId,
      action: "edit",
      targetType: "call",
      targetId: id,
    });

    return NextResponse.json({
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      urgency: dbToFe(row.urgency),
      outcome: row.outcome ?? null,
      trace_id: traceId,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);
    await loadOwnedCall(id, user.userId);

    // Soft delete only — schema retention rules require we keep the row.
    await db
      .update(calls)
      .set({ outcome: "dropped", endedAt: new Date() })
      .where(eq(calls.id, id));

    await recordAudit({
      actorId: user.userId,
      action: "delete",
      targetType: "call",
      targetId: id,
      reason: "abandoned",
    });

    return NextResponse.json({ id, outcome: "abandoned", trace_id: traceId });
  } catch (err) {
    return errorToResponse(err);
  }
}
