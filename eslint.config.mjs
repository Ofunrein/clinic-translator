// Flat config (ESLint 9). Loads Next.js core-web-vitals via FlatCompat
// and registers the local `no-phi-log` rule.
import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const compat = new FlatCompat({ baseDirectory: __dirname });
const localPlugin = require("./eslint-rules/index.js");

export default [
  ...compat.extends("next/core-web-vitals"),
  {
    plugins: { local: localPlugin },
    rules: {
      "local/no-phi-log": "error",
    },
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "tests/e2e/**",
    ],
  },
];
