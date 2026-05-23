// Staff EN→ES preview timing from clinic settings (AI Assist tab).
"use client";

import { useClinicSettings } from "@/lib/hooks/useClinicSettings";
import {
  DEFAULT_ESCALATION_RULES,
  normalizeEscalationRules,
  previewHoldMsFromRules,
} from "@/lib/escalation-rules";
import type { EscalationRules } from "@/lib/providers/types";

export interface StaffComposeSettings {
  /** Milliseconds staff can review Spanish preview before timer action. */
  previewHoldMs: number;
  /** When true, timer expiry calls Send & Speak; otherwise preview is dismissed. */
  autoSendPreview: boolean;
  /** Raw rules blob (for settings UI). */
  escalation: EscalationRules;
}

export function staffComposeFromRules(
  rules: EscalationRules | undefined,
): StaffComposeSettings {
  const escalation = normalizeEscalationRules(
    rules ?? { keywords: [], confidenceFloor: 0.6 },
  );
  return {
    previewHoldMs: previewHoldMsFromRules(escalation),
    autoSendPreview: escalation.autoSendPreview ?? false,
    escalation,
  };
}

export function useStaffComposeSettings(): StaffComposeSettings {
  const q = useClinicSettings();
  if (!q.data) {
    return staffComposeFromRules(DEFAULT_ESCALATION_RULES);
  }
  return staffComposeFromRules(q.data.escalationRules as EscalationRules);
}
