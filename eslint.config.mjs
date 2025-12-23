import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // 🔐 CSP / XSS hardening
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // Prevent script injection patterns
      "no-script-url": "error",

      // Strongly discourage unsafe DOM patterns
      "no-inner-declarations": "error",

      // React / JSX safety (important for Next)
      "react/no-danger": "error", // blocks dangerouslySetInnerHTML
      "react/style-prop-object": "warn", // warns against passing style objects to components

      // Optional but helpful
      "no-unused-expressions": "error",
      "no-return-assign": "error",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
