// Owned by Track B3. Urgency dropdown for the active call.
// Spec §4.1 + §4.3 enum (call.urgency). The frontend uses an expanded
// 4-level vocabulary (`info|routine|urgent|emergency`) per Track B3
// spec; the API maps `routine→normal`, `urgent→high`, `emergency→urgent`,
// `info→low` to the DB enum (Track B2 owns the mapping).
"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Urgency = "info" | "routine" | "urgent" | "emergency";

const TONE: Record<Urgency, string> = {
  info:      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  routine:   "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  urgent:    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  emergency: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

const LABEL: Record<Urgency, string> = {
  info:      "Info",
  routine:   "Routine",
  urgent:    "Urgent",
  emergency: "Emergency",
};

export interface UrgencyFlagProps {
  value: Urgency;
  onChange: (next: Urgency) => void;
  /** When true, only the badge renders (read-only summary). */
  readOnly?: boolean;
  className?: string;
}

export function UrgencyFlag({
  value,
  onChange,
  readOnly,
  className,
}: UrgencyFlagProps): React.ReactElement {
  if (readOnly) {
    return (
      <Badge className={cn(TONE[value], "border-transparent", className)}>
        {LABEL[value]}
      </Badge>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs font-medium text-muted-foreground">Urgency</span>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as Urgency)}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(LABEL) as Urgency[]).map((k) => (
            <SelectItem key={k} value={k}>
              <span className={cn("inline-flex items-center gap-2")}>
                <span
                  aria-hidden="true"
                  className={cn("inline-block h-2 w-2 rounded-full", TONE[k])}
                />
                {LABEL[k]}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
