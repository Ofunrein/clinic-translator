// Track C3 — silence prompts. Combines:
//   * "Patient still there?" after long silence
//   * "Audio low — ask patient to speak up?" with one-tap pre-translated
//      ES prompt to send via TTS.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CALLER_QUIET_ES_PROMPT,
  PATIENT_STILL_THERE_EN_PROMPT,
} from "@/lib/edge/silence-detector";

export interface SilencePromptProps {
  longSilence: boolean;
  callerQuiet: boolean;
  /** Caller speaks a Spanish nudge through the patient channel via TTS. */
  onSpeakSpanish: (es: string) => Promise<void>;
  /** Friend dismisses for one cycle. */
  onDismiss: () => void;
  className?: string;
}

export function SilencePrompt({
  longSilence,
  callerQuiet,
  onSpeakSpanish,
  onDismiss,
  className,
}: SilencePromptProps): React.ReactElement | null {
  const [speaking, setSpeaking] = React.useState(false);
  if (!longSilence && !callerQuiet) return null;
  const variant = callerQuiet ? "caller-quiet" : "long-silence";

  const handleSpeak = async (): Promise<void> => {
    setSpeaking(true);
    try {
      await onSpeakSpanish(CALLER_QUIET_ES_PROMPT);
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <div
      role="status"
      data-testid={`silence-prompt-${variant}`}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
        className,
      )}
    >
      <span>
        {callerQuiet
          ? "Audio low — ask patient to speak up?"
          : PATIENT_STILL_THERE_EN_PROMPT}
      </span>
      <div className="flex gap-1">
        {callerQuiet ? (
          <Button
            size="sm"
            variant="outline"
            disabled={speaking}
            onClick={() => {
              void handleSpeak();
            }}
          >
            {speaking ? "Speaking…" : "Send Spanish nudge"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
