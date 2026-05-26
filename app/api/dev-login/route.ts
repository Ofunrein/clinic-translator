// DEV ONLY — bypasses Google OAuth and creates a real NextAuth JWT session.
// Only active when NODE_ENV === "development". Never ships to production.
import { NextRequest, NextResponse } from "next/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { encode } from "next-auth/jwt";

// Prevent Next.js from statically collecting this route at build time.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Lazy-import DB so it's never evaluated at build time.
  const { db } = await import("@/lib/db/client");
  const { users, staffUsers } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const ct = req.headers.get("content-type") ?? "";
  let email = "";
  let callbackUrl = req.nextUrl.searchParams.get("callbackUrl") ?? "/app";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await req.formData();
    email = ((form.get("email") as string | null) ?? "").toLowerCase().trim();
  } else {
    const body = await req.json().catch(() => ({}));
    email = (body.email as string | undefined)?.toLowerCase()?.trim() ?? "";
    callbackUrl = body.callbackUrl ?? callbackUrl;
  }

  if (!email || !isEmailAllowed(email)) {
    return NextResponse.json({ error: "not_allowlisted" }, { status: 403 });
  }

  // Upsert into NextAuth users table.
  let userId: string;
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser[0]) {
    userId = existingUser[0].id;
  } else {
    userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email, name: "Dev User" });
  }

  // Upsert into staff_users table.
  const existingStaff = await db
    .select({ id: staffUsers.id, active: staffUsers.active })
    .from(staffUsers)
    .where(eq(staffUsers.email, email))
    .limit(1);

  if (!existingStaff[0]) {
    await db.insert(staffUsers).values({ id: userId, email, name: "Dev User", lastLoginAt: new Date() });
  } else if (existingStaff[0].active === false) {
    return NextResponse.json({ error: "not_allowlisted" }, { status: 403 });
  } else {
    await db
      .update(staffUsers)
      .set({ id: userId, name: "Dev User", lastLoginAt: new Date() })
      .where(eq(staffUsers.email, email));
  }

  // Create a JWT session token (matches the app's `strategy: "jwt"` config).
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "NEXTAUTH_SECRET not set" }, { status: 500 });
  }
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const token = await encode({
    token: {
      sub: userId,
      email,
      name: "Dev User",
      role: "admin",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expires.getTime() / 1000),
    },
    secret,
    salt: "authjs.session-token",
  });

  // Set the session cookie and redirect.
  const cookieName = "authjs.session-token";
  const dest = callbackUrl.startsWith("/") ? callbackUrl : "/";
  const res = NextResponse.redirect(new URL(dest, req.url), 302);
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return res;
}
