import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { auth } from "@/lib/auth/config";
import { THEME_COOKIE, resolveInitialTheme } from "@/lib/theme";
import { getUserThemePreference } from "@/lib/user-theme";

const logoSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-logo-serif",
});

export const metadata: Metadata = {
  title: "Clinic Translator",
  description: "HIPAA-compliant Spanish↔English real-time translator for clinic calls.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const session = await auth();
  const dbTheme = session?.userId
    ? await getUserThemePreference(session.userId).catch(() => null)
    : null;
  const initialTheme = resolveInitialTheme({ cookieTheme, dbTheme });

  return (
    <html lang="en" suppressHydrationWarning className={`${initialTheme} ${logoSerif.variable ?? ""}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased overflow-x-hidden">
        <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
