// Track B2. POST /api/tts — provider-dispatched synthesis (Deepgram Aura default).
// Spec §4.2, §5.2 step 3-4, §7 (TTS failure → fallback voice).
//
// Body: { text, voice?, sessionId? }
// Response: audio/mpeg stream + Cache-Control private 24h.
// Errors:   JSON { code, message, retryable, trace_id } + 5xx status.

import { NextResponse } from "next/server";
import type { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { ttsBodySchema } from "@/lib/api/zod-schemas";
import { synthesize as dispatchSynthesize } from "@/lib/providers/clients";
import { DEFAULT_CLINIC_ID, getActiveProviderConfig } from "@/lib/settings";
import { ValidationError, errorToResponse, newTraceId } from "@/lib/api/errors";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const traceId = newTraceId();
  try {
    const user = await requireUser(req);

    const json: unknown = await req.json().catch(() => null);
    const parsed = ttsBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid tts body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const body = parsed.data;

    // Resolve active TTS config; if the body specifies an override `voice`,
    // we honor it on top of the active provider blob. The B3 frontend
    // currently passes only `text`, so the active config wins by default.
    // Force a fresh read so a just-saved Settings voice is used immediately.
    const active = await getActiveProviderConfig(DEFAULT_CLINIC_ID, {
      forceFresh: true,
    });
    const ttsConfig = body.voice
      ? { ...active.tts, voice: body.voice }
      : active.tts;

    const result = await dispatchSynthesize({ text: body.text, config: ttsConfig });

    if (body.sessionId) {
      // Audit the TTS read against the call so the access log is complete.
      await recordAudit({
        actorId: user.userId,
        action: "view",
        targetType: "call",
        targetId: body.sessionId,
        reason: result.fellBack ? "tts_fallback_voice" : null,
      });
    }

    // Stream MP3. Cache headers honor spec §5.2 step 4 + §6 caching guidance.
    return new Response(new Uint8Array(result.audio), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(result.audio.byteLength),
        "cache-control": "private, max-age=86400",
        "x-tts-cache": result.cacheHit ? "hit" : "miss",
        "x-tts-voice": result.voice,
        "x-trace-id": traceId,
      },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

// Defensive: GET is not part of the contract.
export function GET(): Response {
  return NextResponse.json({ code: "not_found", message: "use POST" }, { status: 405 });
}
