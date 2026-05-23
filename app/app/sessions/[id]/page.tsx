import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { calls, utterances } from "@/lib/db/schema";
import { decryptPHI } from "@/lib/crypto";
import { Badge } from "@/components/ui/badge";

type Urgency = "low" | "normal" | "high" | "urgent";

function urgencyVariant(
  urgency: Urgency,
): "default" | "secondary" | "destructive" | "outline" {
  if (urgency === "urgent" || urgency === "high") return "destructive";
  if (urgency === "low") return "secondary";
  return "default";
}

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "ongoing";
  const ms = end.getTime() - start.getTime();
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function formatTs(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function safeDecrypt(buf: Buffer | null): Promise<string> {
  if (!buf) return "";
  try {
    return (await decryptPHI(buf)) ?? "";
  } catch {
    return "[encrypted]";
  }
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.userId) redirect("/");

  // Fetch the call record.
  const callRows = await db
    .select()
    .from(calls)
    .where(eq(calls.id, id))
    .limit(1);

  const call = callRows[0];
  if (!call) notFound();

  // Verify ownership (staff or admin can see their own calls).
  if (call.staffUserId !== session.userId && session.user?.role !== "admin") {
    redirect("/app/sessions");
  }

  // Fetch utterances ordered by time.
  const rawUtterances = await db
    .select()
    .from(utterances)
    .where(eq(utterances.callId, id))
    .orderBy(asc(utterances.ts));

  // Decrypt all text fields in parallel.
  const decrypted = await Promise.all(
    rawUtterances.map(async (u) => ({
      id: u.id,
      role: u.role,
      lang: u.lang,
      ts: u.ts,
      text: await safeDecrypt(u.textEnc),
      translation: await safeDecrypt(u.translationEnc),
    })),
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/app/sessions"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to sessions
        </Link>
        <h1 className="mt-2 font-mono text-lg font-semibold sm:text-xl">
          {id.slice(0, 8)}&hellip;
        </h1>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-zinc-50 px-3 py-3 sm:gap-3 sm:px-4 dark:bg-zinc-900">
        <Badge variant={urgencyVariant(call.urgency as Urgency)}>
          {call.urgency}
        </Badge>
        {call.outcome && <Badge variant="outline">{call.outcome}</Badge>}
        <span className="text-sm text-muted-foreground">
          Started: {call.startedAt.toLocaleDateString()}{" "}
          {call.startedAt.toLocaleTimeString()}
        </span>
        <span className="text-sm text-muted-foreground">
          Duration: {formatDuration(call.startedAt, call.endedAt)}
        </span>
        <span className="text-sm text-muted-foreground">
          {decrypted.length} utterance{decrypted.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Column headers */}
      {decrypted.length > 0 && (
        <div className="hidden gap-4 lg:grid lg:grid-cols-2">
          <div className="rounded-t-md border-b-2 border-sky-400 pb-1 text-center text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
            Patient (ES)
          </div>
          <div className="rounded-t-md border-b-2 border-emerald-400 pb-1 text-center text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Staff (EN)
          </div>
        </div>
      )}

      {/* Transcript */}
      {decrypted.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No utterances recorded for this session.
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            This page shows the bilingual transcript saved to the server during the call
            (patient Spanish + English translation, staff English + Spanish translation).
            If the call ran but nothing appears here, messages may only have been kept in the
            browser — new calls sync on translate and when you end the call.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {decrypted.map((u) => {
            const isPatient = u.role === "patient";
            return (
              <div key={u.id} className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-4">
                {isPatient ? (
                  <>
                    {/* Patient side */}
                    <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/30">
                      <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400">
                        <span>Patient</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatTs(u.ts)}</span>
                      </div>
                      {u.text ? (
                        <p className="text-sm leading-snug text-foreground">
                          {u.text}
                        </p>
                      ) : (
                        <p className="text-xs italic text-muted-foreground">
                          [no text]
                        </p>
                      )}
                      {u.translation && (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          {u.translation}
                        </p>
                      )}
                    </div>
                    {/* Empty staff side — desktop only */}
                    <div className="hidden lg:block" />
                  </>
                ) : (
                  <>
                    {/* Empty patient side — desktop only */}
                    <div className="hidden lg:block" />
                    {/* Staff side */}
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/30">
                      <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        <span>Staff</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatTs(u.ts)}</span>
                      </div>
                      {u.text ? (
                        <p className="text-sm leading-snug text-foreground">
                          {u.text}
                        </p>
                      ) : (
                        <p className="text-xs italic text-muted-foreground">
                          [no text]
                        </p>
                      )}
                      {u.translation && (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          {u.translation}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
