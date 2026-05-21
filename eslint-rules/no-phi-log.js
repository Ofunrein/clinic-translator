/**
 * ESLint rule: no-phi-log
 *
 * Flags `console.{log,info,warn,error,debug,trace}(...)` calls where any
 * argument is an object literal containing PHI keys, or a template literal
 * whose static parts mention a PHI label immediately followed by an
 * interpolation (e.g. `Patient ${dob}`).
 *
 * Authored as plain JS (not TS) so ESLint can require it without a build
 * step from `.eslintrc.json`.
 */
"use strict";

const PHI_KEY_RE = /^(text|translation|name|phone|dob|notes|email)$/i;
const PHI_LABEL_RE = /(text|translation|name|phone|dob|notes|email)\s*[:=]?\s*$/i;

const CONSOLE_METHODS = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
]);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow console logging of PHI fields (text, translation, name, phone, dob, notes, email).",
      recommended: true,
    },
    schema: [],
    messages: {
      objectKey:
        "console.{{method}} argument contains PHI key '{{key}}'. PHI must not be logged.",
      templateLabel:
        "console.{{method}} template literal interpolates after PHI label '{{label}}'. PHI must not be logged.",
    },
  },
  create(context) {
    function isConsoleCall(node) {
      const callee = node.callee;
      if (!callee || callee.type !== "MemberExpression") return null;
      if (callee.computed) return null;
      const obj = callee.object;
      const prop = callee.property;
      if (
        obj &&
        obj.type === "Identifier" &&
        obj.name === "console" &&
        prop &&
        prop.type === "Identifier" &&
        CONSOLE_METHODS.has(prop.name)
      ) {
        return prop.name;
      }
      return null;
    }

    function checkObject(node, method) {
      if (!node || node.type !== "ObjectExpression") return;
      for (const prop of node.properties) {
        if (prop.type !== "Property") continue;
        let keyName = null;
        if (prop.key.type === "Identifier") keyName = prop.key.name;
        else if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
          keyName = prop.key.value;
        }
        if (keyName && PHI_KEY_RE.test(keyName)) {
          context.report({
            node: prop,
            messageId: "objectKey",
            data: { method, key: keyName },
          });
        }
      }
    }

    function checkTemplate(node, method) {
      if (!node || node.type !== "TemplateLiteral") return;
      // Inspect the static "quasi" string preceding each interpolation.
      for (let i = 0; i < node.expressions.length; i++) {
        const quasi = node.quasis[i];
        if (!quasi) continue;
        const cooked = quasi.value.cooked ?? quasi.value.raw ?? "";
        const m = cooked.match(PHI_LABEL_RE);
        if (m) {
          context.report({
            node: node.expressions[i],
            messageId: "templateLabel",
            data: { method, label: m[1] },
          });
        }
      }
    }

    return {
      CallExpression(node) {
        const method = isConsoleCall(node);
        if (!method) return;
        for (const arg of node.arguments) {
          if (arg.type === "ObjectExpression") checkObject(arg, method);
          else if (arg.type === "TemplateLiteral") checkTemplate(arg, method);
        }
      },
    };
  },
};

module.exports = rule;
