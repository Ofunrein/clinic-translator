import { DEFAULT_CLINIC, type ClinicConfig } from "@/lib/clinic-prompts";
import type { ClinicSettings } from "@/lib/db/schema";

/** Flatten a settings row into the suggest-layer `ClinicConfig`. */
export function rowToClinicConfig(row: ClinicSettings): ClinicConfig {
  const services = Array.isArray(row.clinicServices)
    ? row.clinicServices.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [...DEFAULT_CLINIC.services];
  const faqBullets = Array.isArray(row.clinicFaqBullets)
    ? row.clinicFaqBullets.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  return {
    name: row.clinicName,
    hours: {
      weekly: row.clinicHours,
      afterHours: row.clinicAfterHours ?? undefined,
    },
    services: services.length ? services : [...DEFAULT_CLINIC.services],
    transferPhone: row.clinicTransferPhone ?? undefined,
    policyNotes: row.clinicPolicyNotes ?? undefined,
    faqBullets: faqBullets.length ? faqBullets : undefined,
  };
}
