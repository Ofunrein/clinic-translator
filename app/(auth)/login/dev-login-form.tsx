"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  callbackUrl: string;
}

export function DevLoginForm({ callbackUrl }: Props): React.JSX.Element {
  const [email, setEmail] = React.useState("ofunrein123@gmail.com");

  return (
    <form
      method="POST"
      action={`/api/dev-login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
      className="space-y-2 border-t pt-4"
    >
      <p className="text-xs text-muted-foreground font-mono">DEV BYPASS</p>
      <Input
        type="email"
        name="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="allowed@email.com"
        required
      />
      <Button type="submit" className="w-full">
        Dev Sign In
      </Button>
    </form>
  );
}
