import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tmp/**",
    // .gitwarp 是外部并行 worktree（另一分支的 src 全量副本），与 tmp/ 同理不纳入本仓 lint，
    // 否则兄弟分支的历史问题会污染门禁。
    ".gitwarp/**",
  ]),
]);

export default eslintConfig;
