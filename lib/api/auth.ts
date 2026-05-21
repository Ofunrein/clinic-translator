// Track B2. requireUser — verifies Supabase JWT and resolves staff role.
// Used by every PHI-touching route. Throws UnauthorizedError if missing/invalid.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffUsers, type StaffUser } from "@/lib/db/schema";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { UnauthorizedError, ForbiddenError } from "./errors";

export interface AuthedUser {
  userId: string;
  email: string;
  role: StaffUser["role"] | null;
}

/**
 * Verifies the request is authenticated. Prefers the cookie-bound Supabase
 * client (browser flows). If a Bearer token is present, falls back to the
 * service-role client to verify the JWT (used by the WS upgrade path on
 * Edge runtime where cookies may not be forwarded).
 *
 * Returns `{userId, email, role}` or throws UnauthorizedError / ForbiddenError.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const bearer = auth && auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;

  let userId: string | null = null;
  let email: string | null = null;

  if (bearer) {
    const svc = createServiceClient();
    const { data, error } = await svc.auth.getUser(bearer);
    if (error || !data.user) {
      throw new UnauthorizedError("invalid bearer token");
    }
    userId = data.user.id;
    email = data.user.email ?? null;
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new UnauthorizedError("not signed in");
    }
    userId = data.user.id;
    email = data.user.email ?? null;
  }

  if (!email || !isEmailAllowed(email)) {
    throw new ForbiddenError("email not on clinic allowlist");
  }

  // Look up role; absence is allowed for the auth check itself, but PHI
  // routes should additionally call requireRole if they need a specific role.
  const rows = await db
    .select({ role: staffUsers.role, active: staffUsers.active })
    .from(staffUsers)
    .where(eq(staffUsers.id, userId))
    .limit(1);
  const row = rows[0];
  const role = row && row.active ? row.role : null;

  return { userId, email, role };
}
