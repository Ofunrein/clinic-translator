// Track C2. /api/settings — admin-only GET / PATCH for `clinic_settings`.
//
// GET: returns the active row (lazily seeded with the balanced preset).
// PATCH: validates the patch via `settingsPatchSchema`, cross-checks
// every provider blob against the catalog, then writes + audits.
//
// Authz: `requireRole(['admin'])` enforces the role; defense-in-depth via
// `requireUser` for the email allowlist.

import { NextResponse } from "next/server";
import type { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { requireRole, AuthorizationError } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/audit";
import {
  settingsPatchSchema,
  type SettingsPatch,
} from "@/lib/api/zod-schemas";
import {
  ValidationError,
  errorToResponse,
  newTraceId,
} from "@/lib/api/errors";
import {
  getClinicSettings,
  updateClinicSettings,
  type ClinicSettingsPatch,
} from "@/lib/settings";
import {
  isValidModel,
  isValidVoice,
  getCatalogEntry,
} from "@/lib/providers/registry";

export const runtime = "nodejs";

function validateAgainstCatalog(
  patch: SettingsPatch,
): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (patch.stt) {
    if (!isValidModel("stt", patch.stt.provider, patch.stt.model)) {
      issues.push({
        path: "stt.model",
        message: `model not in catalog for ${patch.stt.provider}`,
      });
    }
  }
  if (patch.translate) {
    if (!isValidModel("translate", patch.translate.provider, patch.translate.model)) {
      issues.push({
        path: "translate.model",
        message: `model not in catalog for ${patch.translate.provider}`,
      });
    }
  }
  if (patch.suggest) {
    if (!isValidModel("suggest", patch.suggest.provider, patch.suggest.model)) {
      issues.push({
        path: "suggest.model",
        message: `model not in catalog for ${patch.suggest.provider}`,
      });
    }
  }
  if (patch.tts) {
    if (!isValidVoice(patch.tts.provider, patch.tts.voice, patch.tts.engine)) {
      issues.push({
        path: "tts.voice",
        message: `voice/engine not in catalog for ${patch.tts.provider}`,
      });
    }
    // Block providers without a BAA path unless explicitly enterprise; the
    // UI is responsible for warning the admin, but we hard-block `none`.
    const entry = getCatalogEntry("tts", patch.tts.provider);
    if (entry && entry.baaTier === "none") {
      issues.push({
        path: "tts.provider",
        message: `${patch.tts.provider} does not offer a BAA; selection blocked`,
      });
    }
  }
  return issues;
}

export async function GET(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    await requireUser(req);
    // Anyone authed can read; PHI doesn't ride this route.
    const row = await getClinicSettings();
    await recordAudit({
      actorId: null, // best-effort; route already auditing on PATCH
      action: "view",
      targetType: "staff_user",
      targetId: null,
      reason: `clinic_settings_read:${traceId}`,
    });
    return NextResponse.json({ settings: row, trace_id: traceId });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { userId } = await requireRole(req, ["admin"]);
    await requireUser(req);

    const json: unknown = await req.json().catch(() => null);
    const parsed = settingsPatchSchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(
        "invalid settings patch",
        parsed.error.issues.map((i: z.ZodIssue) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        { traceId },
      );
    }
    const catalogIssues = validateAgainstCatalog(parsed.data);
    if (catalogIssues.length > 0) {
      throw new ValidationError("settings rejected by catalog", catalogIssues, { traceId });
    }

    const row = await updateClinicSettings({
      patch: parsed.data as ClinicSettingsPatch,
      updatedBy: userId,
    });

    await recordAudit({
      actorId: userId,
      action: "edit",
      targetType: "staff_user",
      targetId: null,
      reason: `clinic_settings_patch:${traceId}:${Object.keys(parsed.data).join(",")}`,
    });

    return NextResponse.json({ settings: row, trace_id: traceId });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return errorToResponse(err);
    }
    return errorToResponse(err);
  }
}
