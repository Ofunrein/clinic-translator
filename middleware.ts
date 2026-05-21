import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isEmailAllowed } from "@/lib/auth/allowlist";

const PROTECTED_PREFIXES = ["/", "/calls", "/settings"] as const;

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PROTECTED_PREFIXES.some(
    (p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`)),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Public paths handled by the matcher already; this is a defensive guard.
  if (
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const { response, userId, email } = await updateSession(request);

  // Authed user hitting /login: bounce to home.
  if (pathname === "/login" && userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Authed but email isn't on the clinic allowlist — fail closed.
  if (userId && !isEmailAllowed(email) && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "not_allowlisted");
    return NextResponse.redirect(url);
  }

  // Unauthed user hitting a protected route: send to login with `next` param.
  if (!userId && isProtectedPath(pathname) && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals, static files, and the health probe.
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)).*)",
  ],
};
