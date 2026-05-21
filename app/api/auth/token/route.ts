// Short-lived JWT minter for the STT WebSocket auth path.
// Browsers can't send Authorization on a WS upgrade, so the client fetches
// a 5-minute token here and appends it as `?token=` on the WS URL.
//
// Token shape: {sub: userId, email, role, exp: now + 5min}, HS256 signed
// with NEXTAUTH_SECRET. Verify with `jose.jwtVerify` in API routes.

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed } from "@/lib/auth/allowlist";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.userId || !session.user?.email) {
    return NextResponse.json(
      { code: "unauthenticated", message: "not signed in" },
      { status: 401 },
    );
  }
  if (!isEmailAllowed(session.user.email)) {
    return NextResponse.json(
      { code: "forbidden", message: "email not on clinic allowlist" },
      { status: 403 },
    );
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { code: "internal", message: "auth not configured" },
      { status: 500 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 5 * 60;

  const token = await new SignJWT({
    email: session.user.email,
    role: session.user.role ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token, expiresAt: exp });
}
