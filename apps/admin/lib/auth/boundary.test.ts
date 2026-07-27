import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const authDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(authDir, "../..");

describe("Admin Web authentication ownership", () => {
  it("does not import a Platform database client", () => {
    for (const path of ["auth.ts", "lib/auth/adapter.ts", "lib/auth/events.ts"]) {
      const source = readFileSync(resolve(appRoot, path), "utf8");
      expect(source, path).not.toMatch(/prisma|DATABASE_URL_ADMIN/i);
    }
  });

  it("has no Prisma scripts or runtime dependencies", () => {
    const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageJson.scripts).not.toHaveProperty("db:generate");
    expect(Object.keys(packageJson.scripts)).not.toContain("postinstall");
    expect(Object.keys(packageJson.dependencies)).not.toContain("@auth/prisma-adapter");
    expect(Object.keys(packageJson.dependencies)).not.toContain("@prisma/client");
    expect(Object.keys(packageJson.dependencies)).not.toContain("prisma");
    const workspace = readFileSync(resolve(appRoot, "../../pnpm-workspace.yaml"), "utf8");
    expect(workspace).not.toMatch(/prisma/i);
  });

  it("does not require the Platform database URL", () => {
    const source = readFileSync(resolve(appRoot, "lib/env.ts"), "utf8");
    expect(source).not.toContain("DATABASE_URL_ADMIN");
    expect(source).toContain("export function getEnv");
    expect(source).not.toMatch(/export const env\s*=\s*parseEnv\(process\.env\)/);
  });
});
