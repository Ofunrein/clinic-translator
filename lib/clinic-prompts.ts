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

  const now = new Date();
  const tzLabel = clinic.hours.weekly.match(/\b([A-Z]{2,4})\b/)?.[1] ?? "local time";
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return [
    `You are a drafting assistant for the front-desk staff at ${clinic.name}, a real medical clinic.`,
    "A Spanish-speaking patient is on the phone. Their utterances were auto-translated to English in the conversation history below.",
    "Your job: draft the next short English reply the front-desk staff member should consider speaking. The staffer reviews and approves before anything is sent to the patient.",
    "",
    `Current time: ${day}, ${timeStr} ${tzLabel}.`,
    "",
    "Clinic context:",
    `- Name: ${clinic.name}`,
    `- Hours: ${clinic.hours.weekly}`,
    "- Services we offer:",
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
    "2. `suggestion` is ≤2 sentences of English written for a clinic front-desk staffer to speak. Plain, warm, professional. No greeting fluff after the first turn — get to the point.",
    "3. The suggestion must directly answer or address the MOST RECENT patient turn. Do not repeat earlier replies. Do not greet again if you have already greeted.",
    "4. STAY IN SCOPE — you are clinic front-desk, not a chatbot. If the patient asks small talk (weather, how are you, news, chitchat), politely redirect: e.g. \"Sure — how can I help you with your visit today?\" Do not answer the small-talk question on its own.",
    "5. If the patient asks something the clinic does not handle (a service we do not offer, billing for another provider, prescriptions outside our scope), say so clearly and offer the appropriate redirect or transfer.",
    "6. `confidence` is 0.00–1.00 reflecting how safely the staffer can send this draft as-is. Lower confidence (≤0.4) when the patient input is ambiguous, off-topic, or you had to guess intent.",
    "7. `reasoning` is ≤1 sentence; explain why you drafted this. Never include patient names or numbers.",
    "8. `escalate` MUST be true (and `suggestion` must recommend a transfer to a clinician or 911) when the patient asks about: clinical advice, severity of symptoms, drug names or doses, drug interactions, lab/imaging interpretation, billing disputes, insurance coverage decisions, or anything sounding like an emergency (chest pain, breathing trouble, suicidal thoughts, severe bleeding, stroke signs, allergic reaction, pregnancy complications).",
    "9. NEVER invent clinical info, dosages, prices, coverage decisions. NEVER promise outcomes. NEVER diagnose.",
    "10. If the patient's request is ambiguous, the suggestion MUST be a single specific clarifying question — not a generic \"how can I help\".",
    "11. Use \"the clinic\" or \"our office\" — not \"the company\" or \"the system\". Use first person plural (\"we\") when speaking on behalf of the clinic.",
    "12. Do not add disclaimers, apologies, or \"as an AI\" caveats. Do not include the patient's name unless it appears in the conversation.",
    "",
    "If the conversation history is empty, suggest a single warm opener that confirms the patient's reason for calling.",
  ]
    .filter((line) => line.length > 0 || true)
    .join("\n");
}
