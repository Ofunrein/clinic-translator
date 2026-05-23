"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface SuggestionChipsProps {
  suggestion: string;
  isStreaming: boolean;
  confidence: number;
  onSendToPatient: () => void;
  onUseDraft: () => void;
  onDismiss: () => void;
}

function ConfidenceDot({ confidence }: { confidence: number }): React.ReactElement {
  const color =
    confidence >= 0.7
      ? "bg-cyan-500"
      : confidence >= 0.4
        ? "bg-yellow-400"
        : "bg-gray-400";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />;
}

export function SuggestionChips({
  suggestion,
  isStreaming,
  confidence,
  onSendToPatient,
  onUseDraft,
  onDismiss,
}: SuggestionChipsProps): React.ReactElement | null {
  const visible = suggestion.length > 0 || isStreaming;

  React.useEffect(() => {
    if (!visible) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if (!isStreaming) onSendToPatient();
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        if (!isStreaming) onUseDraft();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, isStreaming, onSendToPatient, onUseDraft, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        "border-cyan-200 bg-cyan-50/60",
        "dark:border-cyan-900 dark:bg-cyan-950/30",
      )}
      data-testid="suggestion-chips"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          AI suggestion
        </span>
        {!isStreaming && suggestion.length > 0 && (
          <ConfidenceDot confidence={confidence} />
        )}
      </div>

      <p
        className={cn(
          "mb-2 line-clamp-3 text-sm text-foreground",
          isStreaming && "animate-pulse",
        )}
      >
        {suggestion.length > 0 ? suggestion : "Thinking…"}
      </p>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50"
          disabled={isStreaming}
          onClick={onSendToPatient}
        >
          Send to patient &rarr;
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isStreaming}
          onClick={onUseDraft}
        >
          Use as draft
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onDismiss}
        >
          &times;
        </Button>
      </div>
    </div>
  );
}
