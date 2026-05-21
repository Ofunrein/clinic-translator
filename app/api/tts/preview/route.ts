// Track C2. POST /api/tts/preview — synthesize a fixed sample sentence
// using the provided TTS provider config. Used by the admin UI's voice
// preview button. Admin-only.

import type { z } from "zod";
import { requireRole, AuthorizationError } from "@/lib/auth/roles";
import { requireUser } from "@/lib/api/auth";
import { synthesize } from "@/lib/providers/clients";
import { ttsPreviewBodySchema } from "@/lib/api/zod-schemas";
import {
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";

export const runtime = "nodejs";

const DEFAULT_SAMPLE =
  "Hola, esta es una prueba de voz para la clínica. ¿En qué le puedo ayudar hoy?";

export async function POST(req: Request): Promise<Response> {
  const traceId = newTraceId();
  try {
    await requireRole(req, ["admin"]);
    await requireUser(req);

    const json: unknown = await req.json().catch(() => null);
    const parsed = ttsPreviewBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid preview body",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }

    const result = await synthesize({
      text: parsed.data.text ?? DEFAULT_SAMPLE,
      config: parsed.data.config,
    });

    return new Response(new Uint8Array(result.audio), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(result.audio.byteLength),
        "cache-control": "no-store",
        "x-tts-voice": result.voice,
        "x-trace-id": traceId,
      },
    });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return errorToResponse(err);
    }
    return errorToResponse(err);
  }
}
