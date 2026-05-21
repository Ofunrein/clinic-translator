// Track C1 unit test for buildSuggestSystemPrompt.
// Asserts the prompt embeds clinic identity, dialect register, escalation
// rules, JSON output spec, and the never-invent constraint.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLINIC,
  buildSuggestSystemPrompt,
  type ClinicConfig,
} from "@/lib/clinic-prompts";

const TEST_CLINIC: ClinicConfig = {
  name: "Bluebonnet Family Care",
  hours: {
    weekly: "Mon–Fri 8a–5p, Sat 9a–noon CT",
    afterHours: "After 5p we route to voicemail.",
  },
  services: ["physicals", "well-child visits", "refills"],
  transferPhone: "+1-512-555-0199",
  policyNotes: "We do not refill Schedule II medications by phone.",
};

describe("buildSuggestSystemPrompt", () => {
  it("includes clinic name, hours, and configured services", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: TEST_CLINIC,
      dialect: "mx",
    });
    expect(prompt).toContain("Bluebonnet Family Care");
    expect(prompt).toContain("Mon–Fri 8a–5p, Sat 9a–noon CT");
    expect(prompt).toContain("- physicals");
    expect(prompt).toContain("- refills");
    expect(prompt).toContain("After 5p we route to voicemail.");
    expect(prompt).toContain("+1-512-555-0199");
    expect(prompt).toContain("We do not refill Schedule II medications by phone.");
  });

  it("embeds the dialect register hint", () => {
    const mx = buildSuggestSystemPrompt({ clinic: TEST_CLINIC, dialect: "mx" });
    const car = buildSuggestSystemPrompt({ clinic: TEST_CLINIC, dialect: "car" });
    expect(mx).toMatch(/Mexican Spanish register/);
    expect(car).toMatch(/Caribbean Spanish register/);
    // The hint section is labeled.
    expect(mx).toContain("Dialect register hint:");
  });

  it("declares the JSON output spec with the four required fields", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: TEST_CLINIC,
      dialect: "all",
    });
    expect(prompt).toMatch(/"suggestion":\s*string/);
    expect(prompt).toMatch(/"confidence":\s*number/);
    expect(prompt).toMatch(/"reasoning":\s*string/);
    expect(prompt).toMatch(/"escalate":\s*boolean/);
    expect(prompt).toMatch(/ONE JSON object/);
  });

  it("encodes the escalation rules: clinical, drug-dose, billing, emergencies", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: TEST_CLINIC,
      dialect: "all",
    });
    expect(prompt).toMatch(/clinical advice/i);
    expect(prompt).toMatch(/drug names or doses/i);
    expect(prompt).toMatch(/billing disputes/i);
    expect(prompt).toMatch(/emergency/i);
    expect(prompt).toMatch(/chest pain/);
  });

  it("forbids inventing clinical info and demands clarifying questions when ambiguous", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: TEST_CLINIC,
      dialect: "all",
    });
    expect(prompt).toMatch(/NEVER invent clinical information/);
    expect(prompt).toMatch(/clarifying question/i);
    expect(prompt).toMatch(/staff member should consider speaking back/i);
  });

  it("caps the suggestion at two sentences", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: TEST_CLINIC,
      dialect: "all",
    });
    expect(prompt).toMatch(/≤2 sentences/);
  });

  it("falls back to DEFAULT_CLINIC when no live row is available", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: DEFAULT_CLINIC,
      dialect: "mx",
    });
    expect(prompt).toContain(DEFAULT_CLINIC.name);
    // The default has no policyNotes / transferPhone — those should not show up
    // as empty key prefixes.
    expect(prompt).not.toMatch(/Transfer phone:\s*$/m);
    expect(prompt).not.toMatch(/Policy notes \(verbatim\):\s*$/m);
  });

  it("emits the human-in-the-loop guard", () => {
    const prompt = buildSuggestSystemPrompt({
      clinic: TEST_CLINIC,
      dialect: "mx",
    });
    expect(prompt).toMatch(/Never auto-respond/);
    expect(prompt).toMatch(/staged for human review/i);
  });
});
