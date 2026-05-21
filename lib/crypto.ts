import { webcrypto } from "node:crypto";

/**
 * PHI encryption helpers.
 *
 * Format on disk (Buffer): iv (12B) || ciphertext || authTag (16B)
 * Algorithm: AES-256-GCM
 * Key source: process.env.PHI_ENCRYPTION_KEY (base64-encoded 32 raw bytes).
 *
 * Spec §7: on decrypt failure, throw — never display garbled text.
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export class PHIDecryptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PHIDecryptError";
  }
}

export class PHIEncryptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PHIEncryptError";
  }
}

function loadRawKey(): Uint8Array {
  const b64 = process.env.PHI_ENCRYPTION_KEY;
  if (!b64) {
    throw new PHIEncryptError(
      "PHI_ENCRYPTION_KEY is not set. Cannot encrypt or decrypt PHI.",
    );
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, "base64");
  } catch (err) {
    throw new PHIEncryptError("PHI_ENCRYPTION_KEY is not valid base64.", {
      cause: err,
    });
  }
  if (raw.length !== KEY_LEN) {
    throw new PHIEncryptError(
      `PHI_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${raw.length}).`,
    );
  }
  return new Uint8Array(raw);
}

async function importKey(): Promise<CryptoKey> {
  const raw = loadRawKey();
  return webcrypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPHI(plaintext: string): Promise<Buffer> {
  if (typeof plaintext !== "string") {
    throw new PHIEncryptError("encryptPHI requires a string input.");
  }
  const key = await importKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LEN));
  const enc = new TextEncoder().encode(plaintext);
  let ctWithTag: ArrayBuffer;
  try {
    ctWithTag = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
  } catch (err) {
    throw new PHIEncryptError("AES-GCM encryption failed.", { cause: err });
  }
  // WebCrypto returns ciphertext || tag(16). We store as iv || ciphertext || tag.
  const out = Buffer.alloc(IV_LEN + ctWithTag.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ctWithTag), IV_LEN);
  return out;
}

export async function decryptPHI(ciphertext: Buffer | null): Promise<string | null> {
  if (ciphertext === null || ciphertext === undefined) return null;
  if (!Buffer.isBuffer(ciphertext)) {
    throw new PHIDecryptError("decryptPHI requires a Buffer or null input.");
  }
  if (ciphertext.length < IV_LEN + TAG_LEN) {
    throw new PHIDecryptError("Ciphertext too short to contain IV + tag.");
  }
  const key = await importKey();
  const iv = ciphertext.subarray(0, IV_LEN);
  const ctWithTag = ciphertext.subarray(IV_LEN);
  let plain: ArrayBuffer;
  try {
    plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ctWithTag);
  } catch (err) {
    throw new PHIDecryptError(
      "AES-GCM decryption failed. Key rotated, ciphertext tampered, or wrong key.",
      { cause: err },
    );
  }
  return new TextDecoder().decode(plain);
}
