// Track B2. POST /api/sessions/[id]/end — end the call (matches B3 frontend
// `End Call` mutation). Sets endedAt + outcome=completed (DB enum) which
// the frontend reads back as the call's outcome.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/api/auth";
import {
  ForbiddenError,
  NotFoundError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";
import { dbToFe } from "@/lib/api/urgency";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);

    const existing = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError("call not found");
    if (row.staffUserId !== null && row.staffUserId !== user.userId) {
      throw new ForbiddenError("not the call owner");
    }

    const updated = await db
      .update(calls)
      .set({
        endedAt: row.endedAt ?? new Date(),
        outcome: row.outcome ?? "completed",
      })
      .where(eq(calls.id, id))
      .returning();
    const out = updated[0];
    if (!out) throw new NotFoundError("call not found");

    await recordAudit({
      actorId: user.userId,
      action: "edit",
      targetType: "call",
      targetId: id,
      reason: "end_call",
    });

    return NextResponse.json({
      id: out.id,
      startedAt: out.startedAt.toISOString(),
      endedAt: out.endedAt ? out.endedAt.toISOString() : null,
      urgency: dbToFe(out.urgency),
      outcome: out.outcome ?? null,
      trace_id: traceId,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
