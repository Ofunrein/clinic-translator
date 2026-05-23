// Track C2. Integration tests for /api/settings.
// Mocks the Drizzle surface and auth helpers so the route can be exercised
// without a live Postgres / Supabase. Asserts:
//   - PATCH validates and rejects invalid configs (zod + catalog cross-check)
//   - PATCH writes an audit_log entry on success
//   - PATCH requires admin role (non-admin → 403)
//   - GET returns the seeded row

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable per-test mocks live at module scope so they survive vi.mock factories.
type Row = Record<string, unknown>;
const state: {
  storedRow: Row | null;
  updates: Row[];
  inserts: Row[];
  audits: Row[];
  role: "admin" | "staff" | "owner";
  authShouldThrow: boolean;
} = {
  storedRow: null,
  updates: [],
  inserts: [],
  audits: [],
  role: "admin",
  authShouldThrow: false,
};

vi.mock("@/lib/db/client", () => {
  const selectBuilder = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit() {
      return Promise.resolve(state.storedRow ? [state.storedRow] : []);
    },
  };
  const insertBuilder = {
    values(v: Row) {
      state.inserts.push(v);
      state.storedRow = { ...v, updatedAt: new Date() };
      return this;
    },
    returning() {
      return Promise.resolve([state.storedRow]);
    },
  };
  const updateBuilder = {
    set(v: Row) {
      this._set = v;
      return this;
    },
    where() {
      return this;
    },
    returning() {
      state.updates.push(this._set as Row);
      state.storedRow = { ...(state.storedRow ?? {}), ...(this._set as Row) };
      return Promise.resolve([state.storedRow]);
    },
    _set: {} as Row,
  };
  const db = {
    select: () => selectBuilder,
    insert: () => insertBuilder,
    update: () => updateBuilder,
  };
  return { db, schema: {} };
});

vi.mock("@/lib/audit", () => ({
  recordAudit: async (a: Row) => {
    state.audits.push(a);
  },
}));

vi.mock("@/lib/api/auth", () => ({
  requireUser: async () => {
    if (state.authShouldThrow) throw new Error("not signed in");
    return {
      userId: "00000000-0000-0000-0000-000000000099",
      email: "admin@example.com",
      role: state.role,
    };
  },
}));

vi.mock("@/lib/auth/roles", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/auth/roles");
  return {
    ...actual,
    requireRole: async (_req: Request, allowed: readonly string[]) => {
      if (!allowed.includes(state.role)) {
        const { AuthorizationError } = actual as {
          AuthorizationError: new (code: string, msg: string) => Error;
        };
        throw new AuthorizationError("forbidden", `role ${state.role} not permitted`);
      }
      return { userId: "00000000-0000-0000-0000-000000000099", role: state.role };
    },
  };
});

beforeEach(() => {
  state.storedRow = null;
  state.updates = [];
  state.inserts = [];
  state.audits = [];
  state.role = "admin";
  state.authShouldThrow = false;
  // Imported lazily so module-state is fresh.
});

afterEach(() => {
  vi.resetModules();
});

async function importRoute(): Promise<typeof import("@/app/api/settings/route")> {
  const { __resetSettingsCacheForTest } = await import("@/lib/settings");
  __resetSettingsCacheForTest();
  return import("@/app/api/settings/route");
}

describe("/api/settings", () => {
  it("GET seeds the default row on first read and returns it", async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request("http://localhost/api/settings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Row };
    expect(body.settings).toBeDefined();
    // Defaults from the balanced preset (Deepgram + Groq).
    expect((body.settings.translate as Row).provider).toBe("groq");
    expect((body.settings.tts as Row).provider).toBe("deepgram");
  });

  it("PATCH rejects invalid provider config with 400", async () => {
    const { PATCH } = await importRoute();
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        translate: { provider: "bedrock", model: "" }, // empty model = zod fail
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("PATCH rejects models not in the catalog", async () => {
    // Seed first.
    const { GET, PATCH } = await importRoute();
    await GET(new Request("http://localhost/api/settings"));
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        translate: { provider: "bedrock", model: "anthropic.claude-not-real-v1:0" },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation");
  });

  it("PATCH accepts a valid latency mode change and writes audit entry", async () => {
    const { GET, PATCH } = await importRoute();
    await GET(new Request("http://localhost/api/settings"));
    state.audits.length = 0;
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        latencyMode: "accurate",
        translate: {
          provider: "groq",
          model: "llama-3.3-70b-versatile",
        },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Row };
    expect(body.settings.latencyMode).toBe("accurate");
    expect(state.updates.length).toBeGreaterThan(0);
    expect(state.audits.some((a) => a.action === "edit")).toBe(true);
  });

  it("PATCH requires admin role — staff role gets 403", async () => {
    state.role = "staff";
    const { GET, PATCH } = await importRoute();
    await GET(new Request("http://localhost/api/settings"));
    state.role = "staff";
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aiAssistEnabled: false }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it("PATCH blocks providers without any BAA path (ElevenLabs)", async () => {
    const { GET, PATCH } = await importRoute();
    await GET(new Request("http://localhost/api/settings"));
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tts: { provider: "elevenlabs", voice: "turbo-v2-5-es", engine: "turbo-v2-5" },
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("validation");
  });
});
