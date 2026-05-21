import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffUsers, type StaffUser } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export type StaffRole = StaffUser["role"];

/**
 * Look up a user's role from the Drizzle `staff_users` table.
 * Returns `null` if no row matches (i.e. authed Supabase user not yet
 * provisioned in `staff_users`); callers should treat that as no access.
 */
export async function getUserRole(userId: string): Promise<StaffRole | null> {
  const rows = await db
    .select({ role: staffUsers.role, active: staffUsers.active })
    .from(staffUsers)
    .where(eq(staffUsers.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;
  return row.role;
}

export class AuthorizationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: "unauthenticated" | "forbidden", message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.status = code === "unauthenticated" ? 401 : 403;
    this.code = code;
  }
}

/**
 * Throws if the caller is not signed in or their role is not in `allowed`.
 * Returns the staff_users row id and role on success.
 *
 * Note: the Drizzle schema (Track B1) currently defines staff roles as
 * `("owner" | "staff" | "admin")`. Callers should pass values from that
 * enum. The spec mentions `provider` / `front_desk`; if/when B1 widens
 * the enum, this helper picks it up automatically via the inferred type.
 */
export async function requireRole(
  _req: Request,
  allowed: readonly StaffRole[],
): Promise<{ userId: string; role: StaffRole }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AuthorizationError("unauthenticated", "not signed in");
  }
  const role = await getUserRole(user.id);
  if (!role) {
    throw new AuthorizationError("forbidden", "no staff record");
  }
  if (!allowed.includes(role)) {
    throw new AuthorizationError("forbidden", `role ${role} not permitted`);
  }
  return { userId: user.id, role };
}
