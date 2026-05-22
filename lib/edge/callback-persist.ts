// Server-only callback-number persistence. Kept separate from
// `callback-verify.ts` so client components can import extraction helpers
// without webpack pulling in `postgres`.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, patients } from "@/lib/db/schema";
import { encryptPHI } from "@/lib/crypto";

export interface PersistInput {
  patientId: string;
  e164: string;
  /** Sanitized actor info for audit. Never includes PHI. */
  actor: { staffUserId: string | null; ipAddr?: string };
  /** Trace id for cross-log correlation. */
  traceId: string;
}

export interface PersistResult {
  ok: boolean;
  reason?: string;
}

export async function persistCallbackNumber(
  input: PersistInput,
): Promise<PersistResult> {
  if (!/^\+\d{8,15}$/.test(input.e164)) {
    return { ok: false, reason: "invalid e164" };
  }
  try {
    const enc = await encryptPHI(input.e164);
    await db
      .update(patients)
      .set({ callbackPhoneEnc: enc, lastSeenAt: new Date() })
      .where(eq(patients.id, input.patientId));
    await db.insert(auditLog).values({
      actorId: input.actor.staffUserId,
      action: "edit",
      targetType: "patient",
      targetId: input.patientId,
      ipAddr: input.actor.ipAddr ?? null,
      reason: `callback_verified:${input.traceId}`,
    });
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "persist failed",
    };
  }
}
