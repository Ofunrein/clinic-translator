// Owned by Track B3. Spec §4.1 right pane + §5.2 EN→ES flow.
// Track C1 seam: AI reply suggestion ghost-text + escalate banner.
// Track C3 additions (additive only — DO NOT clobber C1 ghost or escalate paths):
//   * UrgencyAlert banner (urgency-keywords scan of latest patient final)
//   * NetworkBadge in the header
//   * Right-click correction popover for any patient transcript token (in
//     the small "patient review" rail below the composer)
//   * Replay button on each patient utterance entry in that rail
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TranscriptItem } from "./TranscriptItem";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import { SuggestionGhost } from "./SuggestionGhost";
import { ConfidenceDot } from "./ConfidenceDot";
import { EscalateBanner } from "./EscalateBanner";
import { UrgencyAlert } from "./UrgencyAlert";
import { NetworkBadge } from "./NetworkBadge";
import { CorrectionPopover } from "./CorrectionPopover";
import { ReplayButton } from "./ReplayButton";
import { useTranslate } from "@/lib/hooks/useTranslate";
import { useTts } from "@/lib/hooks/useTts";
import { useSuggest } from "@/lib/hooks/useSuggest";
import { useSessionStore } from "@/lib/session";
import { cn, isMac } from "@/lib/utils";
import {
  evaluateUrgency,
  playUrgencyAlert,
  type UrgencyVerdict,
} from "@/lib/edge/urgency-keywords";
import { applyCorrectionToUtterance } from "@/lib/edge/correction";
import { useAudioContext } from "@/lib/audio-context";

// TODO C2 toggle — replace with `useAiAssistEnabled()` when settings ship.
const AI_ASSIST_ENABLED = true;

export interface StaffPaneProps {
  className?: string;
  voice?: string;
  /**
   * Track C3 seam — replay a clip of recent patient audio. Wired by
   * `app/page.tsx` which owns the replay buffer in PatientPane (or shared
   * higher up). When missing, the replay button is hidden.
   */
  onReplayPatientUtterance?: (utteranceId: string) => Promise<void>;
}

const PREVIEW_HOLD_MS = 1500;

