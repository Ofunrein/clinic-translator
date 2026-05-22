"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface Props {
  callbackUrl: string;
}

export function EmailPasswordForm({ callbackUrl }: Props): React.JSX.Element {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn("email-password", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    if (result?.error) {
      setError("Invalid email or password.");
      setPending(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        minLength={8}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No account?{" "}
        <Link href={`/signup?next=${encodeURIComponent(callbackUrl)}`} className="underline underline-offset-2 hover:text-foreground">
          Create one
        </Link>
      </p>
    </form>
  );
}
