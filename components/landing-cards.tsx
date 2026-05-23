"use client";

import * as React from "react";
import {
  BookOpen,
  Globe,
  Mic,
  Phone,
  RotateCcw,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MagneticCard } from "@/components/MagneticCard";

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <MagneticCard>
      <CardHeader>
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-600/10 text-cyan-600 shadow-md shadow-cyan-600/15 dark:bg-cyan-400/15 dark:text-cyan-400 dark:shadow-cyan-500/20">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <CardDescription className="leading-relaxed">{description}</CardDescription>
      </CardHeader>
    </MagneticCard>
  );
}

function StepCard({
  number,
  icon: Icon,
  title,
  description,
}: {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <MagneticCard intensity={12}>
      <CardHeader>
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-lg shadow-cyan-600/30">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {number}
          </span>
        </div>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <CardDescription className="leading-relaxed">{description}</CardDescription>
      </CardHeader>
    </MagneticCard>
  );
}

export function LandingFeatureGrid(): React.JSX.Element {
  return (
    <div className="mt-16 grid gap-6 sm:grid-cols-3">
      <FeatureCard
        icon={Mic}
        title="Real-time translation"
        description="Speech is transcribed and translated in under 800ms. Patients speak naturally — staff read instantly."
      />
      <FeatureCard
        icon={ShieldCheck}
        title="HIPAA compliant"
        description="All PHI is AES-256-GCM encrypted at rest. Every access is logged in the full audit trail."
      />
      <FeatureCard
        icon={Zap}
        title="Urgency detection"
        description="AI automatically flags urgent phrases — pain severity, breathing issues, allergic reactions — so nothing is missed."
      />
      <FeatureCard
        icon={BookOpen}
        title="Medical glossary"
        description="A built-in glossary of medical terms, medications, and procedures keeps translations accurate."
      />
      <FeatureCard
        icon={Globe}
        title="Spanish · English"
        description="Optimized for Spanish/English bilingual clinics with dialect-aware translation (Mx, Caribbean, Central American)."
      />
      <FeatureCard
        icon={RotateCcw}
        title="Session recovery"
        description="Crash mid-call? The session auto-recovers from the URL so nothing is lost during a patient interaction."
      />
    </div>
  );
}

export function LandingStepGrid(): React.JSX.Element {
  return (
    <div className="mt-16 grid gap-6 sm:grid-cols-3">
      <StepCard
        number="1"
        icon={Phone}
        title="Start a call"
        description="Click Start Call. The system creates an encrypted session and begins listening."
      />
      <StepCard
        number="2"
        icon={Mic}
        title="Speak naturally"
        description="Patient speaks in Spanish, staff in English. Each side sees the other's words translated in real time."
      />
      <StepCard
        number="3"
        icon={RotateCcw}
        title="End and review"
        description="End the call when done. The full session transcript is securely stored and audited."
      />
    </div>
  );
}

export function LandingHeroDemo(): React.JSX.Element {
  return (
    <div className="mx-auto mt-16 max-w-3xl">
      <MagneticCard intensity={10} className="overflow-hidden">
        <div className="flex items-center gap-1.5 bg-muted/80 px-5 py-3.5">
          <div className="h-3 w-3 rounded-full bg-red-400" />
          <div className="h-3 w-3 rounded-full bg-yellow-400" />
          <div className="h-3 w-3 rounded-full bg-green-400" />
          <span className="ml-3 text-xs text-muted-foreground">Clinic Translator — live session</span>
        </div>
        <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Patient · Spanish
              </span>
            </div>
            <div className="space-y-2">
              <div className="rounded-lg bg-muted/70 px-3 py-2.5 text-sm shadow-sm shadow-black/5">
                &ldquo;Me duele mucho el pecho desde ayer por la noche.&rdquo;
              </div>
              <div className="rounded-lg bg-muted/70 px-3 py-2.5 text-sm shadow-sm shadow-black/5">
                &ldquo;También tengo dificultad para respirar.&rdquo;
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-cyan-500" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Staff · English
              </span>
            </div>
            <div className="space-y-2">
              <div className="rounded-lg bg-cyan-50 px-3 py-2.5 text-sm shadow-sm shadow-cyan-900/5 dark:bg-cyan-950/40 dark:shadow-black/20">
                &ldquo;My chest has been hurting a lot since last night.&rdquo;
              </div>
              <div className="rounded-lg bg-cyan-50 px-3 py-2.5 text-sm shadow-sm shadow-cyan-900/5 dark:bg-cyan-950/40 dark:shadow-black/20">
                &ldquo;I&apos;m also having difficulty breathing.&rdquo;
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-muted/40 px-5 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            Urgent — possible cardiac symptoms
          </span>
        </div>
      </MagneticCard>
    </div>
  );
}
