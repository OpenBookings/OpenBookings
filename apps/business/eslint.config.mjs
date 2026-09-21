import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-inner-declarations": "error",
      "react/no-danger": "error",
      "react/style-prop-object": "warn",
      "no-unused-expressions": "error",
      "no-return-assign": "error",
    },
  },
  // public/maplibre/** is maplibre's own minified dist, staged there by
  // scripts/copy-maplibre-worker.mjs. Linting a vendored bundle reports on
  // code nobody here wrote and cannot fix.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/maplibre/**"]),
]);

export default eslintConfig;
