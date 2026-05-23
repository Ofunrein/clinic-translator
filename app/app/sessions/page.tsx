import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, count, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { calls, utterances } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "ongoing";
  const ms = end.getTime() - start.getTime();
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function urgencyVariant(
  urgency: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (urgency === "urgent") return "destructive";
  if (urgency === "high") return "destructive";
  if (urgency === "low") return "secondary";
  return "default";
}

export default async function SessionsPage() {
  const session = await auth();
  if (!session?.userId) redirect("/");

  const userId = session.userId;

  // Fetch calls for the current staff user with utterance counts.
  const rows = await db
    .select({
      id: calls.id,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      urgency: calls.urgency,
      outcome: calls.outcome,
      utteranceCount: count(utterances.id),
    })
    .from(calls)
    .leftJoin(utterances, eq(utterances.callId, calls.id))
    .where(eq(calls.staffUserId, userId))
    .groupBy(
      calls.id,
      calls.startedAt,
      calls.endedAt,
      calls.urgency,
      calls.outcome,
    )
    .orderBy(desc(calls.startedAt))
    .limit(50);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Session History
          </h1>
          <p className="text-sm text-muted-foreground">
            Past call sessions and bilingual transcripts
          </p>
        </div>
        <Link
          href="/app"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to app
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No sessions yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Start a call to record your first session.
          </p>
          <Link
            href="/app"
            className="mt-4 text-sm underline underline-offset-4"
          >
            Go to app
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <Link key={row.id} href={`/app/sessions/${row.id}`}>
              <Card className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <CardHeader className="pb-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="font-mono text-sm font-medium">
                      {row.id.slice(0, 8)}&hellip;
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={urgencyVariant(row.urgency)}>
                        {row.urgency}
                      </Badge>
                      {row.outcome && (
                        <Badge variant="outline">{row.outcome}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>Started:</dt>
                      <dd>
                        {row.startedAt.toLocaleDateString()}{" "}
                        {row.startedAt.toLocaleTimeString()}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Duration:</dt>
                      <dd>{formatDuration(row.startedAt, row.endedAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Utterances:</dt>
                      <dd>{row.utteranceCount}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
