// Owned by Track B3. Spec §4.1 left pane.
"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Waveform } from "./Waveform";
import { TranscriptItem } from "./TranscriptItem";
import { UrgencyFlag, type Urgency } from "./UrgencyFlag";
import { useStt } from "@/lib/hooks/useStt";
import { useSessionStore, type Utterance } from "@/lib/session";
import { cn } from "@/lib/utils";

export interface PatientPaneProps {
  /** Default `mx`. Track B2 `/api/sessions` may persist per-call dialect. */
  dialect?: "mx" | "cen" | "car" | "all";
  urgency: Urgency;
  onUrgencyChange: (u: Urgency) => void;
  /** Caller controls when streaming starts — usually after `/api/sessions` resolves. */
  autoStart?: boolean;
  className?: string;
}

export function PatientPane({
  dialect = "mx",
  urgency,
  onUrgencyChange,
  autoStart = false,
  className,
}: PatientPaneProps): React.ReactElement {
  const transcript = useSessionStore((s) => s.transcript);
  const sessionId = useSessionStore((s) => s.sessionId);
  const stt = useStt();

  const patientUtterances = React.useMemo<Utterance[]>(
    () => transcript.filter((u) => u.role === "patient"),
    [transcript],
  );

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [patientUtterances]);

  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (!autoStart || startedRef.current || !sessionId) return;
    startedRef.current = true;
    void stt.start();
    return () => {
      stt.stop();
      startedRef.current = false;
    };
    // sessionId change implies a new call — restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, sessionId]);

  return (
    <section
      aria-label="Patient pane"
      className={cn("flex h-full flex-col", className)}
    >
      <div className="border-b px-4 py-3">
        <Waveform analyser={stt.analyser} />
        {stt.micMuted ? (
          <div
            role="alert"
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            No audio detected from the mic. Check that the headset isn&apos;t muted.
          </div>
        ) : null}
        {stt.error && !stt.permissionDenied ? (
          <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {stt.error}
          </div>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        data-testid="patient-transcript"
      >
        {patientUtterances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Listening for the patient. Spanish utterances will appear here.
          </p>
        ) : (
          patientUtterances.map((u) => (
            <TranscriptItem key={u.id} utterance={u} dialect={dialect} />
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-2">
        <UrgencyFlag value={urgency} onChange={onUrgencyChange} />
        <div className="flex items-center gap-2">
          {stt.isStreaming ? (
            <Button size="sm" variant="outline" onClick={() => stt.stop()}>
              Pause mic
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                void stt.start();
              }}
              disabled={!sessionId}
            >
              Start mic
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={stt.permissionDenied}
        onOpenChange={() => {
          // No-op; user must grant in browser settings + click "Try again".
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Microphone permission required</DialogTitle>
            <DialogDescription>
              Allow microphone access in your browser to translate the patient&apos;s
              audio. Then click <em>Try again</em>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                void stt.start();
              }}
            >
              Try again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
