import { resolve } from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  root: resolve(import.meta.dirname, "../.."),
  resolve: {
    alias: {
      "server-only": resolve(import.meta.dirname, "../../test/site/server-only-stub.ts"),
      "tar": require.resolve("tar"),
    },
  },
  test: {
    include: ["test/site/**/*.test.ts"],
    environment: "node",
  },
});
