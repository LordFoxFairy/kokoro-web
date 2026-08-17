import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { adminNavigation } from "../../components/shell/navigation";
import { en } from "../../i18n/en";
import { zh } from "../../i18n/messages";
import { ADMIN_LAYOUT, antdTheme, proLayoutToken } from "../../lib/theme";
import { iamModuleRegistry } from "../../modules/iam/registry";
import { adminModuleRegistry, projectAdminModules } from "../../modules/registry";

describe("Kokoro Admin platform shell contract", () => {
  it("WEB-CONTRACT-SHELL-001 identifies the product as the overall management console", () => {
    expect(zh["app.product"]).toBe("管理后台");
    expect(zh["auth.login.title"]).toBe("登录管理后台");
    expect(en["app.product"]).toBe("Admin Console");
    expect(en["auth.login.title"]).toBe("Sign in to Kokoro Admin");
    expect(JSON.stringify({ zh, en })).not.toMatch(/运营控制台|运营后台登录|Operations Console|IAM Operations Console/u);
  });

  it("WEB-CONTRACT-SHELL-001 registers only executable routes", async () => {
    expect(iamModuleRegistry.map((item) => item.href)).toEqual([
      "/",
      "/users",
      "/sessions",
      "/sites",
      "/organizations",
      "/access",
      "/audit",
    ]);
    expect(adminNavigation).toHaveLength(7);
    expect(new Set(adminNavigation.map((item) => item.href)).size).toBe(7);
    for (const item of adminNavigation) {
      const route = item.href === "/" ? "page.tsx" : `${item.href.slice(1)}/page.tsx`;
      await expect(access(path.join(process.cwd(), "app", "(control)", route))).resolves.toBeUndefined();
    }
  });

  it("WEB-SEC-ROUTE-001 binds every executable Admin route to the platform administrator capability", () => {
    expect(adminModuleRegistry.every((item) => (
      item.scope === "platform" && item.requiredPermission === "platform:admin"
    ))).toBe(true);
    expect(projectAdminModules(["platform:admin"])).toEqual(adminModuleRegistry);
    expect(projectAdminModules([])).toEqual([]);
  });

  it("WEB-CONTRACT-SHELL-001 fixes the platform to the approved light palette", () => {
    expect(antdTheme.token).toEqual(expect.objectContaining({
      colorPrimary: "#1677ff",
      colorBgLayout: "#f5f7fa",
      colorText: "#1f2937",
    }));
    expect(proLayoutToken.sider).toEqual(expect.objectContaining({
      colorMenuBackground: "#ffffff",
      colorBgMenuItemSelected: "#e6f4ff",
      colorTextMenuSelected: "#1677ff",
    }));
    expect(proLayoutToken.header.heightLayoutHeader).toBe(56);
    expect(ADMIN_LAYOUT).toEqual({
      siderWidth: 216,
      headerHeight: 56,
      menuIconSize: 18,
      commandIconSize: 16,
      contentMaxWidth: 1600,
    });
  });

  it("WEB-CONTRACT-SHELL-001 keeps navigation grouped by business boundary", () => {
    expect(iamModuleRegistry.map((item) => [item.href, item.groupKey])).toEqual([
      ["/", null],
      ["/users", "nav.group.identity"],
      ["/sessions", "nav.group.identity"],
      ["/sites", "nav.group.tenant"],
      ["/organizations", "nav.group.organization"],
      ["/access", "nav.group.access"],
      ["/audit", "nav.group.access"],
    ]);
    expect(zh["nav.group.tenant"]).toBe("租户管理");
    expect(zh["nav.group.organization"]).toBe("组织管理");
    expect(en["nav.group.tenant"]).toBe("Tenant management");
    expect(en["nav.group.organization"]).toBe("Organization management");
  });
});
