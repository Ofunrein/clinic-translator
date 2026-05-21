import { describe, it, expectTypeOf } from "vitest";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import {
  patients,
  calls,
  utterances,
  staffUsers,
  glossaryTerms,
  auditLog,
} from "../../lib/db/schema";

// These tests exist purely so `tsc --noEmit` / vitest type-checks the
// schema's inferred Select/Insert shapes. No DB connection required.

describe("schema types", () => {
  it("patients select/insert types are well-formed", () => {
    type S = InferSelectModel<typeof patients>;
    type I = InferInsertModel<typeof patients>;
    expectTypeOf<S["id"]>().toEqualTypeOf<string>();
    expectTypeOf<S["callbackPhoneEnc"]>().toEqualTypeOf<Buffer | null>();
    expectTypeOf<S["nameEnc"]>().toEqualTypeOf<Buffer | null>();
    expectTypeOf<S["preferredDialect"]>().toEqualTypeOf<string | null>();
    expectTypeOf<S["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<I["id"]>().toEqualTypeOf<string | undefined>();
  });

  it("calls foreign-key columns are nullable as expected", () => {
    type S = InferSelectModel<typeof calls>;
    expectTypeOf<S["patientId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<S["staffUserId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<S["source"]>().toEqualTypeOf<"desktop">();
    expectTypeOf<S["urgency"]>().toEqualTypeOf<
      "low" | "normal" | "high" | "urgent"
    >();
  });

  it("utterances has required call_id, role, lang, ts", () => {
    type S = InferSelectModel<typeof utterances>;
    type I = InferInsertModel<typeof utterances>;
    expectTypeOf<S["callId"]>().toEqualTypeOf<string>();
    expectTypeOf<S["role"]>().toEqualTypeOf<"patient" | "staff">();
    expectTypeOf<S["lang"]>().toEqualTypeOf<"es" | "en">();
    expectTypeOf<S["textEnc"]>().toEqualTypeOf<Buffer | null>();
    expectTypeOf<S["translationEnc"]>().toEqualTypeOf<Buffer | null>();
    // Insert requires callId, role, lang
    const _ok: I = {
      callId: "00000000-0000-0000-0000-000000000000",
      role: "patient",
      lang: "es",
    };
    void _ok;
  });

  it("staff_users role enum is constrained", () => {
    type S = InferSelectModel<typeof staffUsers>;
    expectTypeOf<S["email"]>().toEqualTypeOf<string>();
    expectTypeOf<S["role"]>().toEqualTypeOf<"owner" | "staff" | "admin">();
    expectTypeOf<S["active"]>().toEqualTypeOf<boolean>();
  });

  it("glossary_terms requires en/es text", () => {
    type S = InferSelectModel<typeof glossaryTerms>;
    type I = InferInsertModel<typeof glossaryTerms>;
    expectTypeOf<S["en"]>().toEqualTypeOf<string>();
    expectTypeOf<S["es"]>().toEqualTypeOf<string>();
    const _ok: I = { en: "headache", es: "dolor de cabeza" };
    void _ok;
  });

  it("audit_log has correct action/target enums", () => {
    type S = InferSelectModel<typeof auditLog>;
    expectTypeOf<S["action"]>().toEqualTypeOf<
      | "view"
      | "edit"
      | "create"
      | "delete"
      | "auth_login"
      | "auth_logout"
      | "translate_refused"
      | "decrypt_failed"
    >();
    expectTypeOf<S["targetType"]>().toEqualTypeOf<
      "patient" | "call" | "utterance" | "staff_user" | "glossary_term"
    >();
    expectTypeOf<S["targetId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<S["actorId"]>().toEqualTypeOf<string | null>();
  });
});
