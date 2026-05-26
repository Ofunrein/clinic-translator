import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: { insert: vi.fn() },
}));

import { db } from "@/lib/db/client";
import { recordUsage } from "@/lib/usage";

type MockDb = { insert: ReturnType<typeof vi.fn> };

function setupInsertMock(shouldResolve = true) {
  const values = shouldResolve
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(new Error("db exploded"));
  (db as unknown as MockDb).insert = vi.fn().mockReturnValue({ values });
  return values;
}

afterEach(() => vi.clearAllMocks());

describe("recordUsage", () => {
  it("inserts correct fields for a translate call", async () => {
    const values = setupInsertMock();
    await recordUsage({
      route: "translate",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      promptTokens: 120,
      completionTokens: 30,
      ttsChars: null,
      sessionId: null,
    });
    expect((db as unknown as MockDb).insert).toHaveBeenCalledOnce();
    const row = values.mock.calls[0][0] as Record<string, unknown>;
    expect(row.route).toBe("translate");
    expect(row.provider).toBe("groq");
    expect(row.model).toBe("llama-3.3-70b-versatile");
    expect(row.promptTokens).toBe(120);
    expect(row.completionTokens).toBe(30);
    expect(row.ttsChars).toBeNull();
    expect(typeof row.estimatedCostUsd).toBe("string");
  });

  it("computes correct decimal cost for token-based calls", async () => {
    const captured: Record<string, unknown>[] = [];
    (db as unknown as MockDb).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        captured.push(row);
        return Promise.resolve(undefined);
      }),
    });
    await recordUsage({
      route: "suggest",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      promptTokens: 1000,
      completionTokens: 0,
      ttsChars: null,
      sessionId: null,
    });
    // groq llama-3.3-70b-versatile costPer1k = 0.00059
    // 1000 tokens * (0.00059 / 1000) = 0.00059
    expect(Number(captured[0].estimatedCostUsd)).toBeCloseTo(0.00059, 6);
  });

  it("swallows DB errors without throwing", async () => {
    setupInsertMock(false);
    await expect(
      recordUsage({ route: "tts", provider: "deepgram", model: "aura-2", promptTokens: null, completionTokens: null, ttsChars: 500, sessionId: null }),
    ).resolves.toBeUndefined();
  });
});
