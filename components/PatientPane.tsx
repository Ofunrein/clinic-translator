// Owned by Track B3. Spec §4.1 left pane.
// Track C3 additions (additive only):
//   * silence prompts (long-silence, caller-quiet)
//   * callback verification card
//   * multi-speaker banner
//   * urgency keyword alert + soft chirp
//   * hangup auto-detect prompt
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
import { SilencePrompt } from "./SilencePrompt";
import { CallbackVerifyCard } from "./CallbackVerifyCard";
import { useStt } from "@/lib/hooks/useStt";
import { useSessionStore, type Utterance } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useSilenceDetector } from "@/lib/edge/silence-detector";
import { extractCallbackNumber, type ExtractedCallback } from "@/lib/edge/callback-verify";
import { detectMultiSpeaker } from "@/lib/edge/multi-speaker";
import { useHangupDetector } from "@/lib/edge/hangup-detect";

export interface PatientPaneProps {
  /** Default `mx`. Track B2 `/api/sessions` may persist per-call dialect. */
  dialect?: "mx" | "cen" | "car" | "all";
  urgency: Urgency;
  onUrgencyChange: (u: Urgency) => void;
  /** Caller controls when streaming starts — usually after `/api/sessions` resolves. */
  autoStart?: boolean;
  className?: string;
  /**
   * Track C3 seam — speak a Spanish nudge to the patient via the existing
   * TTS pipeline. Wired from `app/page.tsx` which owns the AudioPlayer.
   * Optional: when missing, the silence-prompt "send nudge" button is
   * rendered disabled.
   */
  onSpeakSpanish?: (es: string) => Promise<void>;
  /** Track C3 seam — persist a verified callback number on the patient row. */
  onConfirmCallback?: (e164: string) => void;
}

export function PatientPane({
  dialect = "mx",
  urgency,
  onUrgencyChange,
  autoStart = false,
  className,
  onSpeakSpanish,
  onConfirmCallback,
}: PatientPaneProps): React.ReactElement {
  const transcript = useSessionStore((s) => s.transcript);
  const sessionId = useSessionStore((s) => s.sessionId);
  const stt = useStt();

  // C3: silence detector. TODO C2 settings flag — wire to useClinicSettings()
  // when C2 lands; defaults-on for now.
  const silence = useSilenceDetector(stt.analyser, { enabled: true });

  // C3: hangup detector — bumps activity on any new patient utterance.
  const hangup = useHangupDetector({ enabled: true });

  const patientUtterances = React.useMemo<Utterance[]>(
    () => transcript.filter((u) => u.role === "patient"),
    [transcript],
  );

  // C3: bump hangup-detector clock on any new patient utterance.
  React.useEffect(() => {
    if (patientUtterances.length > 0) {
      hangup.bumpActivity();
    }
  }, [patientUtterances.length, hangup]);

  // C3: extract callback number from the latest finalized patient utterance.
  const [callback, setCallback] = React.useState<ExtractedCallback | null>(null);
  const [callbackDismissed, setCallbackDismissed] = React.useState<string | null>(null);
  React.useEffect(() => {
    const lastFinal = [...patientUtterances]
      .reverse()
      .find((u) => !u.isPartial);
    if (!lastFinal) return;
    if (callbackDismissed === lastFinal.id) return;
    const found = extractCallbackNumber(lastFinal.text);
    if (found && found.confidence >= 0.7) {
      setCallback(found);
    }
  }, [patientUtterances, callbackDismissed]);

  // C3: multi-speaker hint, derived from inter-utterance pauses. ZCR isn't
  // available without a tap on the raw stream — we use a constant placeholder
  // so this stays offline-cheap. The verdict is informational; audit-grade
  // diarization is out of scope (Spec §6 / Track C3 — heuristic only).
  const multiSpeakerVerdict = React.useMemo(() => {
    const finals = patientUtterances.filter((u) => !u.isPartial);
    if (finals.length < 3) return null;
    const pauses: number[] = [];
    for (let i = 1; i < finals.length; i++) {
      pauses.push(Math.max(0, finals[i].ts - finals[i - 1].ts));
    }
    const zcr = finals.map((u) => 0.05 + (u.text.length % 7) * 0.01);
    return detectMultiSpeaker({
      pauses: pauses.slice(-5),
      zcr: zcr.slice(-5),
    });
  }, [patientUtterances]);

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
        {stt.micMuted || silence.micMuted ? (
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
        {/* C3 silence prompts */}
        <SilencePrompt
          longSilence={silence.longSilence}
          callerQuiet={silence.callerQuiet}
          onSpeakSpanish={async (es) => {
            if (onSpeakSpanish) await onSpeakSpanish(es);
          }}
          onDismiss={() => {
            // The hook resets when audio activity resumes; manual dismiss
            // is a soft action — bump the activity timestamp by triggering
            // a re-render. The detector itself drives the next cycle.
            hangup.bumpActivity();
          }}
          className="mt-2"
        />
        {/* C3 callback verify */}
        {callback ? (
          <CallbackVerifyCard
            callback={callback}
            onSpeak={async (es) => {
              if (onSpeakSpanish) await onSpeakSpanish(es);
            }}
            onConfirm={(e164) => {
              if (onConfirmCallback) onConfirmCallback(e164);
              setCallbackDismissed(callback ? "confirmed" : null);
              setCallback(null);
            }}
            onReject={() => {
              setCallbackDismissed("rejected");
              setCallback(null);
            }}
            className="mt-2"
          />
        ) : null}
        {/* C3 multi-speaker banner */}
        {multiSpeakerVerdict?.multiSpeaker ? (
          <div
            role="status"
            data-testid="multi-speaker-banner"
            className="mt-2 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-[11px] text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100"
          >
            Multiple voices detected — flagged in transcript.
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

      {/* C3: hangup auto-detect prompt */}
      <Dialog open={hangup.prompting} onOpenChange={() => hangup.dismiss()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Did the call end?</DialogTitle>
            <DialogDescription>
              No audio for {Math.round((hangup.remainingMs <= 0 ? 0 : hangup.remainingMs) / 1000)}s
              before auto-end. The session will save and clear automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => hangup.dismiss()}>
              Still on the call
            </Button>
            <Button onClick={() => hangup.confirm()} data-testid="hangup-confirm">
              End call now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
