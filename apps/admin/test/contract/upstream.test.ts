import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const UPSTREAM_PRIMITIVES = [
  "alert-dialog.tsx", "alert.tsx", "avatar.tsx", "badge.tsx", "button.tsx",
  "calendar.tsx", "card.tsx", "checkbox.tsx", "collapsible.tsx", "command.tsx",
  "dialog.tsx", "dropdown-menu.tsx", "form.tsx", "input-otp.tsx", "input.tsx",
  "label.tsx", "popover.tsx", "radio-group.tsx", "scroll-area.tsx", "select.tsx",
  "separator.tsx", "sheet.tsx", "sidebar.tsx", "skeleton.tsx", "sonner.tsx",
  "switch.tsx", "table.tsx", "tabs.tsx", "textarea.tsx", "tooltip.tsx",
] as const;

const MIGRATED_SOURCES = [
  ...UPSTREAM_PRIMITIVES.map((file) => `src/components/ui/${file}`),
  "src/components/confirm-dialog.tsx",
  "src/components/long-text.tsx",
  "src/components/password-input.tsx",
  "src/components/select-dropdown.tsx",
  "src/components/skip-to-main.tsx",
  "src/hooks/use-mobile.ts",
] as const;

const FORBIDDEN_TEMPLATE_IMPORTS = [
  /from\s*["'](?:vite|@tanstack\/react-router|@clerk\/[^"']+)["']/,
  /from\s*["']@\/(?:routes|features|stores|context)\//,
  /import\.meta\.env/,
];

describe("shadcn primitive migration", () => {
  it("retains the audited upstream source and MIT attribution", async () => {
    const notice = await readFile(resolve(appRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notice).toContain("satnaing/shadcn-admin");
    expect(notice).toContain("e16c87f213a5ba5e45964e9b67c792105ec74d26");
    expect(notice).toContain("MIT License");
  });

  it("ships the exact frozen upstream primitive manifest", async () => {
    const files = await readdir(resolve(appRoot, "src/components/ui"));
    expect(files.filter((file) => file.endsWith(".tsx")).sort()).toEqual([...UPSTREAM_PRIMITIVES]);
  });

  it("keeps every migrated source free of Vite, router, Clerk, and template imports", async () => {
    const sources = await Promise.all(MIGRATED_SOURCES.map(async (path) => ({
      path,
      source: await readFile(resolve(appRoot, path), "utf8"),
    })));

    for (const { path, source } of sources) {
      for (const forbidden of FORBIDDEN_TEMPLATE_IMPORTS) {
        expect(source, `${path} contains ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("locks the explicit Next and React compatibility adaptations", async () => {
    const sonner = await readFile(resolve(appRoot, "src/components/ui/sonner.tsx"), "utf8");
    const sidebar = await readFile(resolve(appRoot, "src/components/ui/sidebar.tsx"), "utf8");

    expect(sonner).toContain("from 'next-themes'");
    expect(sonner).not.toContain("@/context/theme-provider");
    expect(sidebar).toContain("const width = '70%'");
  });
});
