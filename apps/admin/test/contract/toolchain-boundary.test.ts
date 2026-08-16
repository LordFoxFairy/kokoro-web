import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(appRoot, "../..");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("Admin Web toolchain boundary", () => {
  it("WEB-CONTRACT-TOOLS-001 loads the native Next flat config through ESLint", async () => {
    const eslint = new ESLint({ cwd: appRoot });
    const [result] = await eslint.lintText(
      "export function sum(left: number, right: number): number { return left + right; }\n",
      { filePath: resolve(appRoot, "toolchain-fixture.ts") },
    );

    expect(result).toBeDefined();
    expect(result?.errorCount).toBe(0);
    expect(result?.warningCount).toBe(0);
  });

  it("WEB-CONTRACT-TOOLS-001 exposes every classified gate", async () => {
    const root = await json(resolve(repositoryRoot, "package.json"));
    const admin = await json(resolve(appRoot, "package.json"));
    const scripts = admin.scripts as Record<string, string>;

    expect(root.packageManager).toBe("pnpm@11.2.2");
    expect(root.engines).toEqual({ node: ">=22 <23" });
    expect(Object.keys(scripts).sort()).toEqual([
      "acceptance",
      "acceptance:pair",
      "build",
      "db:generate",
      "dev",
      "lint",
      "postinstall",
      "prebuild",
      "proto:check",
      "proto:generate",
      "proto:lint",
      "smoke",
      "start",
      "test",
      "test:catalog",
      "test:component",
      "test:contract",
      "test:integration",
      "test:security",
      "test:unit",
      "typecheck",
      "verify",
    ]);
  });

  it("WEB-CONTRACT-TOOLS-001 pins every external Admin dependency exactly", async () => {
    const admin = await json(resolve(appRoot, "package.json"));
    const dependencies = admin.dependencies as Record<string, string>;
    const devDependencies = admin.devDependencies as Record<string, string>;

    for (const [name, version] of Object.entries({ ...dependencies, ...devDependencies })) {
      if (version.startsWith("workspace:")) continue;
      expect(version, name).toMatch(/^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u);
    }
    expect(devDependencies).not.toHaveProperty("@eslint/eslintrc");
  });
});
