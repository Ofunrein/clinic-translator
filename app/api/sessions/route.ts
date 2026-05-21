// Track B2. /api/sessions — create call rows + list current user's calls.
// Spec §4.2, §5.

import { NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/api/auth";
import { createSessionBodySchema } from "@/lib/api/zod-schemas";
import {
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";
import { dbToFe, feToDb } from "@/lib/api/urgency";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const user = await requireUser(req);
    // Body is optional (page.tsx sends `{ urgency }`).
    const json: unknown = await req.json().catch(() => ({}));
    const parsed = createSessionBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid session body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }

    const dbUrgency = parsed.data.urgency ? feToDb(parsed.data.urgency) : "normal";

    const inserted = await db
      .insert(calls)
      .values({
        staffUserId: user.userId,
        urgency: dbUrgency,
        patientId: parsed.data.patientId ?? null,
      })
      .returning({
        id: calls.id,
        startedAt: calls.startedAt,
        urgency: calls.urgency,
      });
    const row = inserted[0];
    if (!row) {
      return errorToResponse(new Error("failed to create call"));
    }

    await recordAudit({
      actorId: user.userId,
      action: "create",
      targetType: "call",
      targetId: row.id,
    });

    return NextResponse.json(
      {
        id: row.id,
        startedAt: row.startedAt.toISOString(),
        urgency: dbToFe(row.urgency),
        trace_id: traceId,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const user = await requireUser(req);
    const rows = await db
      .select({
        id: calls.id,
        startedAt: calls.startedAt,
        endedAt: calls.endedAt,
        urgency: calls.urgency,
        outcome: calls.outcome,
      })
      .from(calls)
      .where(and(eq(calls.staffUserId, user.userId)))
      .orderBy(desc(calls.startedAt))
      .limit(20);

    return NextResponse.json({
      sessions: rows.map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt ? r.endedAt.toISOString() : null,
        urgency: dbToFe(r.urgency),
        outcome: r.outcome ?? null,
      })),
      trace_id: traceId,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
