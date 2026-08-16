import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");
const webRoot = resolve(appRoot, "../..");

const removedPaths = [
  "auth.config.ts",
  "middleware.ts",
  "components.json",
  "prisma/schema.prisma",
  "lib/prisma.ts",
  "lib/actions.ts",
  "lib/api.ts",
  "lib/api.test.ts",
  "lib/format.ts",
  "lib/resource-forms.ts",
  "lib/resource-forms.test.ts",
  "lib/schemas.ts",
  "lib/utils.ts",
  "lib/i18n/messages.ts",
  "lib/i18n/en.ts",
  "lib/i18n/context.tsx",
  "components/shell/app-shell.tsx",
  "components/shell/resource-table.tsx",
  "components/shell/endpoint-table.tsx",
  "components/shell/skill-upload-modal.tsx",
  "components/ui/badge.tsx",
  "components/ui/button.tsx",
  "components/ui/card.tsx",
  "components/ui/dialog.tsx",
  "components/ui/input.tsx",
  "components/ui/label.tsx",
  "components/ui/select.tsx",
  "components/ui/table.tsx",
  "app/teams/page.tsx",
  "app/credit/page.tsx",
  "app/payment/page.tsx",
  "app/sites/page.tsx",
  "app/models/page.tsx",
  "app/hub/page.tsx",
  "app/approvals/page.tsx",
  "app/operators/page.tsx",
  "app/users/page.tsx",
  "app/audit/page.tsx",
  "app/page.tsx",
  "app/login/page.tsx",
  "app/auth/verify/page.tsx",
] as const;

describe("Admin hard authority cut", () => {
  it("WEB-CONTRACT-BOUNDARY-001 removes every legacy authority route and compatibility file", async () => {
    for (const relative of removedPaths) {
      await expect(access(resolve(appRoot, relative)), relative).rejects.toThrow();
    }
  });

  it("WEB-CONTRACT-TOOLS-001 removes Prisma Radix shadcn and gateway scripts from package ownership", async () => {
    const pkg = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    const forbidden = [
      "@auth/prisma-adapter",
      "@prisma/client",
      "prisma",
      "@radix-ui/react-dialog",
      "@radix-ui/react-label",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "tailwind-merge",
      "tw-animate-css",
    ];

    expect(Object.keys(pkg.dependencies).filter((name) => forbidden.includes(name))).toEqual([]);
    expect(Object.keys(pkg.scripts).filter((name) => name.startsWith("db:") || name === "postinstall" || name === "prebuild"))
      .toEqual([]);
    const workspace = await readFile(resolve(webRoot, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).not.toMatch(/prisma/u);
  });

  it("WEB-CONTRACT-BOUNDARY-001 leaves no runtime database gateway rewrite or JWT authority", async () => {
    const files = [
      "auth.ts",
      "next.config.ts",
      ".env.example",
      "package.json",
    ];
    const source = (await Promise.all(files.map((path) => readFile(resolve(appRoot, path), "utf8")))).join("\n");

    expect(source).not.toMatch(/DATABASE_URL|KOKORO_GATEWAY|KOKORO_ADMIN_PROXY|@prisma|strategy:\s*["']jwt["']|rewrites\s*\(/u);
  });
});
