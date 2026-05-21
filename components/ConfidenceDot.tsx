// Track C1. Color-coded confidence pill with a tooltip explaining the band.
"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ConfidenceDotProps {
  /** 0.00–1.00 confidence from the model. */
  confidence: number;
  className?: string;
}

type Band = "high" | "medium" | "low";

function bandFor(confidence: number): Band {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

const BAND_COPY: Record<Band, string> = {
  high: "High confidence — staff may send as-is after a quick read.",
  medium:
    "Medium confidence — review and edit; the AI is unsure about wording or fit.",
  low: "Low confidence — treat as a starting point only; consider transferring.",
};

const BAND_CLASS: Record<Band, string> = {
  high:
    "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  medium:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  low:
    "border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
};

export function ConfidenceDot(props: ConfidenceDotProps): React.ReactElement {
  const band = bandFor(props.confidence);
  const pct = Math.round(props.confidence * 100);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              BAND_CLASS[band],
              props.className,
            )}
            data-testid="confidence-dot"
            data-band={band}
            aria-label={`AI confidence ${pct} percent — ${band}`}
          >
            <span
              className={cn(
                "mr-1 h-1.5 w-1.5 rounded-full",
                band === "high" && "bg-emerald-600",
                band === "medium" && "bg-amber-600",
                band === "low" && "bg-red-600",
              )}
              aria-hidden="true"
            />
            {pct}%
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{BAND_COPY[band]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
