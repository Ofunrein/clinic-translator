export const THEME_COOKIE = "ct-theme";
export type ThemePreference = "light" | "dark";

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "light" || value === "dark";
}

export function themeCookieValue(value: ThemePreference): string {
  return `${THEME_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function resolveInitialTheme(args: {
  cookieTheme: string | undefined;
  dbTheme: ThemePreference | null;
}): ThemePreference {
  if (args.dbTheme) return args.dbTheme;
  if (isThemePreference(args.cookieTheme)) return args.cookieTheme;
  return "light";
}
