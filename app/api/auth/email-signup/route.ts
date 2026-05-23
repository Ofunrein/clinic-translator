import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffUsers, userCredentials, users } from "@/lib/db/schema";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = body.email?.toLowerCase().trim() ?? "";
  const password = body.password ?? "";
  const name = body.name?.trim() || null;

  if (!email || !password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }
  if (!isEmailAllowed(email)) {
    return NextResponse.json({ error: "not_allowlisted" }, { status: 403 });
  }

  try {
    // Check if user already exists
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing[0]) {
      const cred = await db
        .select({ userId: userCredentials.userId })
        .from(userCredentials)
        .where(eq(userCredentials.userId, existing[0].id))
        .limit(1);
      if (cred[0]) {
        return NextResponse.json({ error: "email_taken" }, { status: 409 });
      }
      // User exists via Google — add password credential
      const passwordHash = await hashPassword(password);
      await db.insert(userCredentials).values({ userId: existing[0].id, passwordHash });
      return NextResponse.json({ ok: true });
    }

    // New user — insert into users, credentials, and staff_users in sequence
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await db.insert(users).values({ id: userId, email, name });
    await db.insert(userCredentials).values({ userId, passwordHash });

    // staff_users.id is uuid; userId string is a valid UUID Postgres will accept
    const existingStaff = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(eq(staffUsers.email, email))
      .limit(1);

    if (!existingStaff[0]) {
      await db.insert(staffUsers).values({
        email,
        name,
        lastLoginAt: new Date(),
      });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[email-signup] DB error:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
