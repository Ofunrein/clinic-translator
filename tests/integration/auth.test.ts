// Integration test: NextAuth signIn callback enforces allowlist and mirrors
// users into staff_users. We mock the Drizzle db so this runs without Neon.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface UpsertCall {
  op: "insert" | "update";
  email: string;
  id?: string;
  name?: string | null;
}

const calls: UpsertCall[] = [];
let existingRow: { id: string; active: boolean } | null = null;

vi.mock("@/lib/db/client", () => {
  // A tiny chainable mock that records insert + update + select operations.
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => (existingRow ? [existingRow] : [])),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(async (v: { id: string; email: string; name?: string | null }) => {
      calls.push({ op: "insert", id: v.id, email: v.email, name: v.name ?? null });
    }),
  }));
  const update = vi.fn(() => ({
    set: vi.fn((v: { id?: string; name?: string | null }) => ({
      where: vi.fn(async () => {
        calls.push({
          op: "update",
          id: v.id,
          name: v.name ?? null,
          email: existingRow ? "" : "",
        });
      }),
    })),
  }));
  return { db: { select, insert, update } };
});

vi.mock("next-auth", () => ({
  default: (cfg: unknown) => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    __cfg: cfg,
  }),
}));

vi.mock("next-auth/providers/google", () => ({
  default: (opts: unknown) => ({ id: "google", name: "Google", opts }),
}));

vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: () => ({}),
}));

beforeEach(() => {
  calls.length = 0;
  existingRow = null;
  process.env.CLINIC_EMAIL_ALLOWLIST = "alice@clinic.com,*@allowed.org";
  process.env.GOOGLE_CLIENT_ID = "x";
  process.env.GOOGLE_CLIENT_SECRET = "y";
  process.env.NEXTAUTH_SECRET = "test-secret";
});

afterEach(() => {
  vi.resetModules();
});

async function loadConfig(): Promise<{
  signIn: (args: { user: { id?: string; email?: string | null; name?: string | null } }) => Promise<boolean | string>;
}> {
  const mod = (await import("@/lib/auth/config")) as unknown as {
    authConfig: {
      callbacks: {
        signIn: (args: {
          user: { id?: string; email?: string | null; name?: string | null };
        }) => Promise<boolean | string>;
      };
    };
  };
  return { signIn: mod.authConfig.callbacks.signIn };
}

describe("NextAuth signIn callback", () => {
  it("rejects emails not on the allowlist", async () => {
    const { signIn } = await loadConfig();
    const result = await signIn({
      user: { id: "u1", email: "stranger@example.com", name: "Stranger" },
    });
    expect(result).toBe("/login?error=not_allowlisted");
    expect(calls).toHaveLength(0);
  });

  it("rejects when email is missing", async () => {
    const { signIn } = await loadConfig();
    const result = await signIn({ user: { id: "u1", email: null } });
    expect(result).toBe("/login?error=not_allowlisted");
  });

  it("accepts allowlisted email and inserts staff_users row when missing", async () => {
    const { signIn } = await loadConfig();
    const result = await signIn({
      user: { id: "u-123", email: "Alice@CLINIC.com", name: "Alice" },
    });
    expect(result).toBe(true);
    expect(calls).toEqual([
      { op: "insert", id: "u-123", email: "alice@clinic.com", name: "Alice" },
    ]);
  });

  it("accepts wildcard-allowlisted email and updates existing staff_users row", async () => {
    existingRow = { id: "old-uuid", active: true };
    const { signIn } = await loadConfig();
    const result = await signIn({
      user: { id: "new-id", email: "bob@allowed.org", name: "Bob" },
    });
    expect(result).toBe(true);
    expect(calls).toEqual([
      { op: "update", id: "new-id", name: "Bob", email: "" },
    ]);
  });

  it("rejects allowlisted but deactivated staff", async () => {
    existingRow = { id: "old-uuid", active: false };
    const { signIn } = await loadConfig();
    const result = await signIn({
      user: { id: "new-id", email: "alice@clinic.com", name: "Alice" },
    });
    expect(result).toBe("/login?error=not_allowlisted");
    expect(calls).toHaveLength(0);
  });
});
