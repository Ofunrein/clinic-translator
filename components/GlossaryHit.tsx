// Owned by Track B3. Inline span wrapping a glossary term with an EN↔ES tooltip.
// Spec §6 (`components/GlossaryHit.tsx`).
"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GlossaryTerm } from "@/lib/medical-glossary";
import { cn } from "@/lib/utils";

export interface GlossaryHitProps {
  term: GlossaryTerm;
  /** The literal substring matched in the source — preserves original casing. */
  matched: string;
  className?: string;
}

const CATEGORY_LABEL: Record<GlossaryTerm["category"], string> = {
  drug:      "drug",
  procedure: "procedure",
  intake:    "intake",
  other:     "term",
};

export function GlossaryHit({
  term,
  matched,
  className,
}: GlossaryHitProps): React.ReactElement {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-glossary-hit
            data-category={term.category}
            className={cn(
              "cursor-help underline decoration-dotted decoration-primary/60 underline-offset-2",
              className,
            )}
          >
            {matched}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="font-semibold">
              EN: <span className="font-normal">{term.en}</span>
            </span>
            <span className="font-semibold">
              ES: <span className="font-normal">{term.es}</span>
            </span>
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              {CATEGORY_LABEL[term.category]}
              {term.dialect !== "all" ? ` · ${term.dialect}` : ""}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
