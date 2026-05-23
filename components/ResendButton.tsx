"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ResendButtonProps {
  onResend: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
}

export function ResendButton({
  onResend,
  disabled,
  className,
}: ResendButtonProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      data-testid="resend-button"
      disabled={disabled || busy}
      className={cn("h-6 px-2 text-[11px]", className)}
      onClick={async () => {
        setBusy(true);
        try {
          await onResend();
        } finally {
          setBusy(false);
        }
      }}
      aria-label="Repeat send to patient"
    >
      {busy ? "Speaking…" : "Repeat"}
    </Button>
  );
}
