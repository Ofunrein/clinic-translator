"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ClinicLogoProps = {
  variant?: "mark" | "lockup";
  size?: "sm" | "md" | "lg";
  className?: string;
  hideWordmark?: boolean;
};

const markSizes = { sm: 28, md: 34, lg: 42 } as const;

/**
 * Lingua bridge mark — dual speech channels meeting at a translation node.
 * Upright clinical geometry; no skewed “app icon” plate.
 */
export function ClinicLogo({
  variant = "lockup",
  size = "md",
  className,
  hideWordmark = false,
}: ClinicLogoProps): React.JSX.Element {
  const uid = React.useId().replace(/:/g, "");
  const gradId = `ct-grad-${uid}`;
  const px = markSizes[size];

  const mark = (
    <svg
      width={px}
      height={px}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={variant === "lockup"}
      role={variant === "mark" ? "img" : undefined}
      aria-label={variant === "mark" ? "Clinic Translator" : undefined}
      className="shrink-0 drop-shadow-[0_4px_14px_rgba(8,145,178,0.35)] dark:drop-shadow-[0_4px_18px_rgba(6,182,212,0.25)]"
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0C4A6E" />
          <stop stopColor="#0891B2" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>

      {/* Stable squircle — clinical, not tilted */}
      <rect x="3" y="3" width="42" height="42" rx="13" fill={`url(#${gradId})`} />

      {/* Inner ring — precision instrument feel */}
      <rect
        x="7.5"
        y="7.5"
        width="33"
        height="33"
        rx="10"
        stroke="white"
        strokeOpacity="0.18"
        strokeWidth="1"
      />

      {/* Patient channel (ES) — waveform bars */}
      <path
        d="M13 29V22M16.5 29V17M20 29V24"
        stroke="#ECFEFF"
        strokeWidth="2.25"
        strokeLinecap="round"
      />

      {/* Staff channel (EN) — mirrored waveform */}
      <path
        d="M28 29V24M31.5 29V17M35 29V22"
        stroke="#F0FDFA"
        strokeWidth="2.25"
        strokeLinecap="round"
      />

      {/* Translation bridge — bidirectional chevrons + node */}
      <circle cx="24" cy="22" r="2.2" fill="white" fillOpacity="0.95" />
      <path
        d="M21.2 22h-2.4M19.4 20.2 17 22l2.4 1.8M21.2 22h2.4M26.6 20.2 29 22l-2.4 1.8"
        stroke="white"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      />

      {/* Single clinical pulse tick — one beat, not jagged slop */}
      <path
        d="M18 33.5h3.2l1.4-2.4 2.2 4.8 1.6-2.8H30"
        stroke="#A5F3FC"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );

  if (variant === "mark") {
    return <span className={cn("inline-flex", className)}>{mark}</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {mark}
      {hideWordmark ? null : (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className="text-[11px] italic tracking-wide text-cyan-700/90 dark:text-cyan-300/90"
            style={{ fontFamily: "var(--font-logo-serif), Georgia, serif" }}
          >
            Clinic
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
            Translator
          </span>
        </span>
      )}
    </span>
  );
}
