"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
      className={cn("flex flex-wrap items-center gap-2 sm:gap-3", className)}
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
                  "text-xs sm:text-sm transition-colors underline-offset-4 hover:underline",
                  variant === "light"
                    ? isActive
                      ? "font-medium text-cyan-700 dark:text-cyan-400"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    : isActive
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            );
          })
        : null}
      <ThemeToggle />
    </nav>
  );
}
