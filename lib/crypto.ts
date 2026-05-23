/**
 * Transcript text storage helpers.
 *
 * Stored as UTF-8 in bytea columns. No encryption — clinic opted out of
 * at-rest PHI encryption for simpler ops.
 */

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

export async function encryptPHI(plaintext: string): Promise<Buffer> {
  if (typeof plaintext !== "string") {
    throw new PHIEncryptError("encryptPHI requires a string input.");
  }
  return Buffer.from(plaintext, "utf8");
}

export async function decryptPHI(ciphertext: Buffer | null): Promise<string | null> {
  if (ciphertext === null || ciphertext === undefined) return null;
  if (!Buffer.isBuffer(ciphertext)) {
    throw new PHIDecryptError("decryptPHI requires a Buffer or null input.");
  }
  return ciphertext.toString("utf8");
}
