// Owned by Track B3. Single utterance row, used by both PatientPane and StaffPane.
// Spec §4.1 (ES primary, EN translation muted underneath / vice versa) +
// §6 (`components/GlossaryHit.tsx` inline highlights).
"use client";

import * as React from "react";
import type { Utterance } from "@/lib/session";
import {
  findGlossaryHits,
  type Dialect,
  type GlossaryHit as GlossaryHitData,
} from "@/lib/medical-glossary";
import { GlossaryHit } from "./GlossaryHit";
import { cn, formatTime } from "@/lib/utils";

export interface TranscriptItemProps {
  utterance: Utterance;
  /** Dialect hint for glossary priority. */
  dialect?: Dialect;
  className?: string;
}

export function TranscriptItem({
  utterance,
  dialect = "all",
  className,
}: TranscriptItemProps): React.ReactElement {
  const isPatient = utterance.role === "patient";
  // Primary line is whatever the speaker actually said; translation goes underneath.
  const primary = utterance.text;
  const secondary = utterance.translation;

  return (
    <div
      data-utterance-id={utterance.id}
      data-role={utterance.role}
      data-partial={utterance.isPartial ? "true" : "false"}
      className={cn(
        "flex flex-col gap-0.5 rounded-md border px-3 py-2",
        isPatient
          ? "border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/30"
          : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30",
        utterance.isPartial && "opacity-60",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{isPatient ? "Patient" : "Staff"}</span>
        <span aria-hidden="true">·</span>
        <span>{utterance.langPrimary.toUpperCase()}</span>
        <span aria-hidden="true">·</span>
        <span>{formatTime(utterance.ts)}</span>
        {utterance.isPartial ? (
          <span
            aria-label="partial transcript"
            className="ml-auto rounded-sm bg-zinc-200 px-1.5 py-0.5 text-[9px] dark:bg-zinc-800"
          >
            partial
          </span>
        ) : null}
      </div>
      <p className="text-sm leading-snug text-foreground">
        <RenderWithGlossary text={primary} dialect={dialect} />
      </p>
      {secondary ? (
        <p className="text-xs leading-snug text-muted-foreground">
          <RenderWithGlossary text={secondary} dialect={dialect} />
        </p>
      ) : null}
    </div>
  );
}

interface RenderWithGlossaryProps {
  text: string;
  dialect: Dialect;
}

function RenderWithGlossary({
  text,
  dialect,
}: RenderWithGlossaryProps): React.ReactElement {
  const hits: GlossaryHitData[] = React.useMemo(
    () => findGlossaryHits(text, dialect),
    [text, dialect],
  );

  if (hits.length === 0) {
    return <>{text}</>;
  }

  const out: React.ReactNode[] = [];
  let cursor = 0;
  hits.forEach((hit, i) => {
    if (hit.start > cursor) {
      out.push(
        <React.Fragment key={`t-${cursor}`}>
          {text.slice(cursor, hit.start)}
        </React.Fragment>,
      );
    }
    out.push(
      <GlossaryHit
        key={`g-${i}-${hit.start}`}
        term={hit.term}
        matched={hit.matched}
      />,
    );
    cursor = hit.end;
  });
  if (cursor < text.length) {
    out.push(
      <React.Fragment key={`t-tail`}>{text.slice(cursor)}</React.Fragment>,
    );
  }
  return <>{out}</>;
}
