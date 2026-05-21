// Track B2. /api/glossary — list active glossary terms; admins add new ones.

import { NextResponse } from "next/server";
import { eq, or, isNull } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db/client";
import { glossaryTerms } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/api/auth";
import { requireRole, AuthorizationError } from "@/lib/auth/roles";
import {
  glossaryQuerySchema,
  createGlossaryBodySchema,
} from "@/lib/api/zod-schemas";
import {
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    await requireUser(req);

    const url = new URL(req.url);
    const parsed = glossaryQuerySchema.safeParse({
      dialect: url.searchParams.get("dialect") ?? undefined,
    });
    if (!parsed.success) {
      throw new ValidationError(
        "invalid glossary query",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }

    const dialect = parsed.data.dialect;
    const baseQuery = db.select().from(glossaryTerms);
    const rows =
      !dialect || dialect === "all"
        ? await baseQuery
        : await baseQuery.where(
            or(eq(glossaryTerms.dialect, dialect), isNull(glossaryTerms.dialect)),
          );

    return NextResponse.json({
      terms: rows.map((r) => ({
        id: r.id,
        en: r.en,
        es: r.es,
        dialect: r.dialect,
        category: r.category,
      })),
      trace_id: traceId,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    // Admin/owner only.
    const { userId } = await requireRole(req, ["admin", "owner"]);
    // Also runs the email-allowlist check (defense-in-depth).
    await requireUser(req);

    const json: unknown = await req.json().catch(() => null);
    const parsed = createGlossaryBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid glossary body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const body = parsed.data;

    const inserted = await db
      .insert(glossaryTerms)
      .values({
        en: body.en,
        es: body.es,
        dialect: body.dialect ?? null,
        category: body.category,
        createdBy: userId,
      })
      .returning({ id: glossaryTerms.id });
    const row = inserted[0];

    if (row) {
      await recordAudit({
        actorId: userId,
        action: "create",
        targetType: "glossary_term",
        targetId: row.id,
      });
    }

    return NextResponse.json(
      { id: row?.id ?? null, trace_id: traceId },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AuthorizationError) {
      // errorToResponse handles AuthorizationError shape.
      return errorToResponse(err);
    }
    return errorToResponse(err);
  }
}
