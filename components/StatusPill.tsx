// Owned by Track B3. Top-bar pill subscribed to the Zustand session store.
// Spec §4.1: 🟢 ready / 🟡 degraded (failover) / 🔴 offline + voice indicator.
"use client";

import * as React from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClinicSettings } from "@/lib/hooks/useClinicSettings";
import { resolveTtsVoiceLabel } from "@/lib/providers/deepgram-voices";
import type { TtsProvider } from "@/lib/providers/types";
import { useSessionStore, type SessionStatus } from "@/lib/session";

export interface StatusPillProps {
  /** Optional override; when omitted, subscribes to the store. */
  status?: SessionStatus;
  /** Currently selected TTS voice; rendered next to the gear icon. */
  voice?: string;
  className?: string;
}

const TONE: Record<SessionStatus, { dot: string; label: string; bg: string }> = {
  idle:       { dot: "bg-zinc-400",   label: "idle",        bg: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" },
  ready:      { dot: "bg-green-500",  label: "ready",       bg: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" },
  listening:  { dot: "bg-green-500",  label: "listening",   bg: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" },
  translating:{ dot: "bg-blue-500",   label: "translating", bg: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  speaking:   { dot: "bg-blue-500",   label: "speaking",    bg: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  degraded:   { dot: "bg-amber-500",  label: "degraded",    bg: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" },
  offline:    { dot: "bg-red-500",    label: "offline",     bg: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

export function StatusPill({
  status,
  voice,
  className,
}: StatusPillProps): React.ReactElement {
  const storeStatus = useSessionStore((s) => s.status);
  const reason = useSessionStore((s) => s.statusReason);
  const settingsQ = useClinicSettings();
  const effective: SessionStatus = status ?? storeStatus;
  const tone = TONE[effective];

  const settingsTts = settingsQ.data?.tts as TtsProvider | undefined;
  const voiceId = voice ?? settingsTts?.voice;
  const voiceLabel = voiceId ? resolveTtsVoiceLabel(voiceId) : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      title={reason ?? undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        tone.bg,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 rounded-full", tone.dot)}
      />
      <span>{tone.label}</span>
      {voiceLabel ? (
        <Link
          href="/settings"
          className="flex items-center gap-1 border-l border-current/20 pl-2 text-[10px] uppercase tracking-wide opacity-80 transition-opacity hover:opacity-100"
          title={voiceId ? `TTS voice: ${voiceId}` : undefined}
        >
          <Settings className="h-3 w-3" aria-hidden="true" />
          {voiceLabel}
        </Link>
      ) : null}
    </div>
  );
}
