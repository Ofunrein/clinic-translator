import * as React from "react";
import { cn } from "@/lib/utils";

type ClinicLogoProps = {
  /** Icon only, or icon + wordmark */
  variant?: "mark" | "lockup";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Hide the “Clinic Translator” text when variant is lockup */
  hideWordmark?: boolean;
};

const markSizes = { sm: 28, md: 32, lg: 40 } as const;

/**
 * Custom mark: two speech arcs bridged by a pulse — bilingual clinical translation.
 * Fuchsia/rose palette matches the landing card system (not generic teal “CT”).
 */
export function ClinicLogo({
  variant = "lockup",
  size = "md",
  className,
  hideWordmark = false,
}: ClinicLogoProps): React.JSX.Element {
  const px = markSizes[size];

  const mark = (
    <svg
      width={px}
      height={px}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={variant === "lockup"}
      role={variant === "mark" ? "img" : undefined}
      aria-label={variant === "mark" ? "Clinic Translator" : undefined}
      className="shrink-0"
    >
      {/* Tilted plate — breaks the “AI square badge” look */}
      <path
        d="M6 11.5C6 8.46 8.46 6 11.5 6h19.8c2.38 0 4.2 2.14 3.86 4.5l-2.2 14.2c-.28 1.82-1.86 3.15-3.7 3.15H11.5A5.5 5.5 0 0 1 6 23.35V11.5Z"
        fill="#BE185D"
        transform="rotate(-4 20 20)"
      />
      <path
        d="M8 13.2C8 10.87 9.87 9 12.2 9h16.1c1.94 0 3.42 1.74 3.14 3.66l-1.8 11.64c-.23 1.48-1.52 2.56-3.02 2.56H12.2A4.2 4.2 0 0 1 8 21.66V13.2Z"
        fill="#D946EF"
        transform="rotate(-4 20 20)"
      />

      {/* Left utterance arc (patient) */}
      <path
        d="M11.5 19.2c0-3.1 2.5-5.6 5.6-5.6"
        stroke="#FAE8FF"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="11.8" cy="19.4" r="1.35" fill="#FAE8FF" />

      {/* Right utterance arc (staff) */}
      <path
        d="M28.5 20.8c0 3.1-2.5 5.6-5.6 5.6"
        stroke="#FFF1F2"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="28.2" cy="20.6" r="1.35" fill="#FFF1F2" />

      {/* Bridge + clinical pulse */}
      <path
        d="M17.2 20h5.6"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M14.5 27.2h2.2l1.4-2.6 1.6 3.4 1.5-2.1 1.3 1.3h2.5"
        stroke="#FBCFE8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );

  if (variant === "mark") {
    return <span className={cn("inline-flex", className)}>{mark}</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark}
      {hideWordmark ? null : (
        <span className="flex flex-col leading-none">
          <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-fuchsia-600/80 dark:text-fuchsia-300/80">
            Clinic
          </span>
          <span className="font-semibold tracking-tight text-foreground">
            Translator
          </span>
        </span>
      )}
    </span>
  );
}
