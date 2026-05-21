// Track C3 — urgency keyword alert banner.
// Shows when scanUrgencyKeywords trips on the latest patient final.
// Plays the soft Web Audio chirp via playUrgencyAlert (caller wires the
// AudioContext). NEVER auto-dials 911 — friend decides.
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UrgencyVerdict, UrgencyKeywordCategory } from "@/lib/edge/urgency-keywords";

const CATEGORY_LABEL: Record<UrgencyKeywordCategory, string> = {
  cardiac: "Cardiac",
  respiratory: "Respiratory",
  bleeding: "Bleeding",
  neuro: "Neurological",
  trauma: "Trauma",
  obstetric: "Obstetric",
  explicit_emergency: "Emergency",
};

export interface UrgencyAlertProps {
  verdict: UrgencyVerdict | null;
  /** Friend dismisses for the rest of this utterance only — re-fires on next final. */
  onDismiss: () => void;
  /** Friend escalates: marks call urgency=emergency + opens transfer flow. */
  onEscalate?: () => void;
  className?: string;
}

export function UrgencyAlert({
  verdict,
  onDismiss,
  onEscalate,
  className,
}: UrgencyAlertProps): React.ReactElement | null {
  if (!verdict || !verdict.escalate) return null;
  const cats = verdict.categories.slice(0, 2).map((c) => CATEGORY_LABEL[c]).join(", ");
  return (
    <div
      role="alert"
      data-testid="urgency-alert"
      className={cn(
        "flex items-center justify-between gap-3 border-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-900 shadow-sm dark:border-red-700 dark:bg-red-950 dark:text-red-100",
        className,
      )}
    >
      <div className="flex flex-col">
        <span className="font-bold uppercase tracking-wide">
          ⚠ Urgent keyword detected
        </span>
        <span className="text-xs">
          {cats || "Possible medical emergency"} — call 911 if patient is in distress.
        </span>
      </div>
      <div className="flex gap-2">
        {onEscalate ? (
          <Button size="sm" variant="destructive" onClick={onEscalate}>
            Escalate
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
