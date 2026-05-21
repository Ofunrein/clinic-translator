// Track B2. requireUser — verifies NextAuth session and resolves staff role.
// Used by every PHI-touching route. Throws UnauthorizedError if missing/invalid.

import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { db } from "@/lib/db/client";
import { staffUsers, type StaffUser } from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { UnauthorizedError, ForbiddenError } from "./errors";

export interface AuthedUser {
  userId: string;
  email: string;
  role: StaffUser["role"] | null;
}

interface SttJwtPayload {
  sub: string;
  email: string;
  role: StaffUser["role"] | null;
}

/**
 * Verifies the request is authenticated.
 *
 * Strategy:
 *  1. If a Bearer token is present (or `?token=` query for WS upgrade), verify
 *     it as a short-lived HS256 JWT signed with NEXTAUTH_SECRET. Used by the
 *     STT WebSocket path where browsers can't send Authorization headers and
 *     cookies may be stripped at Edge.
 *  2. Otherwise read the NextAuth session via the cookie-bound `auth()` helper.
 *
 * Returns `{userId, email, role}` or throws UnauthorizedError / ForbiddenError.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const authHeader =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  const bearer = authHeader && authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const url = (() => {
    try {
      return new URL(req.url);
    } catch {
      return null;
    }
  })();
  const queryToken = url?.searchParams.get("token") ?? null;
  const token = bearer ?? queryToken;

  let userId: string | null = null;
  let email: string | null = null;
  let preResolvedRole: StaffUser["role"] | null | undefined = undefined;

  if (token) {
    const payload = await verifySttToken(token);
    if (!payload) throw new UnauthorizedError("invalid bearer token");
    userId = payload.sub;
    email = payload.email;
    preResolvedRole = payload.role;
  } else {
    const session = await auth();
    if (!session?.userId || !session.user?.email) {
      throw new UnauthorizedError("not signed in");
    }
    userId = session.userId;
    email = session.user.email;
    preResolvedRole = session.user.role;
  }

  if (!email || !isEmailAllowed(email)) {
    throw new ForbiddenError("email not on clinic allowlist");
  }

  // If the role was already resolved in the session/JWT, trust it. Otherwise
  // hit staff_users. PHI routes should additionally call requireRole if they
  // need a specific role.
  let role: StaffUser["role"] | null;
  if (preResolvedRole !== undefined) {
    role = preResolvedRole;
  } else {
    const rows = await db
      .select({ role: staffUsers.role, active: staffUsers.active })
      .from(staffUsers)
      .where(eq(staffUsers.id, userId))
      .limit(1);
    const row = rows[0];
    role = row && row.active ? row.role : null;
  }

  return { userId, email, role };
}

async function verifySttToken(token: string): Promise<SttJwtPayload | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ["HS256"] },
    );
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    const rawRole = payload.role;
    const role =
      rawRole === "owner" || rawRole === "staff" || rawRole === "admin"
        ? rawRole
        : null;
    return {
      sub: payload.sub,
      email: payload.email,
      role,
    };
  } catch {
    return null;
  }
}
