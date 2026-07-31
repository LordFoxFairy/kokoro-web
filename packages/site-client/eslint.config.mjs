import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  // Generated mirrors are verified by Root generation/contract tests and TypeScript;
  // lint their generators instead of hand-suppressing emitted code.
  { ignores: ["dist/**", "node_modules/**", "src/generated/**", "*.tsbuildinfo"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];
