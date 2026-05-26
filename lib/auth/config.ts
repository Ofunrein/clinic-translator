// NextAuth v5 (Auth.js) configuration.
// - Google OAuth + email/password via Credentials.
// - `jwt` session strategy: session lives in a signed cookie, no DB round-trip.
//   This is required for Credentials provider — database strategy + Credentials
//   causes auth() to return null in API route handlers in Next.js 15.
// - DrizzleAdapter still used for Google OAuth account persistence.
// - signIn callback enforces allowlist + mirrors into staff_users.

import NextAuth, { type NextAuthConfig, type Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  accounts,
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

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    email?: string;
    role?: StaffUser["role"] | null;
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

export const authConfig: NextAuthConfig = {
  // eslint-disable-next-line
  adapter: DrizzleAdapter(db, {
    usersTable: users as any,
    accountsTable: accounts as any,
    verificationTokensTable: verificationTokens as any,
  }),
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      allowDangerousEmailAccountLinking: true,
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
    signIn: "/",
    newUser: "/app",
    error: "/",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Allow linking Google to existing email-password accounts.
      // OAuthAccountNotLinked fires when same email exists via different provider.
      // We allow it by checking allowlist only.
      const email = user.email?.toLowerCase() ?? null;
      if (!email || !isEmailAllowed(email)) {
        return "/login?error=not_allowlisted";
      }

      const userId = user.id;
      if (!userId) return false;

      // Mirror into staff_users so PHI routes resolve role/FK.
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
        if (!row.active) return "/login?error=not_allowlisted";
        await db
          .update(staffUsers)
          .set({ id: userId, name: user.name ?? null, lastLoginAt: new Date() })
          .where(eq(staffUsers.email, email));
      }
      return true;
    },

    async jwt({ token, user, account }): Promise<JWT> {
      // `user` is only set on first sign-in. Subsequent calls just return token.
      if (user?.id) {
        token.userId = user.id;
        token.email = user.email?.toLowerCase() ?? token.email;

        // Resolve role from staff_users
        const email = user.email?.toLowerCase() ?? "";
        if (email) {
          const rows = await db
            .select({ role: staffUsers.role, active: staffUsers.active })
            .from(staffUsers)
            .where(eq(staffUsers.email, email))
            .limit(1);
          const row = rows[0];
          token.role = row && row.active ? row.role : null;
        }
      }
      return token;
    },

    async session({ session, token }): Promise<Session> {
      const userId = (token.userId ?? token.sub) as string | undefined;
      const email = (token.email ?? session.user?.email ?? "") as string;
      const role = (token.role ?? null) as StaffUser["role"] | null;

      // Cast needed: session.user narrowly typed by adapter in jwt mode
      const s = session as unknown as Record<string, unknown>;
      s.user = { id: userId ?? "", email, name: session.user?.name ?? null, image: session.user?.image ?? null, role };
      s.userId = userId ?? "";
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
