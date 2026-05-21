// Track C3 — callback verification widget. Big-digit display + one-tap
// "Read back to verify" button that synthesizes ES via TTS.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatDigitsForDisplay,
  spanishReadback,
  type ExtractedCallback,
} from "@/lib/edge/callback-verify";

export interface CallbackVerifyCardProps {
  callback: ExtractedCallback | null;
  /** Caller hooks this to the existing TTS queue (useTts). */
  onSpeak: (es: string) => Promise<void>;
  /** Caller hooks this to persistCallbackNumber on a successful verification. */
  onConfirm: (e164: string) => void;
  /** Friend rejects the extraction (wrong number). */
  onReject: () => void;
  className?: string;
}

export function CallbackVerifyCard({
  callback,
  onSpeak,
  onConfirm,
  onReject,
  className,
}: CallbackVerifyCardProps): React.ReactElement | null {
  const [speaking, setSpeaking] = React.useState(false);
  if (!callback) return null;
  const display = formatDigitsForDisplay(callback.digits);
  const handleSpeak = async (): Promise<void> => {
    setSpeaking(true);
    try {
      await onSpeak(spanishReadback(callback.digits));
    } finally {
      setSpeaking(false);
    }
  };
  return (
    <div
      data-testid="callback-verify-card"
      className={cn(
        "rounded-md border border-sky-300 bg-sky-50 px-3 py-2 dark:border-sky-800 dark:bg-sky-950",
        className,
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Possible callback number
      </div>
      <div
        aria-label="callback number"
        className="mt-1 font-mono text-2xl font-semibold tracking-wider tabular-nums"
      >
        {display}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void handleSpeak();
          }}
          disabled={speaking}
          data-testid="callback-readback"
        >
          {speaking ? "Reading…" : "Read back in Spanish"}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (callback.e164) onConfirm(callback.e164);
          }}
          disabled={!callback.e164}
        >
          Confirmed correct
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject}>
          Wrong number
        </Button>
      </div>
    </div>
  );
}
