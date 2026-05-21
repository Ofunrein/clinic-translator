// Track C3 — right-click correction popover. Replaces a wrong token in
// the transcript and triggers re-translate.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CorrectionPopoverProps {
  /** The wrong token the friend right-clicked. */
  wrong: string;
  /** Anchor element rect for positioning. */
  anchorRect: DOMRect | null;
  /** Friend confirms the correction. */
  onApply: (right: string) => Promise<void> | void;
  /** Friend cancels. */
  onCancel: () => void;
  className?: string;
}

export function CorrectionPopover({
  wrong,
  anchorRect,
  onApply,
  onCancel,
  className,
}: CorrectionPopoverProps): React.ReactElement | null {
  const [val, setVal] = React.useState(wrong);
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setVal(wrong);
    // Defer focus to next tick so the popover paints first.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [wrong]);

  if (!anchorRect) return null;

  const handleApply = async (): Promise<void> => {
    const right = val.trim();
    if (!right || right === wrong) {
      onCancel();
      return;
    }
    setSubmitting(true);
    try {
      await onApply(right);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Correct "${wrong}"`}
      data-testid="correction-popover"
      className={cn(
        "fixed z-50 w-72 rounded-md border bg-background p-3 shadow-lg",
        className,
      )}
      style={{
        top: Math.min(window.innerHeight - 200, anchorRect.bottom + 4),
        left: Math.min(window.innerWidth - 300, anchorRect.left),
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          void handleApply();
        }
      }}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Correct
      </div>
      <div className="mt-1 mb-2 text-xs text-muted-foreground">
        Was: <span className="rounded bg-muted px-1 py-0.5 font-mono">{wrong}</span>
      </div>
      <Input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Correct Spanish word"
        aria-label="correct text"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void handleApply();
          }}
          disabled={submitting || !val.trim() || val === wrong}
        >
          {submitting ? "Applying…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}
