import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { webcrypto } from "node:crypto";

// Two distinct base64 32-byte keys.
const KEY_A = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString(
  "base64",
);
const KEY_B = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString(
  "base64",
);

async function freshImport() {
  vi.resetModules();
  return import("../../lib/crypto");
}

describe("lib/crypto", () => {
  beforeEach(() => {
    vi.stubEnv("PHI_ENCRYPTION_KEY", KEY_A);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips plaintext", async () => {
    const { encryptPHI, decryptPHI } = await freshImport();
    const plain = "Maria López, DOB 03/14/1978, refill metformin 500mg";
    const ct = await encryptPHI(plain);
    expect(Buffer.isBuffer(ct)).toBe(true);
    expect(ct.length).toBeGreaterThan(12 + 16); // iv + tag minimum
    const out = await decryptPHI(ct);
    expect(out).toBe(plain);
  });

  it("encrypts the same plaintext to different ciphertexts (random IV)", async () => {
    const { encryptPHI } = await freshImport();
    const a = await encryptPHI("hello");
    const b = await encryptPHI("hello");
    expect(a.equals(b)).toBe(false);
  });

  it("decryptPHI returns null for null input", async () => {
    const { decryptPHI } = await freshImport();
    await expect(decryptPHI(null)).resolves.toBeNull();
  });

  it("throws PHIDecryptError on tampered ciphertext", async () => {
    const { encryptPHI, decryptPHI, PHIDecryptError } = await freshImport();
    const ct = await encryptPHI("sensitive");
    // Flip a byte in the ciphertext body
    ct[ct.length - 5] ^= 0xff;
    await expect(decryptPHI(ct)).rejects.toBeInstanceOf(PHIDecryptError);
  });

  it("throws PHIDecryptError on too-short ciphertext", async () => {
    const { decryptPHI, PHIDecryptError } = await freshImport();
    await expect(decryptPHI(Buffer.alloc(4))).rejects.toBeInstanceOf(PHIDecryptError);
  });

  it("decrypts successfully with the same key it was encrypted with", async () => {
    const mod = await freshImport();
    const ct = await mod.encryptPHI("keep me");
    const out = await mod.decryptPHI(ct);
    expect(out).toBe("keep me");
  });

  it("key rotation: ciphertext from key A fails to decrypt under key B", async () => {
    const modA = await freshImport();
    const ct = await modA.encryptPHI("rotate me");

    // Swap key, force module re-init so the new env is read.
    vi.stubEnv("PHI_ENCRYPTION_KEY", KEY_B);
    const modB = await freshImport();

    await expect(modB.decryptPHI(ct)).rejects.toBeInstanceOf(modB.PHIDecryptError);
  });

  it("throws PHIEncryptError when key env is missing", async () => {
    vi.stubEnv("PHI_ENCRYPTION_KEY", "");
    const { encryptPHI, PHIEncryptError } = await freshImport();
    await expect(encryptPHI("x")).rejects.toBeInstanceOf(PHIEncryptError);
  });

  it("throws PHIEncryptError when key length is wrong", async () => {
    vi.stubEnv(
      "PHI_ENCRYPTION_KEY",
      Buffer.from(new Uint8Array(16)).toString("base64"),
    );
    const { encryptPHI, PHIEncryptError } = await freshImport();
    await expect(encryptPHI("x")).rejects.toBeInstanceOf(PHIEncryptError);
  });
});
