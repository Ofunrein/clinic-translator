// Track B2. /api/sessions/[id]/utterances — append + paginated list.

import { NextResponse } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db/client";
import { calls, utterances } from "@/lib/db/schema";
import { decryptPHI, encryptPHI, PHIDecryptError } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/api/auth";
import {
  createUtteranceBodySchema,
  utterancesQuerySchema,
} from "@/lib/api/zod-schemas";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function assertOwner(callId: string, userId: string): Promise<void> {
  const rows = await db
    .select({ id: calls.id, staffUserId: calls.staffUserId })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("call not found");
  if (row.staffUserId !== null && row.staffUserId !== userId) {
    throw new ForbiddenError("not the call owner");
  }
}

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);
    await assertOwner(id, user.userId);

    const json: unknown = await req.json().catch(() => null);
    const parsed = createUtteranceBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid utterance body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const body = parsed.data;

    const [textEnc, transEnc] = await Promise.all([
      encryptPHI(body.text),
      body.translation ? encryptPHI(body.translation) : Promise.resolve(null),
    ]);

    const inserted = await db
      .insert(utterances)
      .values({
        callId: id,
        role: body.role,
        lang: body.lang,
        textEnc,
        translationEnc: transEnc,
        audioStorageKey: body.audioStorageKey ?? null,
      })
      .returning({ id: utterances.id, ts: utterances.ts });
    const row = inserted[0];
    if (!row) throw new Error("insert failed");

    await recordAudit({
      actorId: user.userId,
      action: "create",
      targetType: "utterance",
      targetId: row.id,
    });

    return NextResponse.json(
      {
        id: row.id,
        ts: row.ts.toISOString(),
        trace_id: traceId,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);
    await assertOwner(id, user.userId);

    const url = new URL(req.url);
    const queryRaw = {
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    };
    const parsed = utterancesQuerySchema.safeParse(queryRaw);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid utterances query",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const { limit, cursor } = parsed.data;

    const where = cursor
      ? and(eq(utterances.callId, id), gt(utterances.ts, new Date(cursor)))
      : eq(utterances.callId, id);

    const rows = await db
      .select()
      .from(utterances)
      .where(where)
      .orderBy(asc(utterances.ts))
      .limit(limit);

    const decrypted = await Promise.all(
      rows.map(async (u) => {
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

    const nextCursor =
      rows.length === limit ? rows[rows.length - 1].ts.toISOString() : null;

    await recordAudit({
      actorId: user.userId,
      action: "view",
      targetType: "utterance",
      targetId: null,
      reason: id,
    });

    return NextResponse.json({
      utterances: decrypted,
      nextCursor,
      trace_id: traceId,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
