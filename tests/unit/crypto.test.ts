import { describe, it, expect } from "vitest";
import { decryptPHI, encryptPHI } from "../../lib/crypto";

describe("lib/crypto (plaintext storage)", () => {
  it("round-trips plaintext as UTF-8 bytes", async () => {
    const plain = "Maria López, refill metformin 500mg";
    const stored = await encryptPHI(plain);
    expect(Buffer.isBuffer(stored)).toBe(true);
    expect(stored.toString("utf8")).toBe(plain);
    const out = await decryptPHI(stored);
    expect(out).toBe(plain);
  });

  it("decryptPHI returns null for null input", async () => {
    await expect(decryptPHI(null)).resolves.toBeNull();
  });

  it("stores identical bytes for the same plaintext", async () => {
    const a = await encryptPHI("hello");
    const b = await encryptPHI("hello");
    expect(a.equals(b)).toBe(true);
  });
});
