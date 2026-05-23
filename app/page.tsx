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
import { AuthModal, HeroSignUpButton, HeroSignInButton, CTASignUpButton, CTASignInButton } from "@/components/auth-modal";
import { AppNav } from "@/components/AppNav";
import { ClinicLogo } from "@/components/ClinicLogo";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth/config";
import { cn } from "@/lib/utils";

/** Landing cards: magenta wash, glow shadows, no outlines. */
const landingCardClass = cn(
  "rounded-2xl border-0",
  "bg-gradient-to-br from-fuchsia-50 via-white to-pink-50 text-fuchsia-950",
  "shadow-[0_10px_40px_-8px_rgba(217,70,239,0.45)]",
  "dark:from-fuchsia-950/80 dark:via-fuchsia-950/55 dark:to-fuchsia-900/35 dark:text-fuchsia-50",
  "dark:shadow-[0_12px_48px_-10px_rgba(217,70,239,0.55)]",
  "transition-all duration-300 hover:-translate-y-1",
  "hover:shadow-[0_20px_56px_-12px_rgba(217,70,239,0.55)]",
  "dark:hover:shadow-[0_24px_64px_-12px_rgba(217,70,239,0.65)]",
);

const landingCardTitleClass = "text-base font-semibold text-fuchsia-950 dark:text-fuchsia-50";
const landingCardBodyClass =
  "text-sm leading-relaxed text-fuchsia-900/75 dark:text-fuchsia-100/75";

interface LandingPageProps {
  searchParams: Promise<{ next?: string; signup?: string }>;
}

export default async function LandingPage({ searchParams }: LandingPageProps): Promise<React.JSX.Element> {
  const [{ next, signup }, session] = await Promise.all([searchParams, auth()]);
  const initialOpen = Boolean(next || signup);
  const defaultTab = signup ? "signup" : "signin";
  const isSignedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <ClinicLogo size="md" />
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
            <AppNav variant="light" showLinks={isSignedIn} />
            {isSignedIn ? null : (
              <AuthModal className="flex items-center gap-3" initialOpen={initialOpen} defaultTab={defaultTab as "signin" | "signup"} />
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-24">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-50 via-background to-teal-50 dark:from-cyan-950/30 dark:via-background dark:to-teal-950/20" />
        <div className="absolute top-20 right-0 h-[500px] w-[500px] rounded-full bg-cyan-100/50 blur-3xl dark:bg-cyan-900/20" />
        <div className="absolute bottom-0 left-0 h-[300px] w-[300px] rounded-full bg-teal-100/40 blur-3xl dark:bg-teal-900/15" />
        <div className="relative mx-auto max-w-6xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-sm font-medium text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
            HIPAA-compliant · Real-time AI translation
          </div>
          <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
            Break language barriers{" "}
            <span className="text-cyan-600 dark:text-cyan-400">in your clinic</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Real-time speech translation between patients and clinical staff.
            Powered by AI, built for healthcare, secure by design.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <HeroSignUpButton />
            <HeroSignInButton />
          </div>

          {/* Mock UI card */}
          <div className="mx-auto mt-16 max-w-3xl">
            <div
              className={cn(
                landingCardClass,
                "overflow-hidden hover:translate-y-0",
              )}
            >
              <div className="flex items-center gap-1.5 bg-fuchsia-100/80 px-5 py-3.5 dark:bg-fuchsia-950/60">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-3 text-xs text-fuchsia-800/70 dark:text-fuchsia-200/70">Clinic Translator — live session</span>
              </div>
              <div className="grid grid-cols-1 divide-y divide-fuchsia-200/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0 dark:divide-fuchsia-800/40">
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-medium uppercase tracking-wide text-fuchsia-800/60 dark:text-fuchsia-200/60">Patient · Spanish</span>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-lg bg-white/70 px-3 py-2.5 text-sm shadow-sm shadow-fuchsia-200/50 dark:bg-fuchsia-950/40 dark:shadow-fuchsia-900/30">
                      &ldquo;Me duele mucho el pecho desde ayer por la noche.&rdquo;
                    </div>
                    <div className="rounded-lg bg-white/70 px-3 py-2.5 text-sm shadow-sm shadow-fuchsia-200/50 dark:bg-fuchsia-950/40 dark:shadow-fuchsia-900/30">
                      &ldquo;También tengo dificultad para respirar.&rdquo;
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-fuchsia-500" />
                    <span className="text-xs font-medium uppercase tracking-wide text-fuchsia-800/60 dark:text-fuchsia-200/60">Staff · English</span>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-lg bg-fuchsia-100/80 px-3 py-2.5 text-sm shadow-sm shadow-fuchsia-300/40 dark:bg-fuchsia-900/50 dark:shadow-fuchsia-800/30">
                      &ldquo;My chest has been hurting a lot since last night.&rdquo;
                    </div>
                    <div className="rounded-lg bg-fuchsia-100/80 px-3 py-2.5 text-sm shadow-sm shadow-fuchsia-300/40 dark:bg-fuchsia-900/50 dark:shadow-fuchsia-800/30">
                      &ldquo;I&apos;m also having difficulty breathing.&rdquo;
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-fuchsia-100/50 px-5 py-3 dark:bg-fuchsia-950/50">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                </div>
                <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Urgent — possible cardiac symptoms</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Built for clinical environments</h2>
            <p className="mt-4 text-muted-foreground">Everything your team needs to communicate clearly with every patient.</p>
          </div>
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
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
            <p className="mt-4 text-muted-foreground">Three steps from open to done.</p>
          </div>
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
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to improve patient communication?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Sign up with your clinic email — no credit card required.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <CTASignUpButton />
            <CTASignInButton />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <ClinicLogo size="sm" />
            <p className="text-xs text-muted-foreground">
              Authorized clinic staff only. All access is logged and audited.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

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
    <Card className={landingCardClass}>
      <CardHeader>
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-600 shadow-md shadow-fuchsia-500/25 dark:bg-fuchsia-400/20 dark:text-fuchsia-300 dark:shadow-fuchsia-500/30">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        <CardTitle className={landingCardTitleClass}>{title}</CardTitle>
        <CardDescription className={landingCardBodyClass}>{description}</CardDescription>
      </CardHeader>
    </Card>
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
    <Card className={landingCardClass}>
      <CardHeader>
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/40 dark:bg-fuchsia-500 dark:shadow-fuchsia-500/50">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-fuchsia-700/70 dark:text-fuchsia-200/70">
            Step {number}
          </span>
        </div>
        <CardTitle className={landingCardTitleClass}>{title}</CardTitle>
        <CardDescription className={landingCardBodyClass}>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
