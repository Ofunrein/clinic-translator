import type { EscalationRules } from "@/lib/providers/types";

export const DEFAULT_ESCALATION_RULES: EscalationRules = {
  keywords: [
    "chest pain",
    "shortness of breath",
    "suicide",
    "bleeding",
    "stroke",
    "overdose",
    "allergic reaction",
  ],
  confidenceFloor: 0.6,
  categories: ["clinical", "billing"],
  previewHoldSec: 10,
  autoSendPreview: false,
};

/** Merge persisted escalation json with defaults for newer optional fields. */
export function normalizeEscalationRules(raw: EscalationRules): EscalationRules {
  return {
    ...DEFAULT_ESCALATION_RULES,
    ...raw,
    keywords: raw.keywords?.length ? raw.keywords : DEFAULT_ESCALATION_RULES.keywords,
  };
}

export function previewHoldMsFromRules(rules: EscalationRules | undefined): number {
  const normalized = normalizeEscalationRules(
    rules ?? { keywords: [], confidenceFloor: 0.6 },
  );
  const sec = normalized.previewHoldSec ?? 10;
  return sec <= 0 ? 0 : sec * 1000;
}
