import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const resolveConfig = {
  alias: {
    "@": root,
    "server-only": resolve(root, "test/support/server-only.ts"),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: resolveConfig,
        test: {
          name: "node",
          environment: "node",
          env: {
            AUTH_URL: "http://localhost:3100",
          },
          server: {
            deps: {
              inline: [/next-auth/u, /@auth\+core/u],
            },
          },
          include: [
            "lib/**/*.test.ts",
            "test/unit/**/*.test.ts",
            "test/contract/**/*.test.ts",
            "test/integration/**/*.test.ts",
            "test/security/**/*.test.ts",
            "test/pair/**/*.test.ts",
          ],
        },
      },
      {
        resolve: resolveConfig,
        test: {
          name: "component",
          environment: "jsdom",
          setupFiles: ["./test/setup/component.ts"],
          include: ["test/component/**/*.test.ts", "test/component/**/*.test.tsx"],
        },
      },
    ],
  },
});
