"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemePreference } from "@/lib/theme";

export function ThemeProvider({
  children,
  initialTheme = "light",
}: {
  children: React.ReactNode;
  initialTheme?: ThemePreference;
}): React.JSX.Element {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={initialTheme}
      enableSystem={false}
      storageKey="ct-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
