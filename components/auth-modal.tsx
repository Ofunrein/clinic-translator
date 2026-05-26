"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { signIn } from "next-auth/react";
import { MagneticButton } from "@/components/MagneticButton";

type Tab = "signin" | "signup";

interface AuthModalProps {
  defaultTab?: Tab;
  trigger?: React.ReactNode;
  className?: string;
  initialOpen?: boolean;
  callbackUrl?: string;
}

export function AuthModal({
  defaultTab = "signin",
  trigger,
  className,
  initialOpen = false,
  callbackUrl = "/app",
}: AuthModalProps): React.JSX.Element {
  const [open, setOpen] = React.useState(initialOpen);
  const [tab, setTab] = React.useState<Tab>(defaultTab);

  const openSignIn = (): void => { setTab("signin"); setOpen(true); };
  const openSignUp = (): void => { setTab("signup"); setOpen(true); };
  const close = (): void => setOpen(false);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Lock scroll when open
  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (trigger) {
    return (
      <>
        <span onClick={openSignIn} style={{ display: "contents" }}>{trigger}</span>
        <ModalOverlay open={open} onClose={close} tab={tab} onTabChange={setTab} />
      </>
    );
  }

  return (
    <>
      {/* Nav buttons */}
      <div className={className}>
        <MagneticButton intensity={7} className="rounded-lg">
          <button
            onClick={openSignIn}
            className="relative rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </button>
        </MagneticButton>
        <MagneticButton intensity={8} className="rounded-lg">
          <button
            onClick={openSignUp}
            className="relative rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
          >
            Get started
          </button>
        </MagneticButton>
      </div>
      <ModalOverlay open={open} onClose={close} tab={tab} onTabChange={setTab} />
    </>
  );
}

// ---- Standalone trigger buttons for hero section ----

export function HeroSignUpButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <MagneticButton intensity={10} className="rounded-xl">
        <button
          onClick={() => setOpen(true)}
          className="relative rounded-xl bg-cyan-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-cyan-200 hover:bg-cyan-700 transition-all hover:shadow-cyan-300"
        >
          Start free
        </button>
      </MagneticButton>
      <ModalOverlay open={open} onClose={() => setOpen(false)} tab="signup" onTabChange={() => {}} />
    </>
  );
}

export function HeroSignInButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <MagneticButton intensity={10} className="rounded-xl">
        <button
          onClick={() => setOpen(true)}
          className="relative rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold text-foreground hover:bg-muted transition-colors"
        >
          Sign in →
        </button>
      </MagneticButton>
      <ModalOverlay open={open} onClose={() => setOpen(false)} tab="signin" onTabChange={() => {}} />
    </>
  );
}

export function CTASignUpButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <MagneticButton intensity={10} className="rounded-xl">
        <button
          onClick={() => setOpen(true)}
          className="relative rounded-xl bg-cyan-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-cyan-200 hover:bg-cyan-700 transition-all"
        >
          Create free account
        </button>
      </MagneticButton>
      <ModalOverlay open={open} onClose={() => setOpen(false)} tab="signup" onTabChange={() => {}} />
    </>
  );
}

export function CTASignInButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <MagneticButton intensity={10} className="rounded-xl">
        <button
          onClick={() => setOpen(true)}
          className="relative rounded-xl border border-border px-8 py-3.5 text-base font-semibold text-foreground hover:bg-muted transition-colors"
        >
          Sign in
        </button>
      </MagneticButton>
      <ModalOverlay open={open} onClose={() => setOpen(false)} tab="signin" onTabChange={() => {}} />
    </>
  );
}

// ---- Modal overlay ----

