import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Flat-config ignore patterns that contain a "/" are anchored to the config
  // file's directory, so "dist/**" / "out/**" only matched the repo root.
  // Prefix with "**/" so nested build outputs are covered too (electron-vite
  // emits apps/desktop/dist/** and apps/desktop/out/**; .zcode/** holds
  // workflow-run scratch scripts).
  globalIgnores([
    "**/.next/**",
    "**/out/**",
    "**/dist/**",
    "**/.zcode/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Align with tsc's noUnusedParameters convention: "_"-prefixed args and
      // vars are intentionally unused (interface parity, fixed Win32 callback
      // signatures).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
