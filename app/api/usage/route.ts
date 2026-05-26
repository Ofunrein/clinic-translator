import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { ForbiddenError, UnauthorizedError, errorToResponse } from "@/lib/api/errors";
import { gte, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    if (user.role !== "admin" && user.role !== "owner") {
      throw new ForbiddenError("admin only");
    }
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return errorToResponse(err) as NextResponse;
    }
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }

  const daysParam = new URL(req.url).searchParams.get("days");
  const days = Math.min(Math.max(parseInt(daysParam ?? "7", 10) || 7, 1), 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const rows = await db
      .select({
        route:            usageEvents.route,
        estimatedCostUsd: usageEvents.estimatedCostUsd,
        day:              sql<string>`to_char(${usageEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, new Date(since)));

    let totalCostUsd = 0;
    const byRoute: Record<string, number> = {};
    const byDay: Record<string, { costUsd: number; calls: number }> = {};

    for (const row of rows) {
      const cost = parseFloat(row.estimatedCostUsd);
      totalCostUsd += cost;

      byRoute[row.route] = (byRoute[row.route] ?? 0) + cost;

      if (!byDay[row.day]) byDay[row.day] = { costUsd: 0, calls: 0 };
      byDay[row.day].costUsd += cost;
      byDay[row.day].calls += 1;
    }

    const byDayArr = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { costUsd, calls }]) => ({
        date,
        costUsd: parseFloat(costUsd.toFixed(6)),
        calls,
      }));

    return NextResponse.json({
      totalCostUsd: parseFloat(totalCostUsd.toFixed(6)),
      byDay: byDayArr,
      byRoute: Object.fromEntries(
        Object.entries(byRoute).map(([k, v]) => [k, parseFloat(v.toFixed(6))]),
      ),
    });
  } catch (err) {
    console.error("[usage] GET /api/usage error", err);
    return NextResponse.json({ code: "usage_unavailable" }, { status: 500 });
  }
}
