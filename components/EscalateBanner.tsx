// Track C1. Red banner shown when the AI flagged the patient turn as
// requiring transfer (clinical, drug-dose, billing, emergency, etc).
//
// Suggestion text is rendered muted; the staff member must explicitly
// click "Send anyway" to override and stage the draft into the textarea.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EscalateBannerProps {
  /** The model's suggestion text (will likely be a "transfer" line). */
  suggestion: string;
  /** Called when the staffer accepts the AI transfer recommendation. */
  onAcknowledge: () => void;
  /** Called when the staffer overrides and wants to stage the draft anyway. */
  onOverride: () => void;
  /** Called when the staffer fully dismisses the suggestion. */
  onDismiss: () => void;
  className?: string;
}

export function EscalateBanner(props: EscalateBannerProps): React.ReactElement {
  return (
    <div
      role="alert"
      data-testid="escalate-banner"
      className={cn(
        "rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100",
        props.className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-semibold">
            AI suggests transfer — do not send drug or dose info.
          </p>
          <p className="mt-1 text-xs opacity-80">
            This question is outside the front-desk scope. Transfer the patient to
            a clinician or escalate per clinic policy.
          </p>
          {props.suggestion ? (
            <p className="mt-2 text-xs italic opacity-60" data-testid="escalate-suggestion">
              Draft (muted, not staged): {props.suggestion}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={props.onAcknowledge}
          data-testid="escalate-ack"
        >
          Acknowledge & transfer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={props.onOverride}
          data-testid="escalate-override"
        >
          Send anyway (manual review)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={props.onDismiss}
          data-testid="escalate-dismiss"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