function ModalOverlay({
  open,
  onClose,
  tab,
  onTabChange,
}: {
  open: boolean;
  onClose: () => void;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}): React.JSX.Element | null {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(8px)", backgroundColor: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-[#0d1117] border border-white/10 shadow-2xl shadow-black/40 p-5 sm:p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 transition-colors text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 rounded-lg bg-white/5 p-1">
          <TabBtn active={tab === "signin"} onClick={() => onTabChange("signin")}>Sign in</TabBtn>
          <TabBtn active={tab === "signup"} onClick={() => onTabChange("signup")}>Create account</TabBtn>
        </div>

        {tab === "signin" ? (
          <SignInPanel onClose={onClose} />
        ) : (
          <SignUpPanel onClose={onClose} />
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          Create an account with your email. All access is audited.
        </p>
      </div>
    </div>,
    document.body
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white/10 text-white"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

// ---- Sign In Panel ----

function SignInPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [googlePending, setGooglePending] = React.useState(false);

  const onGoogleSignIn = async (): Promise<void> => {
    setGooglePending(true);
    try {
      await signIn("google", { callbackUrl: "/app" });
    } finally {
      setGooglePending(false);
    }
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn("email-password", {
      email,
      password,
      callbackUrl: "/app",
      redirect: false,
    });
    if (result?.error) {
      setError("Invalid email or password.");
      setPending(false);
    } else if (result?.url) {
      onClose();
      window.location.href = result.url;
    }
  };

  return (
    <div className="space-y-4">
      <GoogleBtn onClick={onGoogleSignIn} pending={googlePending} label="Sign in with Google" />
      <Divider />
      <form onSubmit={onSubmit} className="space-y-3">
        <AuthInput
          type="email"
          placeholder="you@clinic.com"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <AuthInput
          type="password"
          placeholder="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <AuthSubmitBtn pending={pending} label="Sign in" pendingLabel="Signing in…" />
      </form>
    </div>
  );
}

// ---- Sign Up Panel ----

function SignUpPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [googlePending, setGooglePending] = React.useState(false);

  const onGoogleSignUp = async (): Promise<void> => {
    setGooglePending(true);
    try {
      await signIn("google", { callbackUrl: "/app" });
    } finally {
      setGooglePending(false);
    }
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setPending(true);
    setError(null);

    const res = await fetch("/api/auth/email-signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: name || undefined }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(signupError(data.error));
      setPending(false);
      return;
    }

    const result = await signIn("email-password", {
      email,
      password,
      callbackUrl: "/app",
      redirect: false,
    });

    if (result?.error) {
      setError("Account created — please sign in.");
      setPending(false);
    } else if (result?.url) {
      onClose();
      window.location.href = result.url;
    }
  };

  return (
    <div className="space-y-4">
      <GoogleBtn onClick={onGoogleSignUp} pending={googlePending} label="Sign up with Google" />
      <Divider />
      <form onSubmit={onSubmit} className="space-y-3">
        <AuthInput
          type="text"
          placeholder="Your name (optional)"
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <AuthInput
          type="email"
          placeholder="you@clinic.com"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <AuthInput
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          minLength={8}
        />
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <AuthSubmitBtn pending={pending} label="Create account" pendingLabel="Creating…" />
      </form>
    </div>
  );
}

// ---- Shared sub-components ----

function GoogleBtn({
  onClick,
  pending,
  label,
}: {
  onClick: () => void;
  pending: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-50"
    >
      <GoogleIcon />
      {pending ? "Redirecting…" : label}
    </button>
  );
}

function GoogleIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

function Divider(): React.JSX.Element {
  return (
    <div className="relative flex items-center">
      <div className="flex-1 border-t border-white/10" />
      <span className="mx-3 text-xs text-slate-500 uppercase tracking-wide">or</span>
      <div className="flex-1 border-t border-white/10" />
    </div>
  );
}

function AuthInput({
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
}: {
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}): React.JSX.Element {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      required={required}
      minLength={minLength}
      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
    />
  );
}

function AuthSubmitBtn({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}): React.JSX.Element {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function signupError(code: string | undefined): string {
  switch (code) {
    case "email_taken": return "An account with that email already exists.";
    case "not_allowlisted": return "Enter a valid email address.";
    case "password_too_short": return "Password must be at least 8 characters.";
    case "missing_fields": return "Email and password are required.";
    case "db_error": return "Server error — please try again in a moment.";
    default: return "Something went wrong. Please try again.";
  }
}
