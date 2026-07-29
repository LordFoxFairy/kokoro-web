import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "node_modules/**", "*.tsbuildinfo"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/generated/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
];
