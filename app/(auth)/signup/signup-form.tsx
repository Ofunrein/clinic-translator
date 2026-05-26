"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface Props {
  callbackUrl: string;
}

export function SignupForm({ callbackUrl }: Props): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

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
      setError(signupErrorMessage(data.error));
      setPending(false);
      return;
    }

    // Auto sign-in after successful signup
    const result = await signIn("email-password", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });

    if (result?.error) {
      setError("Account created. Please sign in.");
      setPending(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Input
        type="text"
        placeholder="Your name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
      <Input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <Input
        type="password"
        placeholder="Password (min 8 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="new-password"
        minLength={8}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(callbackUrl)}`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

function signupErrorMessage(code: string | undefined): string {
  switch (code) {
    case "email_taken":
      return "An account with that email already exists.";
    case "not_allowlisted":
      return "Enter a valid email address.";
    case "password_too_short":
      return "Password must be at least 8 characters.";
    case "missing_fields":
      return "Email and password are required.";
    case "db_error":
      return "A server error occurred. Please try again in a moment.";
    default:
      return "Something went wrong. Please try again.";
  }
}
