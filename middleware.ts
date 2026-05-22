import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

function getSessionToken(request: NextRequest): string | undefined {
  for (const name of SESSION_COOKIES) {
    const val = request.cookies.get(name)?.value;
    if (val) return val;
  }
  return undefined;
}

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/app" || pathname.startsWith("/app/")) return true;
  if (pathname.startsWith("/api/")) return true;
  return ["/calls", "/settings"].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Public paths — let through unconditionally.
  if (
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/") ||
    (pathname === "/api/dev-login" && process.env.NODE_ENV === "development") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/login" ||
    pathname === "/signup"
  ) {
    return NextResponse.next();
  }

  const token = getSessionToken(request);

  // Authenticated user hitting the landing page → send to the app.
  if (token && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  // Unauthenticated user hitting a protected route → login.
  if (!token && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)).*)",
  ],
};
