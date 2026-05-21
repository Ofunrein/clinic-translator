import {
  pgEnum,
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

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
