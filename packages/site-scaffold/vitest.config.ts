import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(import.meta.dirname, "../.."),
  resolve: {
    alias: {
      "server-only": resolve(import.meta.dirname, "../../test/site/server-only-stub.ts"),
    },
  },
  test: {
    include: ["test/site/**/*.test.ts"],
    environment: "node",
  },
});