export function StaffPane({
  className,
  voice = "es-US-Chirp3-HD-Achernar",
  onReplayPatientUtterance,
}: StaffPaneProps): React.ReactElement {
  const transcript = useSessionStore((s) => s.transcript);
  const status = useSessionStore((s) => s.status);
  const addStaff = useSessionStore((s) => s.addStaffUtterance);
  const setTranslation = useSessionStore((s) => s.setTranslation);

  const offline = status === "offline";

  const playerRef = React.useRef<AudioPlayerHandle | null>(null);
  const translate = useTranslate();
  const tts = useTts(playerRef);
  const suggest = useSuggest({ enabled: AI_ASSIST_ENABLED });
  const audio = useAudioContext();

  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<{ en: string; es: string } | null>(null);
  const [countdown, setCountdown] = React.useState<number>(0);
  const [overrideEscalate, setOverrideEscalate] = React.useState(false);
  const cancelTimerRef = React.useRef<number | null>(null);

  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const staffUtterances = React.useMemo(
    () => transcript.filter((u) => u.role === "staff"),
    [transcript],
  );

  // ---- C3: urgency-keyword scan on the latest patient final ----
  const lastPatientFinal = React.useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const u = transcript[i];
      if (u.role === "patient" && !u.isPartial) return u;
    }
    return null;
  }, [transcript]);

  const [dismissedUrgencyId, setDismissedUrgencyId] = React.useState<string | null>(null);
  const [urgencyVerdict, setUrgencyVerdict] = React.useState<UrgencyVerdict | null>(null);
  React.useEffect(() => {
    if (!lastPatientFinal) {
      setUrgencyVerdict(null);
      return;
    }
    if (dismissedUrgencyId === lastPatientFinal.id) return;
    const verdict = evaluateUrgency(lastPatientFinal.text);
    setUrgencyVerdict(verdict);
    if (verdict.escalate) {
      try {
        const ac = audio.audioContext;
        if (ac) playUrgencyAlert(ac);
      } catch {
        // Non-fatal; banner still shows.
      }
      // C1 seam: ask the suggest hook to escalate. It exposes `escalate`
      // already via `useSuggest`; we can't force it from here without
      // bumping a dedicated method. Surfacing the alert is enough — the
      // friend has the visible cue.
    }
  }, [lastPatientFinal, dismissedUrgencyId, audio.audioContext]);

  // ---- C3: correction popover state ----
  const [correctionTarget, setCorrectionTarget] = React.useState<{
    utteranceId: string;
    wrong: string;
    rect: DOMRect;
  } | null>(null);

  const onPatientTokenContextMenu = React.useCallback(
    (
      utteranceId: string,
      ev: React.MouseEvent<HTMLElement>,
    ): void => {
      const sel = window.getSelection?.()?.toString().trim();
      const wrong = sel || (ev.target as HTMLElement).textContent?.trim() || "";
      if (!wrong) return;
      ev.preventDefault();
      const rect = (ev.target as HTMLElement).getBoundingClientRect();
      // The clicked token might be a whole sentence; isolate the closest
      // word to the cursor by splitting and picking the longest word.
      const word = wrong
        .split(/\s+/)
        .reduce((a, b) => (b.length > a.length ? b : a), "");
      setCorrectionTarget({ utteranceId, wrong: word || wrong, rect });
    },
    [],
  );

  const applyCorrection = React.useCallback(
    async (right: string): Promise<void> => {
      if (!correctionTarget) return;
      const traceId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `c3-${Date.now()}`;
      const result = applyCorrectionToUtterance({
        utteranceId: correctionTarget.utteranceId,
        wrong: correctionTarget.wrong,
        right,
        traceId,
      });
      if (result.ok && result.newText) {
        try {
          const r = await translate.mutateAsync({
            text: result.newText,
            src: "es",
            dst: "en",
          });
          setTranslation(correctionTarget.utteranceId, r.translation);
        } catch {
          // status flipped to degraded by the hook.
        }
      }
      setCorrectionTarget(null);
    },
    [correctionTarget, translate, setTranslation],
  );

  // Autosize.
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  const submitTranslate = React.useCallback(async () => {
    const en = text.trim();
    if (!en || offline) return;
    try {
      const r = await translate.mutateAsync({ text: en, src: "en", dst: "es" });
      setPreview({ en, es: r.translation });
      setCountdown(PREVIEW_HOLD_MS);
      // Drive the countdown; user can cancel mid-tick.
      const start = performance.now();
      const tick = (): void => {
        const left = PREVIEW_HOLD_MS - (performance.now() - start);
        if (left <= 0) {
          setCountdown(0);
          return;
        }
        setCountdown(left);
        cancelTimerRef.current = window.requestAnimationFrame(tick);
      };
      cancelTimerRef.current = window.requestAnimationFrame(tick);
    } catch {
      // status already flipped to `degraded` by the hook.
    }
  }, [text, translate, offline]);

  const cancelPreview = React.useCallback(() => {
    if (cancelTimerRef.current !== null) {
      cancelAnimationFrame(cancelTimerRef.current);
      cancelTimerRef.current = null;
    }
    setPreview(null);
    setCountdown(0);
  }, []);

  const sendAndSpeak = React.useCallback(async () => {
    if (!preview) return;
    if (cancelTimerRef.current !== null) {
      cancelAnimationFrame(cancelTimerRef.current);
      cancelTimerRef.current = null;
    }
    setCountdown(0);
    const { en, es } = preview;
    try {
      await tts.speak({ text: es, voice });
      addStaff(en, es);
      // Decide AI outcome: textarea === suggestion → accepted, differs → edited.
      if (suggest.utteranceId) {
        if (suggest.suggestion && en === suggest.suggestion.trim()) {
          await suggest.accept();
        } else if (suggest.suggestion) {
          await suggest.recordEdit();
        } else {
          await suggest.dismiss();
        }
      }
      setText("");
      setPreview(null);
      setOverrideEscalate(false);
      taRef.current?.focus();
    } catch {
      // status already flipped to `degraded` by the hook.
    }
  }, [preview, tts, voice, addStaff, suggest]);

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const submitChord = (isMac() ? ev.metaKey : ev.ctrlKey) && ev.key === "Enter";
    if (submitChord) {
      ev.preventDefault();
      void submitTranslate();
    }
  };

  React.useEffect(() => {
    return () => {
      if (cancelTimerRef.current !== null) cancelAnimationFrame(cancelTimerRef.current);
    };
  }, []);

  const submitHint = isMac() ? "⌘+Enter" : "Ctrl+Enter";

  const acceptGhost = React.useCallback((): void => {
    if (!suggest.suggestion) return;
    setText(suggest.suggestion);
    // Don't post outcome here; wait for actual send. The textarea now has
    // the staged draft so the ghost auto-hides.
    taRef.current?.focus();
  }, [suggest.suggestion]);

  const dismissGhost = React.useCallback((): void => {
    void suggest.dismiss();
  }, [suggest]);

  // Block escalate path unless the user explicitly opts in.
  const showEscalate =
    suggest.escalate && !overrideEscalate && !!suggest.suggestion;

  return (
    <section
      aria-label="Staff pane"
      className={cn("flex h-full flex-col", className)}
    >
      <AudioPlayer ref={playerRef} />

      <div className="border-b px-4 py-3">
        <div className="mb-2 flex items-center justify-end">
          <NetworkBadge />
        </div>
        <UrgencyAlert
          verdict={urgencyVerdict}
          onDismiss={() => {
            if (lastPatientFinal) setDismissedUrgencyId(lastPatientFinal.id);
            setUrgencyVerdict(null);
          }}
          onEscalate={() => {
            // Pre-fill the composer with a staff transfer prompt.
            setText("This sounds urgent — let me transfer you to a nurse.");
            taRef.current?.focus();
            if (lastPatientFinal) setDismissedUrgencyId(lastPatientFinal.id);
            setUrgencyVerdict(null);
          }}
          className="mb-2"
        />
        {showEscalate ? (
          <EscalateBanner
            className="mb-2"
            suggestion={suggest.suggestion}
            onAcknowledge={() => {
              void suggest.dismiss();
              setOverrideEscalate(false);
            }}
            onOverride={() => {
              setOverrideEscalate(true);
              setText(suggest.suggestion);
              taRef.current?.focus();
            }}
            onDismiss={() => {
              void suggest.dismiss();
            }}
          />
        ) : null}
        <div className="relative">
          <Textarea
            ref={taRef}
            placeholder={offline ? "Offline — paused" : "Type in English…"}
            disabled={offline}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            className="resize-none"
            aria-label="English staff message"
            data-testid="staff-textarea"
          />
          {AI_ASSIST_ENABLED && !showEscalate ? (
            <SuggestionGhost
              suggestion={suggest.suggestion}
              isStreaming={suggest.isStreaming}
              textareaValue={text}
              onAccept={acceptGhost}
              onDismiss={dismissGhost}
            />
          ) : null}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {translate.isPending ? "Translating…" : `${submitHint} to translate`}
          </span>
          <div className="flex items-center gap-2">
            {AI_ASSIST_ENABLED && suggest.suggestion && !suggest.isStreaming ? (
              <ConfidenceDot confidence={suggest.confidence} />
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void submitTranslate();
              }}
              disabled={offline || translate.isPending || !text.trim()}
            >
              Translate
            </Button>
          </div>
        </div>

        {preview ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/40">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Spanish preview
            </div>
            <p className="mt-0.5 text-sm">{preview.es}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Auto-cancel in {Math.max(0, Math.ceil(countdown / 100) / 10).toFixed(1)}s
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={cancelPreview}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void sendAndSpeak();
                  }}
                  disabled={tts.isSpeaking}
                  data-testid="send-and-speak"
                >
                  {tts.isSpeaking ? "Speaking…" : "Send & Speak"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {translate.error ? (
          <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            Translation unavailable.{" "}
            <button
              className="underline"
              onClick={() => {
                void submitTranslate();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
        {tts.error ? (
          <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            Voice unavailable. Type to the patient instead.
          </div>
        ) : null}
      </div>

      <div
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        data-testid="staff-transcript"
      >
        {staffUtterances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your messages will appear here. They&apos;re also spoken in Spanish to the patient.
          </p>
        ) : (
          staffUtterances.map((u) => <TranscriptItem key={u.id} utterance={u} />)
        )}

        {/* C3: patient review rail — replay + right-click to correct. */}
        <PatientReviewRail
          transcript={transcript}
          onReplay={onReplayPatientUtterance}
          onCorrectToken={onPatientTokenContextMenu}
        />
      </div>

      {/* C3: correction popover */}
      {correctionTarget ? (
        <CorrectionPopover
          wrong={correctionTarget.wrong}
          anchorRect={correctionTarget.rect}
          onApply={applyCorrection}
          onCancel={() => setCorrectionTarget(null)}
        />
      ) : null}
    </section>
  );
}

interface PatientReviewRailProps {
  transcript: ReturnType<typeof useSessionStore.getState>["transcript"];
  onReplay?: (utteranceId: string) => Promise<void>;
  onCorrectToken: (
    utteranceId: string,
    ev: React.MouseEvent<HTMLElement>,
  ) => void;
}

function PatientReviewRail({
  transcript,
  onReplay,
  onCorrectToken,
}: PatientReviewRailProps): React.ReactElement | null {
  const recent = React.useMemo(
    () =>
      transcript
        .filter((u) => u.role === "patient" && !u.isPartial)
        .slice(-3),
    [transcript],
  );
  if (recent.length === 0) return null;
  return (
    <div
      className="mt-4 border-t pt-3"
      data-testid="patient-review-rail"
      aria-label="Recent patient utterances — replay or correct"
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Patient review
      </div>
      <ul className="space-y-1">
        {recent.map((u) => (
          <li
            key={u.id}
            className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50/40 px-2 py-1 dark:border-sky-900 dark:bg-sky-950/20"
          >
            <span
              className="flex-1 text-xs"
              onContextMenu={(ev) => onCorrectToken(u.id, ev)}
              data-testid={`patient-review-text-${u.id}`}
            >
              {u.text}
            </span>
            {onReplay ? (
              <ReplayButton
                onReplay={async () => {
                  await onReplay(u.id);
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
