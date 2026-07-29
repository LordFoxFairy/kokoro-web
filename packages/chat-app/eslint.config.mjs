import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default [
  { ignores: ["node_modules/**", "*.tsbuildinfo"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
]
