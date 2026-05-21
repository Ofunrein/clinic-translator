// Track C3 — replay button for a patient utterance row.
// Tiny — just a button + handler. Caller wires the actual playClip call.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReplayButtonProps {
  /** Caller invokes the replay buffer + audio playback. */
  onReplay: () => Promise<void> | void;
  /** Disabled when replay buffer hasn't captured anything yet. */
  disabled?: boolean;
  className?: string;
}

export function ReplayButton({
  onReplay,
  disabled,
  className,
}: ReplayButtonProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      data-testid="replay-button"
      disabled={disabled || busy}
      className={cn("h-6 px-2 text-[11px]", className)}
      onClick={async () => {
        setBusy(true);
        try {
          await onReplay();
        } finally {
          setBusy(false);
        }
      }}
      aria-label="replay last patient audio"
    >
      {busy ? "Playing…" : "🔁 Replay"}
    </Button>
  );
}
