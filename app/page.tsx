import * as React from "react";
import { redirect } from "next/navigation";
import { AuthModal, HeroSignUpButton, HeroSignInButton, CTASignUpButton, CTASignInButton } from "@/components/auth-modal";
import { AppNav } from "@/components/AppNav";
import { ClinicLogo } from "@/components/ClinicLogo";
import { LandingFeatureGrid, LandingHeroDemo, LandingStepGrid } from "@/components/landing-cards";
import { auth } from "@/lib/auth/config";

interface LandingPageProps {
  searchParams: Promise<{ next?: string; signup?: string }>;
}

export default async function LandingPage({ searchParams }: LandingPageProps): Promise<React.JSX.Element> {
  const [{ next, signup }, session] = await Promise.all([searchParams, auth()]);
  const isSignedIn = Boolean(session?.user);
  if (isSignedIn) {
    const dest = next && next.startsWith("/") ? next : "/app";
    redirect(dest);
  }
  const initialOpen = Boolean(next || signup);
  const defaultTab = signup ? "signup" : "signin";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-4">
          <ClinicLogo size="md" className="shrink-0" />
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
            <AppNav variant="light" showLinks={isSignedIn} />
            {isSignedIn ? null : (
              <AuthModal className="flex items-center gap-2 sm:gap-3" initialOpen={initialOpen} defaultTab={defaultTab as "signin" | "signup"} />
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-50 via-background to-teal-50 dark:from-cyan-950/30 dark:via-background dark:to-teal-950/20" />
        <div className="absolute top-20 right-0 h-[300px] w-[300px] rounded-full bg-cyan-100/50 blur-3xl sm:h-[500px] sm:w-[500px] dark:bg-cyan-900/20" />
        <div className="absolute bottom-0 left-0 h-[200px] w-[200px] rounded-full bg-teal-100/40 blur-3xl sm:h-[300px] sm:w-[300px] dark:bg-teal-900/15" />
        <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-6">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 sm:mb-6 sm:px-4 sm:py-1.5 sm:text-sm dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
            HIPAA-compliant · Real-time AI translation
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Break language barriers{" "}
            <span className="text-cyan-600 dark:text-cyan-400">in your clinic</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:mt-6 sm:text-lg">
            Real-time speech translation between patients and clinical staff.
            Powered by AI, built for healthcare, secure by design.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:mt-10 sm:flex-row sm:justify-center sm:gap-4">
            <HeroSignUpButton />
            <HeroSignInButton />
          </div>

          <LandingHeroDemo />
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">Built for clinical environments</h2>
            <p className="mt-3 text-sm text-muted-foreground sm:mt-4 sm:text-base">Everything your team needs to communicate clearly with every patient.</p>
          </div>
          <LandingFeatureGrid />
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/50 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">How it works</h2>
            <p className="mt-3 text-sm text-muted-foreground sm:mt-4 sm:text-base">Three steps from open to done.</p>
          </div>
          <LandingStepGrid />
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            Ready to improve patient communication?
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:mt-4 sm:text-base">
            Sign up with your clinic email — no credit card required.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:mt-10 sm:flex-row sm:justify-center sm:gap-4">
            <CTASignUpButton />
            <CTASignInButton />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 sm:py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row sm:gap-4">
            <ClinicLogo size="sm" />
            <p className="text-center text-[11px] text-muted-foreground sm:text-xs">
              Authorized clinic staff only. All access is logged and audited.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
