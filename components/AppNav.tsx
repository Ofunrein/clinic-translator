"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV_LINKS = [
  { href: "/", label: "Home", active: (p: string) => p === "/" },
  { href: "/app", label: "Translator", active: (p: string) => p === "/app" },
  {
    href: "/app/sessions",
    label: "Sessions",
    active: (p: string) => p.startsWith("/app/sessions"),
  },
  {
    href: "/settings",
    label: "Settings",
    active: (p: string) => p.startsWith("/settings"),
  },
] as const;

type AppNavVariant = "app" | "light";

export function AppNav({
  variant = "app",
  showLinks = true,
  className,
}: {
  variant?: AppNavVariant;
  /** When false, only the theme toggle is shown (e.g. landing page for guests). */
  showLinks?: boolean;
  className?: string;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      className={cn("flex flex-wrap items-center gap-1.5 sm:gap-3", className)}
      aria-label="Main"
    >
      {showLinks
        ? NAV_LINKS.map(({ href, label, active }) => {
            const isActive = active(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "rounded-md px-2 py-1 text-xs sm:px-0 sm:py-0 sm:text-sm transition-colors underline-offset-4 sm:hover:underline",
                  variant === "light"
                    ? isActive
                      ? "font-medium text-cyan-700 dark:text-cyan-400"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    : isActive
                      ? "bg-muted font-medium text-foreground sm:bg-transparent"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            );
          })
        : null}
      <ThemeToggle />
      {showLinks ? (
        <button
          type="button"
          onClick={() => {
            void signOut({ callbackUrl: "/" });
          }}
          className={cn(
            "rounded-md border px-2 py-1 text-xs sm:px-2.5 sm:text-sm transition-colors",
            variant === "light"
              ? "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          data-testid="sign-out"
        >
          Sign out
        </button>
      ) : null}
    </nav>
  );
}
