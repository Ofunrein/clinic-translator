// Track C1. System-prompt builder for the AI reply suggestion layer.
// Spec §1, §3, §5 — AI suggests, human approves; never auto-sends.
//
// `clinic_settings` table is owned by Track C2; until that ships, callers
// (route + tests) fall back to the DEFAULT_CLINIC constant exported here.
//
// No PHI flows through this file — only static config + dialect tag.

import type { Dialect } from "./medical-glossary";

export interface ClinicHours {
  /** Free-form weekly hours summary, e.g. "Mon–Fri 8am–5pm CT". */
  weekly: string;
  /** Optional after-hours / weekend message override. */
  afterHours?: string;
}

export interface ClinicConfig {
  name: string;
  hours: ClinicHours;
  /** Top services the clinic offers (used to anchor scheduling replies). */
  services: string[];
  /** Phone number for transfer instructions; never include patient PHI. */
  transferPhone?: string;
  /** Free-form notes appended verbatim ("we don't accept Medicaid", etc). */
  policyNotes?: string;
  /** Short FAQ bullets the model may cite when answering common questions. */
  faqBullets?: string[];
}

/**
 * Hard-coded fallback used when Track C2's `clinic_settings` table is
 * unavailable. Values are intentionally generic; route handlers replace
 * them with the live row before invoking the model.
 */
export const DEFAULT_CLINIC: ClinicConfig = {
  name: "Riverside Family Clinic",
  hours: {
    weekly: "Monday–Friday, 8:00 AM to 5:00 PM Central",
    afterHours: "After hours, leave a voicemail; we return calls next business day.",
  },
  services: [
    "primary care visits",
    "physicals",
    "vaccinations",
    "lab draws",
    "prescription refills",
  ],
  transferPhone: undefined,
  policyNotes: undefined,
};

const DIALECT_REGISTER: Record<Dialect, string> = {
  mx: "Default to Mexican Spanish register; use 'usted' with patients; avoid Caribbean diminutives.",
  cen: "Default to Central American Spanish register; use 'usted'; voseo is acceptable for Salvadoran/Honduran patients.",
  car: "Default to Caribbean Spanish register; use 'usted' with elders; informal 'tú' otherwise; expect dropped /s/ in patient transcript.",
  all: "Use neutral Latin American Spanish register; use 'usted'; avoid regional slang.",
};

export interface BuildSuggestPromptArgs {
  clinic: ClinicConfig;
  dialect: Dialect;
}

/**
 * Construct the system prompt for the reply-suggestion model.
 *
 * Mandates:
 *  - ≤2-sentence English drafts (staff-facing)
 *  - JSON output: {suggestion, confidence, reasoning, escalate}
 *  - Escalate clinical, drug-dose, billing, emergency
 *  - Never invent clinical info
 *  - Ask a clarifying question when ambiguous
 */
export function buildSuggestSystemPrompt(args: BuildSuggestPromptArgs): string {
  const { clinic, dialect } = args;
  const services = clinic.services.length
    ? clinic.services.map((s) => `- ${s}`).join("\n")
    : "- (no service list configured)";
  const afterHours = clinic.hours.afterHours
    ? `\nAfter-hours policy: ${clinic.hours.afterHours}`
    : "";
  const transfer = clinic.transferPhone
    ? `\nTransfer phone: ${clinic.transferPhone}`
    : "";
  const policy = clinic.policyNotes
    ? `\nPolicy notes (verbatim): ${clinic.policyNotes}`
    : "";
  const faqs =
    clinic.faqBullets && clinic.faqBullets.length
      ? `\nCommon FAQs:\n${clinic.faqBullets.map((f) => `- ${f}`).join("\n")}`
      : "";

  return [
    `You are an English drafting assistant for the front-desk staff at ${clinic.name}.`,
    "A Spanish-speaking patient is on the phone. Their utterances are auto-translated to English in the conversation history.",
    "Your job is to suggest the SHORT English reply the staff member should consider speaking back. Staff will review, edit, or reject before anything is sent.",
    "",
    "Clinic context:",
    `- Name: ${clinic.name}`,
    `- Hours: ${clinic.hours.weekly}`,
    "- Services:",
    services,
    afterHours.trim(),
    transfer.trim(),
    policy.trim(),
    faqs.trim(),
    "",
    `Dialect register hint: ${DIALECT_REGISTER[dialect]}`,
    "",
    "Hard rules — FOLLOW EXACTLY:",
    "1. Output ONE JSON object and nothing else: {\"suggestion\": string, \"confidence\": number, \"reasoning\": string, \"escalate\": boolean}.",
    "2. `suggestion` MUST be ≤2 sentences of English, written for a clinic front-desk staffer to speak. Plain, warm, professional.",
    "3. `confidence` is a number 0.00–1.00 reflecting how sure you are the staffer can send this draft as-is without harm or rework.",
    "4. `reasoning` is ≤1 sentence; explain why the draft fits or why you escalated. Never include PHI.",
    "5. `escalate` MUST be true (and `suggestion` must recommend a transfer) when the patient asks about: clinical advice, symptoms severity, drug names or doses, drug interactions, lab/imaging interpretation, billing disputes, insurance coverage details, or anything sounding like an emergency (chest pain, breathing trouble, suicidal thoughts, severe bleeding, stroke signs).",
    "6. NEVER invent clinical information, dosages, prices, or coverage decisions. NEVER promise outcomes.",
    "7. If the patient's request is ambiguous, the suggestion MUST be a single clarifying question instead of a guess.",
    "8. Stay within scope of the clinic context above. If the patient asks about a service we don't offer, say so and suggest the appropriate redirect.",
    "9. Never auto-respond. The output is staged for human review only — the staffer is the sender of record.",
    "10. Do not add disclaimers, apologies, or 'as an AI' caveats.",
    "",
    "If the conversation history is empty or unclear, suggest a polite opener that confirms the patient's reason for calling.",
  ]
    .filter((line) => line.length > 0 || true)
    .join("\n");
}
