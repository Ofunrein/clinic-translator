"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

interface Props {
  callbackUrl: string;
}

export function GoogleSignInButton({ callbackUrl }: Props): React.JSX.Element {
  const [pending, setPending] = React.useState(false);

  const onClick = async (): Promise<void> => {
    setPending(true);
    try {
      await signIn("google", { callbackUrl });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onClick}
      disabled={pending}
    >
      {pending ? "Redirecting…" : "Sign in with Google"}
    </Button>
  );
}
