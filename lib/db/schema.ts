import {
  pgEnum,
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  numeric,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// Postgres BYTEA <-> Node Buffer
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ----- Enums -----
export const sourceEnum = pgEnum("source", ["desktop"]);
export const urgencyEnum = pgEnum("urgency", ["low", "normal", "high", "urgent"]);
export const outcomeEnum = pgEnum("outcome", [
  "completed",
  "transferred",
  "voicemail",
  "dropped",
  "fallback",
]);
export const utteranceRoleEnum = pgEnum("utterance_role", ["patient", "staff"]);
export const langEnum = pgEnum("lang", ["es", "en"]);
export const staffRoleEnum = pgEnum("staff_role", ["owner", "staff", "admin"]);
export const glossaryCategoryEnum = pgEnum("glossary_category", [
  "medication",
  "symptom",
  "procedure",
  "billing",
  "scheduling",
  "general",
]);
export const auditActionEnum = pgEnum("audit_action", [
  "view",
  "edit",
  "create",
  "delete",
  "auth_login",
  "auth_logout",
  "translate_refused",
  "decrypt_failed",
]);
export const auditTargetTypeEnum = pgEnum("audit_target_type", [
  "patient",
  "call",
  "utterance",
  "staff_user",
  "glossary_term",
]);

// ----- AI assist (Track C1) -----
export const suggestionOutcomeEnum = pgEnum("suggestion_outcome_enum", [
  "accepted",
  "edited",
  "dismissed",
  "none",
]);

// ----- patients -----
export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  callbackPhoneEnc: bytea("callback_phone_enc"),
  nameEnc: bytea("name_enc"),
  dobLast4Enc: bytea("dob_last4_enc"),
  preferredDialect: text("preferred_dialect"),
  notesEnc: bytea("notes_enc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// ----- staff_users -----
export const staffUsers = pgTable(
  "staff_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    role: staffRoleEnum("role").notNull().default("staff"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex("staff_users_email_uq").on(t.email),
  }),
);

// ----- calls -----
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "cascade" }),
    source: sourceEnum("source").notNull().default("desktop"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    urgency: urgencyEnum("urgency").notNull().default("normal"),
    outcome: outcomeEnum("outcome"),
    staffUserId: uuid("staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    startedAtIdx: index("calls_started_at_idx").on(t.startedAt),
    patientIdx: index("calls_patient_id_idx").on(t.patientId),
  }),
);

// ----- utterances -----
export const utterances = pgTable(
  "utterances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    role: utteranceRoleEnum("role").notNull(),
    lang: langEnum("lang").notNull(),
    textEnc: bytea("text_enc"),
    translationEnc: bytea("translation_enc"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    audioStorageKey: text("audio_storage_key"),
    // ----- AI-assist columns (Track C1) -----
    suggestionTextEnc: bytea("suggestion_text_enc"),
    suggestionConfidence: numeric("suggestion_confidence", { precision: 3, scale: 2 }),
    suggestionOutcome: suggestionOutcomeEnum("suggestion_outcome")
      .notNull()
      .default("none"),
    suggestionEscalate: boolean("suggestion_escalate").notNull().default(false),
  },
  (t) => ({
    callIdIdx: index("utterances_call_id_idx").on(t.callId),
    tsIdx: index("utterances_ts_idx").on(t.ts),
  }),
);

// ----- glossary_terms -----
export const glossaryTerms = pgTable("glossary_terms", {
  id: uuid("id").primaryKey().defaultRandom(),
  en: text("en").notNull(),
  es: text("es").notNull(),
  dialect: text("dialect"),
  category: glossaryCategoryEnum("category").notNull().default("general"),
  createdBy: uuid("created_by").references(() => staffUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ----- audit_log -----
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => staffUsers.id, { onDelete: "set null" }),
    action: auditActionEnum("action").notNull(),
    targetType: auditTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    ipAddr: text("ip_addr"),
    reason: text("reason"),
  },
  (t) => ({
    tsIdx: index("audit_log_ts_idx").on(t.ts),
    actorIdx: index("audit_log_actor_idx").on(t.actorId),
    targetIdx: index("audit_log_target_idx").on(t.targetType, t.targetId),
  }),
);

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type Utterance = typeof utterances.$inferSelect;
export type NewUtterance = typeof utterances.$inferInsert;
export type StaffUser = typeof staffUsers.$inferSelect;
export type NewStaffUser = typeof staffUsers.$inferInsert;
export type GlossaryTerm = typeof glossaryTerms.$inferSelect;
export type NewGlossaryTerm = typeof glossaryTerms.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

// ----- clinic_settings (Track C2) -----
// One row per clinic. Provider blobs live in jsonb columns and are
// validated against the registry-aware zod schema in lib/api/zod-schemas
// before write. Defaults reflect spec §6 (cheapest + fastest + effective).
export const latencyModeEnum = pgEnum("latency_mode", [
  "fast",
  "balanced",
  "accurate",
]);
export const realtimeModeEnum = pgEnum("realtime_mode", [
  "text-middleman",
  "s2s",
]);
export const dialectEnum = pgEnum("clinic_dialect", ["mx", "cen", "car", "other"]);

export const clinicSettings = pgTable(
  "clinic_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").notNull(),
    stt: jsonb("stt").notNull(),
    translate: jsonb("translate").notNull(),
    tts: jsonb("tts").notNull(),
    suggest: jsonb("suggest").notNull(),
    latencyMode: latencyModeEnum("latency_mode").notNull().default("balanced"),
    realtimeMode: realtimeModeEnum("realtime_mode").notNull().default("text-middleman"),
    aiAssistEnabled: boolean("ai_assist_enabled").notNull().default(true),
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    retentionDaysTranscripts: integer("retention_days_transcripts").notNull().default(2555),
    retentionDaysAudio: integer("retention_days_audio").notNull().default(90),
    dialect: dialectEnum("dialect").notNull().default("mx"),
    clinicName: text("clinic_name").notNull().default("Riverside Family Clinic"),
    clinicHours: text("clinic_hours")
      .notNull()
      .default("Monday–Friday, 8:00 AM to 5:00 PM Central"),
    escalationRules: jsonb("escalation_rules").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    clinicIdUq: uniqueIndex("clinic_settings_clinic_id_uq").on(t.clinicId),
  }),
);

export type ClinicSettings = typeof clinicSettings.$inferSelect;
export type NewClinicSettings = typeof clinicSettings.$inferInsert;

// ----- NextAuth (Auth.js) adapter tables -----
// Distinct from `staff_users`. NextAuth owns identity + sessions; `staff_users`
// owns clinic role + audit FKs. The `signIn` callback in lib/auth/config.ts
// mirrors id+email between them on every sign-in.
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

export type NextAuthUser = typeof users.$inferSelect;
export type NewNextAuthUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type AuthSession = typeof sessions.$inferSelect;
export type NewAuthSession = typeof sessions.$inferInsert;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;

// ----- user_credentials (email+password auth, no email confirmation) -----
export const userCredentials = pgTable("user_credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserCredential = typeof userCredentials.$inferSelect;
export type NewUserCredential = typeof userCredentials.$inferInsert;
