// POST /api/settings/migrate-deepgram — reset to Deepgram + Groq balanced preset.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { requireRole, AuthorizationError } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/audit";
import { errorToResponse, newTraceId } from "@/lib/api/errors";
import {
  DEFAULT_CLINIC_ID,
  getClinicSettings,
  updateClinicSettings,
} from "@/lib/settings";
import { applyPreset } from "@/lib/providers/presets";
import type { TtsProvider } from "@/lib/providers/types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { userId } = await requireRole(req, ["admin"]);
    await requireUser(req);

    const preset = applyPreset("balanced");
    const current = await getClinicSettings(DEFAULT_CLINIC_ID, {
      forceFresh: true,
    });
    const currentTts = current.tts as TtsProvider;
    const tts =
      currentTts.provider === preset.tts.provider ? currentTts : preset.tts;
    const row = await updateClinicSettings({
      patch: {
        stt: preset.stt,
        tts,
        translate: preset.translate,
        suggest: preset.suggest,
        latencyMode: preset.latencyMode,
        realtimeMode: preset.realtimeMode,
      },
      updatedBy: userId,
    });

    await recordAudit({
      actorId: userId,
      action: "edit",
      targetType: "staff_user",
      targetId: null,
      reason: `clinic_settings_migrate_deepgram:${traceId}`,
    });

    return NextResponse.json({ settings: row, trace_id: traceId });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return errorToResponse(err);
    }
    return errorToResponse(err);
  }
}
