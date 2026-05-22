// NextAuth v5 (Auth.js) configuration.
// - Google OAuth provider only (free, self-hosted).
// - DrizzleAdapter against Neon Postgres (lib/db/client).
// - `database` session strategy: sessions persisted in `sessions` table.
// - `signIn` callback enforces clinic email allowlist (HIPAA §8 fail-closed).
// - On allowlisted sign-in we mirror the NextAuth `users` row into `staff_users`
//   so role lookups, audit FKs, and existing PHI routes keep working.
//
// Exports `{ handlers, auth, signIn, signOut }` — wired by the catch-all
// `/api/auth/[...nextauth]` route and consumed by middleware + API helpers.

import NextAuth, { type NextAuthConfig, type Session, type User } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  accounts,
  sessions,
  staffUsers,
  userCredentials,
  users,
  verificationTokens,
  type StaffUser,
} from "@/lib/db/schema";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { verifyPassword } from "@/lib/auth/password";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: StaffUser["role"] | null;
    };
    userId: string;
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

export const authConfig: NextAuthConfig = {
  // DrizzleAdapter type is overly strict on column shape; cast to bypass.
  // eslint-disable-next-line
  adapter: DrizzleAdapter(db, {
    usersTable: users as any,
    accountsTable: accounts as any,
    sessionsTable: sessions as any,
    verificationTokensTable: verificationTokens as any,
  }),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorization: {
        params: { access_type: "offline", prompt: "consent" },
      },
    }),
    Credentials({
      id: "email-password",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)?.toLowerCase() ?? "";
        const password = (credentials?.password as string | undefined) ?? "";
        if (!email || !password || !isEmailAllowed(email)) return null;

        const userRow = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!userRow[0]) return null;

        const cred = await db
          .select({ passwordHash: userCredentials.passwordHash })
          .from(userCredentials)
          .where(eq(userCredentials.userId, userRow[0].id))
          .limit(1);
        if (!cred[0]) return null;

        const ok = await verifyPassword(password, cred[0].passwordHash);
        if (!ok) return null;

        return { id: userRow[0].id, email, name: userRow[0].name ?? null };
      },
    }),
    ...(process.env.NODE_ENV === "development"
      ? [
          Credentials({
            id: "dev-bypass",
            name: "Dev Login",
            credentials: { email: { label: "Email", type: "email" } },
            async authorize(credentials) {
              const email = (credentials?.email as string | undefined)?.toLowerCase() ?? "";
              if (!email || !isEmailAllowed(email)) return null;
              const existing = await db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(eq(users.email, email))
                .limit(1);
              if (existing[0]) {
                return { id: existing[0].id, email, name: existing[0].name ?? "Dev User" };
              }
              const id = crypto.randomUUID();
              await db.insert(users).values({ id, email, name: "Dev User" });
              return { id, email, name: "Dev User" };
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/login",
    newUser: "/app",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }: { user: User }): Promise<boolean | string> {
      const email = user.email?.toLowerCase() ?? null;
      if (!email || !isEmailAllowed(email)) {
        // Redirect string is treated as deny + redirect by NextAuth.
        return "/login?error=not_allowlisted";
      }

      // Mirror id+email into staff_users so PHI routes can resolve role/FK.
      // The NextAuth `users.id` is a text uuid; staff_users.id is uuid as well.
      // We upsert by email (allowlist is per-email) and back-fill id on first
      // login so existing rows transition from Supabase-issued ids cleanly.
      const userId = user.id;
      if (!userId) {
        return false;
      }

      const existing = await db
        .select({ id: staffUsers.id, active: staffUsers.active })
        .from(staffUsers)
        .where(eq(staffUsers.email, email))
        .limit(1);

      const row = existing[0];
      if (!row) {
        await db.insert(staffUsers).values({
          id: userId,
          email,
          name: user.name ?? null,
          lastLoginAt: new Date(),
        });
      } else {
        if (!row.active) {
          // Deactivated staff member: deny and bounce.
          return "/login?error=not_allowlisted";
        }
        await db
          .update(staffUsers)
          .set({
            id: userId,
            name: user.name ?? null,
            lastLoginAt: new Date(),
          })
          .where(eq(staffUsers.email, email));
      }
      return true;
    },
    async session({
      session,
      user,
    }: {
      session: Session;
      user: User;
    }): Promise<Session> {
      // `user` is the row from the NextAuth `users` table (database strategy).
      const email = (user.email ?? session.user?.email ?? "").toLowerCase();
      let role: StaffUser["role"] | null = null;
      if (email) {
        const rows = await db
          .select({ role: staffUsers.role, active: staffUsers.active })
          .from(staffUsers)
          .where(eq(staffUsers.email, email))
          .limit(1);
        const row = rows[0];
        role = row && row.active ? row.role : null;
      }
      session.user = {
        id: user.id ?? "",
        email,
        name: user.name ?? null,
        image: user.image ?? null,
        role,
      };
      session.userId = user.id ?? "";
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
