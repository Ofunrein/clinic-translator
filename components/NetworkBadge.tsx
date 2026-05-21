// Track C3 — small status badge showing rolling network health.
"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useNetworkHealth } from "@/lib/edge/network";

export interface NetworkBadgeProps {
  className?: string;
}

export function NetworkBadge({ className }: NetworkBadgeProps): React.ReactElement {
  const h = useNetworkHealth();
  const tone = h.degraded
    ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100";
  const label = h.degraded ? "Net: slow" : "Net: ok";
  const detail = `STT p95 ${Math.round(h.sttP95Ms)}ms · API p95 ${Math.round(h.fetchP95Ms)}ms · TTS p95 ${Math.round(h.ttsP95Ms)}ms`;
  return (
    <Badge
      data-testid="network-badge"
      title={detail}
      className={cn(tone, "border-transparent text-[10px] uppercase tracking-wide", className)}
    >
      {label}
    </Badge>
  );
}
