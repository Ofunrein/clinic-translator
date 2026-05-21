// Owned by Track B3. Spec §4.1 right pane + §5.2 EN→ES flow.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TranscriptItem } from "./TranscriptItem";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import { useTranslate } from "@/lib/hooks/useTranslate";
import { useTts } from "@/lib/hooks/useTts";
import { useSessionStore } from "@/lib/session";
import { cn, isMac } from "@/lib/utils";

export interface StaffPaneProps {
  className?: string;
  voice?: string;
}

const PREVIEW_HOLD_MS = 1500;

export function StaffPane({
  className,
  voice = "es-US-Chirp3-HD-Achernar",
}: StaffPaneProps): React.ReactElement {
  const transcript = useSessionStore((s) => s.transcript);
  const status = useSessionStore((s) => s.status);
  const addStaff = useSessionStore((s) => s.addStaffUtterance);

  const offline = status === "offline";

  const playerRef = React.useRef<AudioPlayerHandle | null>(null);
  const translate = useTranslate();
  const tts = useTts(playerRef);

  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<{ en: string; es: string } | null>(null);
  const [countdown, setCountdown] = React.useState<number>(0);
  const cancelTimerRef = React.useRef<number | null>(null);

  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const staffUtterances = React.useMemo(
    () => transcript.filter((u) => u.role === "staff"),
    [transcript],
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
      setText("");
      setPreview(null);
      taRef.current?.focus();
    } catch {
      // status already flipped to `degraded` by the hook.
    }
  }, [preview, tts, voice, addStaff]);

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

  return (
    <section
      aria-label="Staff pane"
      className={cn("flex h-full flex-col", className)}
    >
      <AudioPlayer ref={playerRef} />

      <div className="border-b px-4 py-3">
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
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {translate.isPending ? "Translating…" : `${submitHint} to translate`}
          </span>
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
      </div>
    </section>
  );
}
