import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffUsers, type StaffUser } from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";

export type StaffRole = StaffUser["role"];

/**
 * Look up a user's role from the Drizzle `staff_users` table.
 * Returns `null` if no row matches (i.e. authed user not yet provisioned in
 * `staff_users`); callers should treat that as no access.
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
 * Reads the NextAuth session and prefers the role cached on it (resolved in
 * the `session` callback). Falls back to a `staff_users` lookup if absent.
 */
export async function requireRole(
  _req: Request,
  allowed: readonly StaffRole[],
): Promise<{ userId: string; role: StaffRole }> {
  const session = await auth();
  if (!session?.userId) {
    throw new AuthorizationError("unauthenticated", "not signed in");
  }
  const role =
    session.user?.role ?? (await getUserRole(session.userId));
  if (!role) {
    throw new AuthorizationError("forbidden", "no staff record");
  }
  if (!allowed.includes(role)) {
    throw new AuthorizationError("forbidden", `role ${role} not permitted`);
  }
  return { userId: session.userId, role };
}
