import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", ".next/**", "out/**", ".wrangler/**", "src/generated/**", "src/worker-configuration.d.ts", "workers/*-configuration.d.ts", "sources/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["functions/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "prisma/**/*.ts", "workers/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly" } },
  },
);
