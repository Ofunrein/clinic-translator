import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed } from "@/lib/auth/allowlist";

const PROTECTED_PREFIXES = ["/", "/calls", "/settings"] as const;

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  // /api/* is protected except /api/auth/* and /api/health (handled inline).
  if (pathname.startsWith("/api/")) return true;
  return PROTECTED_PREFIXES.some(
    (p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`)),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Public paths — let through without auth lookup.
  if (
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const session = await auth();
  const userId = session?.userId ?? null;
  const email = session?.user?.email ?? null;

  // Authed user hitting /login: bounce home.
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
    // Best-effort signOut via the NextAuth signout endpoint on next click;
    // clearing cookies here keeps the redirect tight.
    const res = NextResponse.redirect(url);
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("authjs.") || c.name.startsWith("__Secure-authjs.")) {
        res.cookies.delete(c.name);
      }
    }
    return res;
  }

  // Unauthed user hitting a protected route: send to login with `next` param.
  if (!userId && isProtectedPath(pathname) && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except Next internals, static files, and the health probe.
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)).*)",
  ],
};
