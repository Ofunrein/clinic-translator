import { RuleTester } from "eslint";
import { describe, it } from "vitest";
// @ts-expect-error -- ESLint rule is a plain JS file with no .d.ts
import rule from "../../eslint-rules/no-phi-log.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

describe("no-phi-log", () => {
  it("runs RuleTester suite", () => {
    ruleTester.run("no-phi-log", rule as unknown as Parameters<RuleTester["run"]>[1], {
      valid: [
        // OK: no PHI keys
        { code: "console.log({ traceId: 'abc' })" },
        { code: "console.info('starting up')" },
        { code: "console.error(`trace ${traceId}`)" },
        { code: "logger.log({ name: 'x' })" }, // not console.* — out of scope
        { code: "console.log({ ['safe']: 1 })" },
      ],
      invalid: [
        {
          code: "console.log({ text: 'hola' })",
          errors: [{ messageId: "objectKey" }],
        },
        {
          code: "console.warn({ name: 'Maria' })",
          errors: [{ messageId: "objectKey" }],
        },
        {
          code: "console.error({ phone: '555' })",
          errors: [{ messageId: "objectKey" }],
        },
        {
          code: "console.info(`Patient ${dob}`)",
          errors: [{ messageId: "templateLabel" }],
        },
        {
          code: "console.log(`translation: ${value}`)",
          errors: [{ messageId: "templateLabel" }],
        },
        {
          code: "console.debug({ translation: t, ok: true })",
          errors: [{ messageId: "objectKey" }],
        },
      ],
    });
  });
});
