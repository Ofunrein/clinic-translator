import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";

/**
 * Supabase OAuth callback. Exchanges the auth `code` for a session, then
 * enforces the clinic email allowlist before redirecting to `next`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    const dest = new URL(url);
    dest.pathname = "/login";
    dest.search = "?error=missing_code";
    return NextResponse.redirect(dest);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    const dest = new URL(url);
    dest.pathname = "/login";
    dest.search = `?error=${encodeURIComponent(error?.message ?? "exchange_failed")}`;
    return NextResponse.redirect(dest);
  }

  if (!isEmailAllowed(data.user.email)) {
    await supabase.auth.signOut();
    const dest = new URL(url);
    dest.pathname = "/login";
    dest.search = "?error=not_allowlisted";
    return NextResponse.redirect(dest);
  }

  const dest = new URL(url);
  dest.pathname = next.startsWith("/") ? next : "/";
  dest.search = "";
  return NextResponse.redirect(dest);
}
