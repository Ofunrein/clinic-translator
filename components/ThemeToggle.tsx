"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { themeCookieValue, type ThemePreference } from "@/lib/theme";

async function persistTheme(theme: ThemePreference): Promise<void> {
  document.cookie = themeCookieValue(theme);
  try {
    await fetch("/api/user/theme", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme }),
    });
  } catch {
    // Guest or offline — cookie + localStorage are enough.
  }
}

export function ThemeToggle({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 shrink-0", className)}
        aria-label="Toggle theme"
        disabled
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  const onToggle = (): void => {
    const next: ThemePreference = isDark ? "light" : "dark";
    setTheme(next);
    void persistTheme(next);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 shrink-0", className)}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={onToggle}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
