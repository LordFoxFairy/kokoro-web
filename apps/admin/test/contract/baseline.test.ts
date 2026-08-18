import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDITED_THEME_SHA256 =
  "faee559c9a21b2084bf7bae193e70f0ab18b18a393a06fec1408669652c266a1";

async function read(relativePath: string) {
  return readFile(join(appRoot, relativePath), "utf8");
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory() && [".next", "node_modules"].includes(entry.name)) {
        return [];
      }
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:[cm]?[jt]sx?|json|css|mjs)$/.test(entry.name) ? [path] : [];
    }),
  );

  return files.flat();
}

describe("admin application baseline", () => {
  it("pins the approved Next, React, Tailwind and shadcn foundation", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.name).toBe("@kokoro/admin-web");
    expect(manifest.dependencies.next).toMatch(/^16\./);
    expect(manifest.dependencies.react).toMatch(/^19\./);
    expect(manifest.dependencies["react-dom"]).toMatch(/^19\./);
    expect(manifest.devDependencies.tailwindcss).toMatch(/^4\./);
    expect(manifest.devDependencies["@tailwindcss/postcss"]).toMatch(/^4\./);

    for (const dependency of [
      "@radix-ui/react-slot",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "next-themes",
      "tailwind-merge",
    ]) {
      expect(manifest.dependencies, `missing ${dependency}`).toHaveProperty(dependency);
    }
  });

  it("provides the source alias and exact audited semantic theme", async () => {
    const tsconfig = JSON.parse(await read("tsconfig.json")) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    const theme = await read("src/styles/theme.css");

    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    expect(createHash("sha256").update(theme).digest("hex")).toBe(AUDITED_THEME_SHA256);
  });

  it("records the audited upstream source and MIT attribution", async () => {
    const notice = await read("THIRD_PARTY_NOTICES.md");

    expect(notice).toContain("satnaing/shadcn-admin");
    expect(notice).toContain("e16c87f213a5ba5e45964e9b67c792105ec74d26");
    expect(notice).toContain("MIT License");
    expect(notice).toContain("Copyright (c) 2024 Sat Naing");
  });

  it("does not restore forbidden legacy or template dependencies", async () => {
    const forbidden = [
      /(?:^|["'\/])antd(?:["'\/]|$)/,
      /@ant-design\//,
      /@clerk\//,
      /@tanstack\/react-router/,
      /(?:^|["'\/])vite(?:["'\/]|$)/,
    ];
    const files = await sourceFiles(appRoot);

    for (const file of files) {
      if (file.endsWith("baseline.test.ts")) continue;
      const contents = await readFile(file, "utf8");
      for (const pattern of forbidden) {
        expect(contents, `${relative(appRoot, file)} contains ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
