import { describe, expect, it } from "vitest";
import { DEFAULT_CLINIC, buildSuggestSystemPrompt } from "@/lib/clinic-prompts";
import { rowToClinicConfig } from "@/lib/clinic-knowledge";
import type { ClinicSettings } from "@/lib/db/schema";
import { applyPreset } from "@/lib/providers/presets";
import { DEFAULT_ESCALATION_RULES } from "@/lib/escalation-rules";

function sampleRow(overrides: Partial<ClinicSettings> = {}): ClinicSettings {
  const preset = applyPreset("balanced");
  return {
    id: "00000000-0000-0000-0000-000000000010",
    clinicId: "00000000-0000-0000-0000-000000000001",
    stt: preset.stt,
    translate: preset.translate,
    tts: preset.tts,
    suggest: preset.suggest,
    latencyMode: preset.latencyMode,
    realtimeMode: preset.realtimeMode,
    aiAssistEnabled: true,
    recordingEnabled: false,
    retentionDaysTranscripts: 2555,
    retentionDaysAudio: 90,
    dialect: "mx",
    clinicName: "Bluebonnet Family Care",
    clinicHours: "Mon–Fri 8a–5p CT",
    clinicServices: ["physicals", "refills"],
    clinicAfterHours: "Voicemail after 5 PM.",
    clinicTransferPhone: "+1-512-555-0199",
    clinicPolicyNotes: "No Schedule II refills by phone.",
    clinicFaqBullets: ["Free parking behind the building."],
    escalationRules: DEFAULT_ESCALATION_RULES,
    updatedAt: new Date(),
    updatedBy: null,
    ...overrides,
  };
}

describe("rowToClinicConfig", () => {
  it("maps persisted knowledge fields into ClinicConfig", () => {
    const cfg = rowToClinicConfig(sampleRow());
    expect(cfg.name).toBe("Bluebonnet Family Care");
    expect(cfg.hours.weekly).toBe("Mon–Fri 8a–5p CT");
    expect(cfg.hours.afterHours).toBe("Voicemail after 5 PM.");
    expect(cfg.services).toEqual(["physicals", "refills"]);
    expect(cfg.transferPhone).toBe("+1-512-555-0199");
    expect(cfg.policyNotes).toBe("No Schedule II refills by phone.");
    expect(cfg.faqBullets).toEqual(["Free parking behind the building."]);
  });

  it("feeds FAQ bullets into the suggest system prompt", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: rowToClinicConfig(sampleRow()),
      dialect: "mx",
    });
    expect(prompt).toContain("Common FAQs:");
    expect(prompt).toContain("Free parking behind the building.");
    expect(prompt).toContain("No Schedule II refills by phone.");
  });

  it("falls back to default services when the row has an empty list", () => {
    const cfg = rowToClinicConfig(sampleRow({ clinicServices: [] }));
    expect(cfg.services).toEqual(DEFAULT_CLINIC.services);
  });
});
