import * as React from "react";
import { AuthModal, HeroSignUpButton, HeroSignInButton, CTASignUpButton, CTASignInButton } from "@/components/auth-modal";
import { AppNav } from "@/components/AppNav";

interface LandingPageProps {
  searchParams: Promise<{ next?: string; signup?: string }>;
}

export default async function LandingPage({ searchParams }: LandingPageProps): Promise<React.JSX.Element> {
  const { next, signup } = await searchParams;
  const callbackUrl = next && next.startsWith("/") ? next : "/app";
  const initialOpen = Boolean(next || signup);
  const defaultTab = signup ? "signup" : "signin";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-600 text-white text-sm font-bold">
              CT
            </div>
            <span className="font-semibold">Clinic Translator</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
            <AppNav variant="light" />
            <AuthModal className="flex items-center gap-3" initialOpen={initialOpen} defaultTab={defaultTab as "signin" | "signup"} />
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
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-slate-200 dark:shadow-black/40">
              <div className="flex items-center gap-1.5 border-b border-border bg-muted px-5 py-3.5">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-3 text-xs text-muted-foreground">Clinic Translator — live session</span>
              </div>
              <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Patient · Spanish</span>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-lg bg-muted px-3 py-2.5 text-sm">
                      &ldquo;Me duele mucho el pecho desde ayer por la noche.&rdquo;
                    </div>
                    <div className="rounded-lg bg-muted px-3 py-2.5 text-sm">
                      &ldquo;También tengo dificultad para respirar.&rdquo;
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-cyan-500" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Staff · English</span>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-lg bg-cyan-50 border border-cyan-100 px-3 py-2.5 text-sm dark:bg-cyan-950/40 dark:border-cyan-900">
                      &ldquo;My chest has been hurting a lot since last night.&rdquo;
                    </div>
                    <div className="rounded-lg bg-cyan-50 border border-cyan-100 px-3 py-2.5 text-sm dark:bg-cyan-950/40 dark:border-cyan-900">
                      &ldquo;I&apos;m also having difficulty breathing.&rdquo;
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-5 py-3">
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
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            <FeatureCard
              icon="🎙️"
              title="Real-time translation"
              description="Speech is transcribed and translated in under 800ms. Patients speak naturally — staff read instantly."
            />
            <FeatureCard
              icon="🔒"
              title="HIPAA compliant"
              description="All PHI is AES-256-GCM encrypted at rest. Every access is logged in the full audit trail."
            />
            <FeatureCard
              icon="⚡"
              title="Urgency detection"
              description="AI automatically flags urgent phrases — pain severity, breathing issues, allergic reactions — so nothing is missed."
            />
            <FeatureCard
              icon="📋"
              title="Medical glossary"
              description="A built-in glossary of medical terms, medications, and procedures keeps translations accurate."
            />
            <FeatureCard
              icon="🌐"
              title="Spanish · English"
              description="Optimized for Spanish/English bilingual clinics with dialect-aware translation (Mx, Caribbean, Central American)."
            />
            <FeatureCard
              icon="🔄"
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
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            <StepCard
              number="1"
              title="Start a call"
              description="Click Start Call. The system creates an encrypted session and begins listening."
            />
            <StepCard
              number="2"
              title="Speak naturally"
              description="Patient speaks in Spanish, staff in English. Each side sees the other's words translated in real time."
            />
            <StepCard
              number="3"
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
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-cyan-600 text-white text-xs font-bold">
                CT
              </div>
              <span className="text-sm font-medium text-muted-foreground">Clinic Translator</span>
            </div>
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
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="mb-4 text-3xl">{icon}</div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="relative rounded-2xl bg-card border border-border p-6 shadow-sm">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600 text-white font-bold text-lg">
        {number}
      </div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
