import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { zh } from "./i18n/messages";

const appRoot = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(appRoot, path), "utf8");

const RETIRED_PATHS = [
  "app/api/manifests/route.ts",
  "app/api/openapi/[moduleId]/route.ts",
  "app/api/resource/route.ts",
  "app/api/action/route.ts",
  "app/api/control/offers/route.ts",
  "app/api/control/redemption-programs/route.ts",
  "app/api/control/code-batches/route.ts",
  "app/api/control/code-batches/[batchRef]/[action]/route.ts",
  "app/api/control/credit-programs/route.ts",
  "app/offers/page.tsx",
  "app/code-batches/page.tsx",
  "app/credit-programs/page.tsx",
  "app/credit-programs/credit-program-console.tsx",
  "app/credit-programs/INDEX.md",
  "app/teams/page.tsx",
  "app/hub/page.tsx",
  "components/shell/resource-table.tsx",
  "components/shell/skill-upload-modal.tsx",
  "lib/admin-gateway.ts",
  "lib/admin-trust-boundary.ts",
  "lib/resource-forms.ts",
  "lib/control-plane/credit-program-client.ts",
  "lib/control-plane/credit-program-client.test.ts",
  "lib/credit-program-contract.ts",
  "lib/credit-program-contract.test.ts",
  "components.json",
  "components/ui",
] as const;

const LIVE_MESSAGE_KEYS = [
  "nav.approvals",
  "nav.audit",
  "nav.credit",
  "nav.group.business",
  "nav.group.ops",
  "nav.models",
  "nav.operators",
  "nav.overview",
  "nav.sites",
  "nav.users",
  "ui.language",
  "ui.logout",
  "ui.noSite",
  "ui.selectSite",
] as const;

describe("typed Admin topology", () => {
  it("physically removes generic and unimplemented Admin surfaces", () => {
    for (const path of RETIRED_PATHS) {
      expect(existsSync(resolve(appRoot, path)), path).toBe(false);
    }
  });

  it("keeps navigation and the overview on typed control routes only", () => {
    const shell = source("components/shell/app-shell.tsx");
    for (const route of ["/teams", "/hub", "/offers", "/code-batches", "/credit-programs"]) {
      expect(shell, route).not.toContain(route);
    }
    expect(shell).not.toContain("manifests");
    expect(source("app/page.tsx")).toContain('apiGet("/api/control/approvals"');
    expect(source("lib/admin-surface-permissions.ts")).not.toContain("creditProgram");
  });

  it("does not ship a second component system beside Ant Design", () => {
    const packageJson = JSON.parse(source("package.json")) as { dependencies?: Record<string, string> };
    for (const dependency of [
      "@radix-ui/react-dialog",
      "@radix-ui/react-label",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "class-variance-authority",
      "lucide-react",
      "tailwind-merge",
    ]) {
      expect(packageJson.dependencies, dependency).not.toHaveProperty(dependency);
    }
  });

  it("uses one stable and peer-compatible Admin framework matrix", () => {
    const packageJson = JSON.parse(source("package.json")) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies).toMatchObject({
      "@ant-design/pro-components": "2.8.10",
      "@refinedev/antd": "6.0.3",
      "@refinedev/core": "5.0.12",
      "@refinedev/nextjs-router": "7.0.5",
      antd: "5.29.3",
    });
    expect(source("components/shell/app-shell.tsx")).toContain("<Refine");
    expect(source("app/layout.tsx")).not.toContain("next/font/google");
  });

  it("removes manifest-era and retired-surface translation inventory", () => {
    expect(Object.keys(zh).sort()).toEqual([...LIVE_MESSAGE_KEYS].sort());
    expect(Object.keys(en).sort()).toEqual([...LIVE_MESSAGE_KEYS].sort());
  });

  it("does not document the retired generic action gateway", () => {
    expect(source("lib/api.ts")).not.toContain("/api/action");
  });
});
